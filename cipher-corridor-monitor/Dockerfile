# ── Cipher Corridor Monitor — cloud deployment image ─────────────────────────
# Self-contained: Flask SPA server + analytical pipeline + benchmark dataset.
# Cloud platforms (Hugging Face Spaces / Railway / Fly.io) build this directly.
# The server already honors CHM_BIND / CHM_PORT env vars — no code changes needed.

FROM python:3.11-slim

# HF Spaces runs containers as UID 1000; create a matching user and writable dirs.
RUN useradd -m -u 1000 user

WORKDIR /app

# Install dependencies first for layer caching.
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Full application (backend, frontend, pipeline, benchmark dataset).
COPY . /app

# Runtime artifacts (audit ledger, benchmark snapshot, regenerated parquet/json)
# must be writable by UID 1000.
RUN mkdir -p /app/backend/benchmark_snapshot && \
    chown -R user:user /app

USER user

ENV CHM_BIND=0.0.0.0 \
    CHM_PORT=7860 \
    PYTHONUNBUFFERED=1

EXPOSE 7860

CMD ["python", "backend/server.py"]
