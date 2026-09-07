# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

# Fail fast and log straight through: buffered output loses the last lines when
# a container is killed, which is exactly when you need them.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first so a code change does not reinstall the world.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Never root. A compromised process should not own the filesystem it runs on.
RUN useradd --create-home --uid 10001 kosine && chown -R kosine:kosine /app
USER kosine

EXPOSE 8000

# The platform's own check should hit /health; this covers plain `docker run`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status==200 else 1)"

# 0.0.0.0, not 127.0.0.1: a container that only listens on loopback is
# unreachable from outside itself. No --reload. Workers stay at 1 by default
# because the rate limiter and OCR quota are per-process — raise it only after
# wiring a shared store, or the limits silently multiply.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1} --proxy-headers --forwarded-allow-ips='*'"]
