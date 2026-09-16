"""Unit tests for ingestion.mlb_client (_row mapping and fetch_game_day).

Run: python -m pytest ingestion/tests -q
"""
import datetime as dt
import io
from typing import Any

import httpx
import pytest

from ingestion.mlb_client import COLUMN_MAP, FetchRetriesExhausted, RetryPolicy, _row, fetch_game_day


def statcast_record(**overrides: Any) -> dict[str, Any]:
    """A realistic single row from the baseballsavant statcast CSV."""
    rec = {
        "pitch_id": "7482193045",
        "game_pk": "776123",
        "game_date": "2026-09-14",
        "pitcher": "502043",
        "batter": "665489",
        "pitch_type": "FF",
        "release_speed": "97.4",
        "release_spin_rate": "2341",
        "api_release_pos_x": "-0.682",
        "release_pos_y": "54.867",
        "api_release_pos_z": "5.612",
        "vx0": "7.432",
        "vy0": "-138.215",
        "vz0": "-5.877",
        "ax": "7.411",
        "ay": "6.283",
        "az": "-22.918",
        "plate_x": "-0.314",
        "plate_z": "2.418",
        "sz_top": "3.417",
        "sz_bot": "1.543",
        "description": "swinging_strike",
    }
    rec.update(overrides)
    return rec


class TestRowMapping:
    def test_pitch_id_stays_string(self):
        row = _row(statcast_record())
        assert row["pitch_id"] == "7482193045"
        assert isinstance(row["pitch_id"], str)

    def test_pitch_id_survives_19_digit_precision(self):
        # 2**53 would be silently rounded through float64; the string must not be.
        big = "7777777777777777777"
        row = _row(statcast_record(pitch_id=big))
        assert row["pitch_id"] == big

    def test_pitch_id_empty_is_preserved_not_none(self):
        # Empty CSV field stays an empty string (bronze-level), not silently None.
        row = _row(statcast_record(pitch_id=""))
        assert row["pitch_id"] == ""

    def test_ids_parsed_as_int(self):
        row = _row(statcast_record())
        assert row["game_id"] == 776123
        assert row["pitcher_id"] == 502043
        assert row["batter_id"] == 665489
        for k in ("game_id", "pitcher_id", "batter_id"):
            assert isinstance(row[k], int)

    def test_missing_game_id_is_dropped(self):
        assert _row(statcast_record(game_pk="")) is None

    def test_numeric_fields_are_float(self):
        row = _row(statcast_record())
        assert row["release_speed"] == pytest.approx(97.4)
        assert row["y0"] == pytest.approx(54.867)
        assert row["az"] == pytest.approx(-22.918)

    def test_text_fields_pass_through(self):
        row = _row(statcast_record())
        assert row["pitch_type"] == "FF"
        assert row["game_date"] == "2026-09-14"

    def test_descriptions_are_popped(self):
        assert "description" not in _row(statcast_record())


class TestSwingClassification:
    @pytest.mark.parametrize(
        "desc,swing,whiff",
        [
            ("swinging_strike", 1, 1),
            ("swinging_strike_blocked", 1, 0),
            ("foul", 1, 0),
            ("hit_into_play", 1, 0),
            ("ball", 0, 0),
            ("called_strike", 0, 0),
            ("foul_tip", 0, 0),  # not in the swing set; Statcast treats it as take here
            ("catcher_interf", 0, 0),
            ("", 0, 0),
            (None, 0, 0),
        ],
    )
    def test_is_swing_and_is_whiff(self, desc, swing, whiff):
        row = _row(statcast_record(description=desc))
        assert row["is_swing"] == swing
        assert row["is_whiff"] == whiff


