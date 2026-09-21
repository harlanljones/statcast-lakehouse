"""Static export of the demo scenarios (Cloudflare Pages has no backend).

The exported .arrow files must be byte-identical to what the API serves, so
the static demo can never drift from /pitches/scenario/{id}.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import serving.app as app_module
from ingestion import scenarios


@pytest.fixture()
def client():
    return TestClient(app_module.app)


def test_export_writes_one_file_per_scenario(tmp_path):
    written = scenarios.export_scenarios(tmp_path)
    assert sorted(p.name for p in written) == sorted(f"{sid}.arrow" for sid in scenarios.SCENARIOS)
    assert all(p.parent == tmp_path and p.stat().st_size > 0 for p in written)


@pytest.mark.parametrize("sid", list(scenarios.SCENARIOS))
def test_exported_bytes_equal_api_bytes(tmp_path, client, sid):
    scenarios.export_scenarios(tmp_path)
    assert (tmp_path / f"{sid}.arrow").read_bytes() == client.get(f"/pitches/scenario/{sid}").content


def test_export_creates_missing_output_dir(tmp_path):
    out = tmp_path / "nested" / "scenarios"
    scenarios.export_scenarios(out)
    assert out.is_dir() and len(list(out.glob("*.arrow"))) == len(scenarios.SCENARIOS)


def test_cli_exports_and_returns_zero(tmp_path, capsys):
    assert scenarios.main(["--out", str(tmp_path)]) == 0
    assert len(list(tmp_path.glob("*.arrow"))) == len(scenarios.SCENARIOS)
    assert "tunnel-vision.arrow" in capsys.readouterr().out
