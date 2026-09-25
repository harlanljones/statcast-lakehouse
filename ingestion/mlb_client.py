"""MLB Stats API client: one game day of Statcast pitch data.

Endpoint: https://statsapi.mlb.com/api/v1/sports/1/games/{date}/... via the
statcast query endpoint used by pybaseball:
  https://baseballsavant.mlb.com/statcast_search/csv?...
We hit the JSON statcast endpoint directly to avoid the CSV layer.
"""
from __future__ import annotations

import datetime as dt
import io
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterator

import httpx

STATCAST_URL = "https://baseballsavant.mlb.com/statcast_search/csv"
GAME_DAY_FMT = "%Y-%m-%d"

# Transient failures worth retrying: rate limiting and server errors.
# 429 + the whole 5xx range are retryable; other 4xx fail fast.
RETRYABLE_STATUS_RANGE = (500, 599)


@dataclass(frozen=True)
class RetryPolicy:
    """Retry knobs for the statcast fetch. The default sleeps for real; tests
    inject a recording callable so nothing actually sleeps."""

    attempts: int = 3
    base_delay: float = 0.5
    sleep: Callable[[float], None] = time.sleep

    def backoff(self, attempt: int) -> float:
        """Exponential, jitterless (for testability): 0.5, 1.0, 2.0, ..."""
        return self.base_delay * 2 ** (attempt - 1)


class FetchRetriesExhausted(httpx.HTTPError):
    """All retry attempts for a statcast fetch failed.

    Subclasses httpx.HTTPError so existing `except httpx.HTTPError` callers
    keep working; carries the URL, attempt count and last status/error.
    """

    def __init__(
        self,
        message: str,
        *,
        url: str,
        attempts: int,
        last_status: int | None = None,
        last_error: str | None = None,
    ) -> None:
        super().__init__(message)
        self.url = url
        self.attempts = attempts
        self.last_status = last_status
        self.last_error = last_error

# Statcast CSV columns -> our warehouse columns. Kept explicit so schema
# drift upstream fails loudly here instead of silently in BigQuery.
COLUMN_MAP = {
    "pitch_id": "pitch_id",
    "game_pk": "game_id",
    "game_date": "game_date",
    "pitcher": "pitcher_id",
    "batter": "batter_id",
    "pitch_type": "pitch_type",
    "release_speed": "release_speed",
    "release_spin_rate": "release_spin_rate",
    "api_release_pos_x": "x0",
    "release_pos_y": "y0",
    "api_release_pos_z": "z0",
    "vx0": "vx0",
    "vy0": "vy0",
    "vz0": "vz0",
    "ax": "ax",
    "ay": "ay",
    "az": "az",
    "plate_x": "plate_x",
    "plate_z": "plate_z",
    "sz_top": "sz_top",
    "sz_bot": "sz_bot",
    "stand": "stand",
    "p_throws": "p_throws",
    "balls": "balls",
    "strikes": "strikes",
    "at_bat_number": "at_bat_number",
    "pitch_number": "pitch_number",
    "description": "description",
}


def _to_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_int(v: Any) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


INT_FIELDS = frozenset(
    {"game_id", "pitcher_id", "batter_id", "balls", "strikes", "at_bat_number", "pitch_number"}
)
TEXT_FIELDS = frozenset({"pitch_type", "game_date", "description", "stand", "p_throws"})


class _RawReader(io.RawIOBase):
    """Adapter: httpx's streaming byte iterator -> a file-like raw reader."""

    def __init__(self, chunks: Iterator[bytes]) -> None:
        self._chunks = chunks
        self._buf = b""

    def readable(self) -> bool:
        return True

    def readinto(self, b: Any) -> int:
        while not self._buf:
            try:
                self._buf = next(self._chunks)
            except StopIteration:
                return 0
        n = min(len(b), len(self._buf))
        b[:n] = self._buf[:n]
        self._buf = self._buf[n:]
        return n


