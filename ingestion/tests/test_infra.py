"""Static verification of infra/main.tf for the Cloud Run serving service.

Terraform is not applied in tests (AGENTS.md: everything runs offline), so
these tests parse the HCL and enforce the invariants the design doc depends
on: scale-to-zero for the free tier, public read access for the web client,
and the untouched $4.00 budget ceiling.
"""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MAIN_TF = REPO / "infra" / "main.tf"


def read() -> str:
    return MAIN_TF.read_text()


def hcl_block(tf: str, header: str) -> str:
    """Return the full brace-balanced block starting with `header`."""
    start = tf.index(header)
    i = tf.index("{", start)
    depth = 0
    for j in range(i, len(tf)):
        if tf[j] == "{":
            depth += 1
        elif tf[j] == "}":
            depth -= 1
            if depth == 0:
                return tf[i : j + 1]
    raise AssertionError(f"unbalanced braces in block at {start}")


def resource_block(tf: str, kind: str, name: str) -> str:
    return hcl_block(tf, f'resource "{kind}" "{name}"')


def strip_comments(block: str) -> str:
    return "\n".join(
        line for line in block.splitlines() if not line.strip().startswith("#")
    )


# ----------------------------------------------------------------- serving


class TestCloudRunServingService:
    def make_tf(self):
        return read()

    def test_service_exists(self):
        tf = self.make_tf()
        assert 'resource "google_cloud_run_v2_service" "serving"' in tf

    def test_name_and_location(self):
        block = resource_block(read(), "google_cloud_run_v2_service", "serving")
        assert 'name     = "statcast-serving"' in block or 'name = "statcast-serving"' in block
        assert "location = var.gcp_region" in block

    def test_ingress_all(self):
        block = resource_block(read(), "google_cloud_run_v2_service", "serving")
        assert re.search(r'ingress\s*=\s*"INGRESS_TRAFFIC_ALL"', block)

    def test_scale_to_zero(self):
        block = resource_block(read(), "google_cloud_run_v2_service", "serving")
        # Scale-to-zero is the free-tier invariant: no idle instances billed.
        assert "min_instance_count = 0" in block
        assert "max_instance_count = 5" in block

    def test_container_config(self):
        block = resource_block(read(), "google_cloud_run_v2_service", "serving")
        assert "image = var.serving_image" in block
        assert re.search(r"containers\s*\{[^}]*ports\s*\{[^}]*container_port = 8080", block, re.S)
        assert "cpu" in block and 'memory = "1Gi"' in block

    def test_env_vars(self):
        block = resource_block(read(), "google_cloud_run_v2_service", "serving")
        assert 'name  = "GCP_PROJECT"' in block or 'name = "GCP_PROJECT"' in block
        assert "value = var.gcp_project" in block
        assert 'value = "http://localhost:5173"' in block


class TestServingIam:
    def test_service_account(self):
        tf = read()
        block = resource_block(tf, "google_service_account", "serving")
        assert 'account_id   = "statcast-serving"' in block or 'account_id = "statcast-serving"' in block
        assert "display_name" in block and "Statcast Arrow serving service" in block

    def test_minimal_iam_roles(self):
        tf = read()
        # The roles must target the serving SA, not the ingest one.
        assert re.search(r"member\s*=\s*\"serviceAccount:\$\{google_service_account\.serving\.email\}\"", tf)
        for role in ("roles/bigquery.dataViewer", "roles/bigquery.jobUser", "roles/storage.objectViewer"):
            assert role in tf, role

    def test_public_invoker(self):
        tf = read()
        block = resource_block(tf, "google_cloud_run_v2_service_iam_member", "serving_public")
        assert re.search(r'role\s*=\s*"roles/run\.invoker"', block)
        assert re.search(r'member\s*=\s*"allUsers"', block)
        assert "google_cloud_run_v2_service.serving.name" in block


class TestServingOutputsAndVariables:
    def test_serving_image_variable(self):
        tf = read()
        block = hcl_block(tf, 'variable "serving_image"')
        assert "type = string" in block

    def test_serving_url_output(self):
        tf = read()
        block = hcl_block(tf, 'output "serving_url"')
        assert "google_cloud_run_v2_service.serving.uri" in block


# ------------------------------------------------- preserved existing infra


class TestExistingInfraPreserved:
    def test_budget_ceiling_is_four_dollars(self):
        tf = read()
        block = resource_block(tf, "google_billing_budget", "hard_ceiling")
        assert 'display_name    = "statcast-lakehouse-ceiling"' in block
        assert "80.0" in block and "100.0" in block
        var_block = hcl_block(tf, 'variable "budget_amount_usd"')
        assert "default = 4.0" in var_block

    def test_ingest_job_and_bucket_still_defined(self):
        tf = read()
        resource_block(tf, "google_cloud_run_v2_job", "ingest")
        resource_block(tf, "google_storage_bucket", "arrow_batches")
        resource_block(tf, "google_cloud_scheduler_job", "ingest_daily")
