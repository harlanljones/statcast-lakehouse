FROM python:3.11-slim

WORKDIR /app
COPY ingestion/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ingestion/ ./ingestion/
# Real pitches for --dry-run (the live job does not read them).
COPY data/scenarios/ ./data/scenarios/
COPY warehouse/ddl/03_curate_day.sql ./warehouse/ddl/03_curate_day.sql

# Cloud Run Job entrypoint. Args pass through to the worker.
ENTRYPOINT ["python", "-m", "ingestion.worker"]