class TestFetchGameDay:
    def _fake_client(self, csv_chunks: list[str]):
        body = b"".join(c.encode() for c in csv_chunks)
        headers = {"content-length": str(len(body))}

        def handler(request: httpx.Request) -> httpx.Response:
            query = str(request.url.query)
            assert "game_date_gt=2026-09-14" in query
            assert "game_date_lt=2026-09-15" in query
            return httpx.Response(200, headers=headers, content=body)

        return httpx.Client(transport=httpx.MockTransport(handler))

    def test_streams_realistic_csv(self):
        header = (
            "pitch_id,game_pk,game_date,pitcher,batter,pitch_type,release_speed,"
            "release_spin_rate,api_release_pos_x,release_pos_y,api_release_pos_z,"
            "vx0,vy0,vz0,ax,ay,az,plate_x,plate_z,sz_top,sz_bot,description\n"
        )
        rows = [
            "7482193045,776123,2026-09-14,502043,665489,FF,97.4,2341,-0.682,54.867,"
            "5.612,7.432,-138.215,-5.877,7.411,6.283,-22.918,-0.314,2.418,3.417,1.543,swinging_strike\n",
            "7482193046,776123,2026-09-14,502043,665489,SL,86.1,2688,0.594,55.102,"
            "5.981,-10.204,-132.774,-3.915,-11.407,7.101,-25.418,0.822,1.902,3.417,1.543,ball\n",
        ]
        # Multiple chunks exercise the streaming reader (chunk boundary mid-row).
        client = self._fake_client([header, rows[0][:60], rows[0][60:] + rows[1]])
        out = list(fetch_game_day(dt.date(2026, 9, 14), client=client))
        assert len(out) == 2
        assert out[0]["pitch_id"] == "7482193045"
        assert out[0]["game_id"] == 776123
        assert out[0]["is_whiff"] == 1
        assert out[1]["is_swing"] == 0

    def test_rows_with_no_game_id_are_skipped(self):
        header = "pitch_id,game_pk,game_date,pitcher,batter,pitch_type,description\n"
        body = header + "7482193045,,2026-09-14,502043,665489,FF,ball\n"
        client = self._fake_client([body])
        assert list(fetch_game_day(dt.date(2026, 9, 14), client=client)) == []

    def test_http_error_propagates(self):
        # Persistent 503: retried 3x with injected (real-world: backoff) sleeps,
        # then a clear FetchRetriesExhausted (still an httpx.HTTPError) is raised.
        handler, calls = scripted_handler([httpx.Response(503)])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sleeps: list[float] = []
        with pytest.raises(FetchRetriesExhausted) as exc_info:
            list(fetch_game_day(
                dt.date(2026, 9, 14),
                client=client,
                retry=RetryPolicy(attempts=3, base_delay=0.5, sleep=sleeps.append),
            ))
        assert isinstance(exc_info.value, httpx.HTTPError)
        assert exc_info.value.last_status == 503
        assert exc_info.value.attempts == 3
        assert len(calls) == 3
        assert sleeps == [0.5, 1.0]

    def test_borrowed_client_not_closed(self):
        client = self._fake_client(["pitch_id,game_pk\n1,2\n"])
        list(fetch_game_day(dt.date(2026, 9, 14), client=client))
        assert not client.is_closed


CSV_HEADER = (
    "pitch_id,game_pk,game_date,pitcher,batter,pitch_type,description\n"
)
CSV_ROW = "7482193045,776123,2026-09-14,502043,665489,FF,ball\n"


def scripted_handler(responses: list):
    """MockTransport handler playing back scripted responses (Exception
    entries are raised, the last one repeats); returns (handler, calls)."""
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        r = responses[len(calls) - 1] if len(calls) - 1 < len(responses) else responses[-1]
        if isinstance(r, Exception):
            raise r
        return r

    return handler, calls


