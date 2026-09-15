terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
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
}

variable "billing_account" {
  type = string
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
