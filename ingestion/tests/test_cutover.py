"""Unit tests for the production GCP cutover harness (infra/cutover.py).

Tests run offline with no network or GCP credentials.
"""
import pytest
from pathlib import Path
from unittest import mock

from infra.cutover import (
    check_terraform,
    check_budget_guards,
    check_warehouse_sql,
    run_preflight,
    parse_eval_metrics,
    main,
    AUC_TARGET_THRESHOLD,
)


class TestCutoverPreflight:
    def test_terraform_check_passes(self):
        res = check_terraform()
        assert res["ok"] is True
        assert res["errors"] == []

    def test_terraform_check_passes_without_cli_binary(self, monkeypatch):
        monkeypatch.setattr("shutil.which", lambda _: None)
        res = check_terraform()
        assert res["ok"] is True
        assert res["errors"] == []

    def test_budget_guards_check_passes(self):
        res = check_budget_guards()
        assert res["ok"] is True
        assert res["errors"] == []

    def test_warehouse_sql_check_passes(self):
        res = check_warehouse_sql()
        assert res["ok"] is True
        assert res["errors"] == []

    def test_run_preflight_overall_pass(self):
        summary = run_preflight()
        assert summary["status"] == "PASS"
        assert summary["errors"] == []


class TestCutoverEvalMetrics:
    def test_auc_above_threshold_meets_target(self):
        row = {
            "roc_auc": 0.742,
            "accuracy": 0.781,
            "log_loss": 0.492,
        }
        res = parse_eval_metrics(row)
        assert res["roc_auc"] == 0.742
        assert res["target_threshold"] == AUC_TARGET_THRESHOLD
        assert res["meets_target"] is True

    def test_auc_below_threshold_fails_target(self):
        row = {
            "roc_auc": 0.651,
            "accuracy": 0.680,
            "log_loss": 0.620,
        }
        res = parse_eval_metrics(row)
        assert res["roc_auc"] == 0.651
        assert res["meets_target"] is False

    def test_missing_auc_defaults_to_zero(self):
        res = parse_eval_metrics({})
        assert res["roc_auc"] == 0.0
        assert res["meets_target"] is False


class TestCutoverCli:
    def test_cli_preflight_success(self, capsys):
        rc = main(["--preflight"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "Preflight verification complete" in out

    def test_cli_live_requires_project_and_billing(self, capsys):
        rc = main(["--live"])
        assert rc == 2
        err = capsys.readouterr().err
        assert "--project and --billing-account" in err

    def test_cli_live_valid_flags(self, capsys):
        rc = main([
            "--live",
            "--project", "test-project-123",
            "--billing-account", "010101-ABCDEF-010101",
            "--date", "2026-09-14",
        ])
        assert rc == 0
        out = capsys.readouterr().out
        assert "test-project-123" in out
