FROM python:3.11-slim

WORKDIR /app
COPY ingestion/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ingestion/ ./ingestion/

# Cloud Run Job entrypoint. Args pass through to the worker.
ENTRYPOINT ["python", "-m", "ingestion.worker"]
