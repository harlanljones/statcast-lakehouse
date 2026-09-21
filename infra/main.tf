terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project               = var.gcp_project
  region                = var.gcp_region
  user_project_override = true
  billing_project       = var.gcp_project
}

variable "gcp_project" {
  type = string
}

variable "gcp_region" {
  type    = string
  default = "us-central1"
}

variable "budget_amount_usd" {
  type    = number
  default = 4.0 # TDD §7 hard ceiling; alert fires at 80% and 100%
}

variable "worker_image" {
  type = string
}

variable "serving_image" {
  type = string
}

# ---- BigQuery ----

resource "google_bigquery_dataset" "statcast" {
  dataset_id    = "statcast_analytics"
  friendly_name = "Statcast Lakehouse"
  location      = "US"
}

# Table DDL lives in warehouse/ddl/*.sql (executed via bq CLI or a
# terraform_data local-exec step) because partition/cluster options in the
# provider drift from the console; the DDL files are the source of truth.

# ---- Budget guard (TDD §7) ----

resource "google_billing_budget" "hard_ceiling" {
  billing_account = var.billing_account
  display_name    = "statcast-lakehouse-ceiling"

  budget_filter {
    projects = ["projects/${var.gcp_project}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_amount_usd)
    }
  }

  threshold_rules {
    threshold_percent = 80.0
  }
  threshold_rules {
    threshold_percent = 100.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.billing_alerts.id
    schema_version = "1.0"
  }
}

resource "google_pubsub_topic" "billing_alerts" {
  name    = "statcast-billing-alerts"
  project = var.gcp_project
}

variable "billing_account" {
  type = string
}

# ---- Cloud Storage: historical Arrow batch exports (TDD §4.1) ----

resource "google_storage_bucket" "arrow_batches" {
  name          = "${var.gcp_project}-statcast-arrow-batches"
  location      = "US"
  storage_class = "STANDARD"

  uniform_bucket_level_access = true

  # Free-tier headroom: TDD §7 budgets ~500 MB of Arrow files against the
  # 5 GB Standard allowance; batches tier to Nearline at 30 days and are
  # deleted at 365. Table retention is longer (1095 days), but Nearline is
  # outside the free tier, so exported batches are not kept as long.
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }
  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type = "Delete"
    }
  }

  versioning {
    enabled = false
  }
}

resource "google_storage_bucket_iam_member" "ingest_writer" {
  bucket = google_storage_bucket.arrow_batches.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ingest.email}"
}

# ---- Cloud Run Job: ingestion worker ----

resource "google_cloud_run_v2_job" "ingest" {
  name     = "statcast-ingest-worker"
  location = var.gcp_region

  template {
    template {
      service_account = google_service_account.ingest.email
      containers {
        image = var.worker_image
        args  = ["--live", "--date", "$(JOB_DATE)"]
        env {
          name  = "GCP_PROJECT"
          value = var.gcp_project
        }
        resources {
          limits = {
            memory = "1Gi"
            cpu    = "1"
          }
        }
      }
    }
  }
}

resource "google_service_account" "ingest" {
  account_id   = "statcast-ingest"
  display_name = "Statcast ingestion worker"
}

resource "google_project_iam_member" "ingest_bq" {
  for_each = toset([
    "roles/bigquery.dataEditor",
    "roles/bigquery.jobUser",
  ])
  project = var.gcp_project
  role    = each.key
  member  = "serviceAccount:${google_service_account.ingest.email}"
}

# Scheduler: daily 09:00 UTC (overnight games finished, 180k vCPU-s
# free allocation covers a ~2 min job easily).
resource "google_cloud_scheduler_job" "ingest_daily" {
  name             = "statcast-ingest-daily"
  region           = var.gcp_region
  schedule         = "0 9 * * *"
  attempt_deadline = "600s"

  http_target {
    http_method = "POST"
    uri         = "https://${var.gcp_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.gcp_project}/jobs/statcast-ingest-worker:run"
    oauth_token {
      service_account_email = google_service_account.ingest.email
    }
  }
}

output "dataset_id" {
  value = google_bigquery_dataset.statcast.dataset_id
}

# ---- Cloud Run service: Arrow serving API ----

resource "google_service_account" "serving" {
  account_id   = "statcast-serving"
  display_name = "Statcast Arrow serving service"
}

# Read-only warehouse/GCS access is the minimum needed to answer queries;
# no writer roles on the serving path.
resource "google_project_iam_member" "serving_read" {
  for_each = toset([
    "roles/bigquery.dataViewer",
    "roles/bigquery.jobUser",
    "roles/storage.objectViewer", # historical GCS partition reading
  ])
  project = var.gcp_project
  role    = each.key
  member  = "serviceAccount:${google_service_account.serving.email}"
}

# min_instance_count = 0 keeps the free tier intact: idle requests bill nothing.
resource "google_cloud_run_v2_service" "serving" {
  name     = "statcast-serving"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      image = var.serving_image
      ports {
        container_port = 8080
      }
      env {
        name  = "GCP_PROJECT"
        value = var.gcp_project
      }
      env {
        name  = "ALLOWED_ORIGINS"
        value = "http://localhost:5173"
      }
      resources {
        limits = {
          memory = "1Gi"
          cpu    = "1"
        }
      }
    }
  }
}

# Public HTTP access for the browser-based visualizer; the service itself
# enforces CORS via ALLOWED_ORIGINS.
resource "google_cloud_run_v2_service_iam_member" "serving_public" {
  name     = google_cloud_run_v2_service.serving.name
  location = google_cloud_run_v2_service.serving.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "serving_url" {
  value = google_cloud_run_v2_service.serving.uri
}
