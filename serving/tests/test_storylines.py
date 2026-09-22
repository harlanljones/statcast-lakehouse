"""Offline catalog and HTTP contract checks for retrospective pitcher context."""
import datetime as dt
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import serving.app as app_module
from serving.storylines import FIELDS, load_storylines


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("GCP_PROJECT", raising=False)
    return TestClient(app_module.app)


def test_catalog_validates_and_covers_the_four_windows():
    rows = load_storylines()
    assert len(rows) == 15
    windows = {(row["start_date"], row["end_date"]) for row in rows}
    assert windows == {
        ("2024-04-01", "2024-04-30"),
        ("2024-05-01", "2024-05-30"),
        ("2024-07-25", "2024-08-23"),
        ("2024-08-31", "2024-09-29"),
    }
    for start, end in windows:
        assert (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days == 29
    # MLB identities are stable across team changes; do not use current rosters.
    assert {r["player_id"] for r in rows if r["player_name"] == "Ronel Blanco"} == {669854}
    assert {r["player_id"] for r in rows if r["player_name"] == "Jack Flaherty"} == {656427}


@pytest.mark.parametrize("date", ["2024-07-25", "2024-08-23"])
def test_context_window_includes_both_boundaries(client, date):
    response = client.get("/pitches/storylines", params={"date": date})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert {r["player_name"] for r in response.json()} == {
        "Dylan Cease", "Yusei Kikuchi", "Jack Flaherty", "Tanner Scott", "Blake Snell",
    }


@pytest.mark.parametrize("date", ["2024-07-24", "2024-08-24", "2024-06-16"])
def test_outside_context_returns_empty_list(client, date):
    response = client.get("/pitches/storylines", params={"date": date})
    assert response.status_code == 200
    assert response.json() == []


def test_optional_player_filter_matches_mlb_id(client):
    response = client.get(
        "/pitches/storylines", params={"date": "2024-08-02", "player_id": 579328}
    )
    assert response.status_code == 200
    [row] = response.json()
    assert row["player_name"] == "Yusei Kikuchi"
    assert row["event_date"] == "2024-07-29"
    assert set(row) == FIELDS
    assert client.get(
        "/pitches/storylines", params={"date": "2024-08-02", "player_id": 1}
    ).json() == []


def test_award_announcement_is_distinct_from_analysis_window(client):
    [row] = client.get(
        "/pitches/storylines", params={"date": "2024-05-26", "player_id": 519242}
    ).json()
    assert row["end_date"] == "2024-05-30"
    assert row["event_date"] == "2024-06-03"


def test_last_window_does_not_falsely_date_sale_crown_september_29(client):
    [row] = client.get(
        "/pitches/storylines", params={"date": "2024-09-29", "player_id": 519242}
    ).json()
    assert row["event_date"] == "2024-09-30"


@pytest.mark.parametrize("date", ["bad", "20240230", "2024-02-30", "20240401", "2024-W14-1", "2024-4-1"])
def test_date_must_be_valid_canonical_iso(client, date):
    assert client.get("/pitches/storylines", params={"date": date}).status_code == 400


@pytest.mark.parametrize("player_id", ["bad", "0", "-1", "1.5"])
def test_player_filter_must_be_positive_integer(client, player_id):
    assert client.get(
        "/pitches/storylines", params={"date": "2024-04-01", "player_id": player_id}
    ).status_code == 422


def test_date_is_required(client):
    assert client.get("/pitches/storylines").status_code == 422


def test_catalog_matches_warehouse_dimension_columns():
    ddl = (Path(__file__).resolve().parents[2] / "warehouse/ddl/05_player_storylines.sql").read_text()
    body = re.search(r"CREATE TABLE IF NOT EXISTS `[^`]+` \((.*?)\n\)", ddl, re.S).group(1)
    columns = {line.strip().split()[0] for line in body.splitlines() if line.strip()}
    assert columns == FIELDS
    assert "player_id INT64 NOT NULL" in body
    for field in ("start_date", "end_date", "event_date"):
        assert f"{field} DATE NOT NULL" in body


def test_warehouse_export_uses_same_catalog(capsys):
    import runpy

    runpy.run_path(
        str(Path(__file__).resolve().parents[1] / "storylines.py"),
        run_name="__main__",
    )
    exported = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert exported == list(load_storylines())
