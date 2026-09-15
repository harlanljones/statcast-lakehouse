"""Dockerfile contract tests (TDD.md: CI must catch container drift).

Verifies the serving image declares its entrypoint, port, and
dependencies — runs fully offline, no docker daemon needed.
"""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = REPO_ROOT / "serving" / "Dockerfile"
REQUIREMENTS = REPO_ROOT / "serving" / "requirements.txt"


def _text() -> str:
    return DOCKERFILE.read_text().lower()


def test_dockerfile_exists() -> None:
    assert DOCKERFILE.is_file(), f"missing {DOCKERFILE}"


def test_dockerfile_uses_slim_python_base() -> None:
    text = _text()
    assert "from python:3.12-slim" in text or "from python:3.11-slim" in text


def test_dockerfile_runs_uvicorn_entrypoint() -> None:
    text = _text()
    assert "uvicorn" in text
    assert "serving.app:app" in text
    assert "--host 0.0.0.0" in text.replace('"', " ").replace("'", " ")


def test_dockerfile_exposes_8080() -> None:
    assert "expose 8080" in _text()


def test_dockerfile_installs_required_dependencies() -> None:
    reqs = REQUIREMENTS.read_text().lower()
    for dep in (
        "fastapi",
        "uvicorn",
        "pyarrow",
        "google-cloud-bigquery",
        "starlette",
    ):
        assert dep in reqs, f"serving/requirements.txt missing {dep}"


def test_dockerfile_copies_serving_and_ingestion_worker() -> None:
    text = _text()
    assert "copy serving/" in text
    assert "ingestion/worker.py" in text