def _row(record: dict[str, Any]) -> dict[str, Any] | None:
    out: dict[str, Any] = {}
    for src, dst in COLUMN_MAP.items():
        if dst in TEXT_FIELDS:
            out[dst] = record.get(src)
        elif dst in INT_FIELDS:
            out[dst] = _to_int(record.get(src))
        elif dst == "pitch_id":
            # String-only: Statcast pitch ids exceed float64 integer precision.
            out[dst] = record.get(src)
        else:
            out[dst] = _to_float(record.get(src))
    if out.get("game_id") is None:
        return None
    # Upstream Statcast fallback: if pitch_id is missing, synthesize from game_pk + at_bat + pitch_number
    if not out.get("pitch_id") and record.get("at_bat_number") and record.get("pitch_number"):
        out["pitch_id"] = f"{record.get('game_pk')}_{record.get('at_bat_number')}_{record.get('pitch_number')}"
    # Upstream Statcast fallback: release_pos_x/z when api_release_pos_x/z is absent
    if out.get("x0") is None and "release_pos_x" in record:
        out["x0"] = _to_float(record.get("release_pos_x"))
    if out.get("z0") is None and "release_pos_z" in record:
        out["z0"] = _to_float(record.get("release_pos_z"))
    out["is_swing"] = int(out.get("description") in ("swinging_strike", "foul", "hit_into_play", "swinging_strike_blocked"))
    out["is_whiff"] = int(out.get("description") == "swinging_strike")
    out.pop("description", None)
    return out


def _retry_after_seconds(resp: httpx.Response) -> float | None:
    """Seconds to wait from a Retry-After header; None if absent/unparseable."""
    raw = resp.headers.get("retry-after")
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _exhausted(url: str, attempts: int, last_status: int | None, last_error: str | None) -> FetchRetriesExhausted:
    detail = f"last status={last_status}" if last_status is not None else f"last error={last_error}"
    return FetchRetriesExhausted(
        f"statcast fetch failed after {attempts} attempt(s): {url} ({detail})",
        url=url,
        attempts=attempts,
        last_status=last_status,
        last_error=last_error,
    )


def _open_stream(client: httpx.Client, params: dict[str, str], policy: RetryPolicy) -> httpx.Response:
    """Send the request, retrying transient failures, and return a streaming
    response with a 2xx status. Non-retryable 4xx raises immediately via
    raise_for_status; exhausted retries raise FetchRetriesExhausted."""
    request = client.build_request("GET", STATCAST_URL, params=params)
    attempt = 0
    while True:
        attempt += 1
        try:
            resp = client.send(request, stream=True)
        except httpx.HTTPError as exc:
            if attempt >= policy.attempts:
                raise _exhausted(STATCAST_URL, attempt, None, repr(exc)) from exc
            policy.sleep(policy.backoff(attempt))
            continue
        if resp.is_success:
            return resp
        retryable = resp.status_code == 429 or (
            RETRYABLE_STATUS_RANGE[0] <= resp.status_code <= RETRYABLE_STATUS_RANGE[1]
        )
        delay = policy.backoff(attempt)
        if resp.status_code == 429:
            delay = _retry_after_seconds(resp) or delay
        resp.close()
        if not retryable:
            # Non-retryable 4xx: fail fast, same contract as raise_for_status.
            resp.raise_for_status()
        if attempt >= policy.attempts:
            raise _exhausted(STATCAST_URL, attempt, resp.status_code, None)
        policy.sleep(delay)


def fetch_game_day(
    day: dt.date,
    client: httpx.Client | None = None,
    retry: RetryPolicy | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield normalized rows for one game day. Paginated by the API's chunking.

    Transient failures (transport errors, 429, 5xx) are retried per `retry`
    (default: 3 attempts, 0.5s exponential backoff, honoring Retry-After on
    429); other 4xx raise immediately.
    """
    policy = retry or RetryPolicy()
    own_client = client or httpx.Client(timeout=60)
    try:
        params = {
            "all": "true",
            "type": "details",
            "game_date_gt": day.isoformat(),
            "game_date_lt": day.isoformat(),
        }
        resp = _open_stream(own_client, params, policy)
        try:
            import csv
            import io

            text = io.TextIOWrapper(io.BufferedReader(_RawReader(resp.iter_bytes())), encoding="utf-8-sig")
            for record in csv.DictReader(text):
                row = _row(record)
                if row is not None:
                    yield row
        finally:
            resp.close()
    finally:
        if client is None:
            own_client.close()
