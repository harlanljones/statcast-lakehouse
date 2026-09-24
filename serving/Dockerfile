# Serving layer: FastAPI Arrow IPC over HTTP (Cloud Run service).
# Build: docker build -t statcast-serving -f serving/Dockerfile .
# Run:   docker run -p 8080:8080 -e GCP_PROJECT=<proj> statcast-serving
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY serving/requirements.txt ./serving/requirements.txt
RUN pip install --no-cache-dir -r serving/requirements.txt

# Serving layer plus the ingestion modules it imports (SCHEMA, real-game
# slices) and the checked-in real pitches behind /pitches/sample and scenarios.
COPY serving/ ./serving/
COPY ingestion/worker.py ingestion/scenarios.py ./ingestion/
COPY data/scenarios/ ./data/scenarios/

# Cloud Run expects the service to listen on $PORT (default 8080).
ENV PORT=8080
EXPOSE 8080

# Non-root user for Cloud Run hardening.
RUN useradd --system --no-create-home appuser
USER appuser

CMD ["sh", "-c", "uvicorn serving.app:app --host 0.0.0.0 --port ${PORT}"]