class TestRetry:
    def test_transient_500_then_success_retries_once(self):
        body = (CSV_HEADER + CSV_ROW).encode()
        handler, calls = scripted_handler([httpx.Response(500), httpx.Response(200, content=body)])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sleeps: list[float] = []
        policy = RetryPolicy(attempts=3, base_delay=0.5, sleep=sleeps.append)

        rows = list(fetch_game_day(dt.date(2026, 9, 14), client=client, retry=policy))

        assert len(rows) == 1
        assert rows[0]["game_id"] == 776123
        assert len(calls) == 2
        assert sleeps == [0.5]

    def test_501_is_retryable_too(self):
        # The full 5xx range is retryable, not just the common allowlist.
        body = (CSV_HEADER + CSV_ROW).encode()
        handler, calls = scripted_handler([httpx.Response(501), httpx.Response(200, content=body)])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sleeps: list[float] = []
        policy = RetryPolicy(attempts=3, base_delay=0.5, sleep=sleeps.append)

        rows = list(fetch_game_day(dt.date(2026, 9, 14), client=client, retry=policy))

        assert len(rows) == 1
        assert len(calls) == 2
        assert sleeps == [0.5]

    def test_429_with_retry_after_sleeps_exactly_that_then_succeeds(self):
        body = (CSV_HEADER + CSV_ROW).encode()
        handler, calls = scripted_handler([
            httpx.Response(429, headers={"retry-after": "7"}),
            httpx.Response(200, content=body),
        ])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sleeps: list[float] = []
        policy = RetryPolicy(attempts=3, base_delay=0.5, sleep=sleeps.append)

        rows = list(fetch_game_day(dt.date(2026, 9, 14), client=client, retry=policy))

        assert len(rows) == 1
        assert sleeps == [7.0]  # Retry-After honored, not the 0.5s backoff
        assert len(calls) == 2

    def test_persistent_500_raises_clear_exhausted_exception(self):
        handler, calls = scripted_handler([httpx.Response(500)])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sleeps: list[float] = []
        policy = RetryPolicy(attempts=3, base_delay=0.5, sleep=sleeps.append)

        with pytest.raises(FetchRetriesExhausted) as exc_info:
            list(fetch_game_day(dt.date(2026, 9, 14), client=client, retry=policy))

        msg = str(exc_info.value)
        assert "baseballsavant.mlb.com" in msg and "500" in msg
        assert exc_info.value.last_status == 500
        assert len(calls) == 3  # attempts, not retries
        assert sleeps == [0.5, 1.0]  # exponential, jitterless

    def test_404_is_not_retried(self):
        handler, calls = scripted_handler([httpx.Response(404)])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sleeps: list[float] = []
        policy = RetryPolicy(attempts=3, base_delay=0.5, sleep=sleeps.append)

        with pytest.raises(httpx.HTTPStatusError):
            list(fetch_game_day(dt.date(2026, 9, 14), client=client, retry=policy))

        assert len(calls) == 1  # immediate raise, no retry
        assert sleeps == []

    def test_transport_error_then_success(self):
        body = (CSV_HEADER + CSV_ROW).encode()
        handler, calls = scripted_handler([
            httpx.ConnectError("connection reset"),
            httpx.Response(200, content=body),
        ])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sleeps: list[float] = []
        policy = RetryPolicy(attempts=3, base_delay=0.5, sleep=sleeps.append)

        rows = list(fetch_game_day(dt.date(2026, 9, 14), client=client, retry=policy))

        assert len(rows) == 1
        assert len(calls) == 2
        assert sleeps == [0.5]

    def test_persistent_transport_error_raises_exhausted(self):
        handler, calls = scripted_handler([httpx.ConnectError("connection reset")])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sleeps: list[float] = []
        policy = RetryPolicy(attempts=3, base_delay=0.5, sleep=sleeps.append)

        with pytest.raises(FetchRetriesExhausted) as exc_info:
            list(fetch_game_day(dt.date(2026, 9, 14), client=client, retry=policy))

        assert "baseballsavant.mlb.com" in str(exc_info.value)
        assert exc_info.value.last_status is None
        assert "connection reset" in str(exc_info.value)
        assert len(calls) == 3
        assert sleeps == [0.5, 1.0]


def test_column_map_targets_match_worker_schema_names():
    """Every COLUMN_MAP destination must exist in worker.SCHEMA (description is
    consumed into is_swing/is_whiff before write)."""
    from ingestion.worker import SCHEMA

    schema_names = {f.name for f in SCHEMA}
    for src, dst in COLUMN_MAP.items():
        assert dst in schema_names or dst == "description", (src, dst)
