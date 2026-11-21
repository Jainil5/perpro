# MyOS API (Phase 1) — python:3.12-slim, non-root, Alembic-owned schema.
#
#   docker build -t myos-api backend/          (or `docker compose build api` from the root)
#   docker run -p 8000:8000 -v myos-data:/data myos-api
#
# The container talks to /api/v1 only; the Next.js proxy in front of it is the only
# caller, so no CORS middleware is configured (ARCHITECTURE.md §1).

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# dependencies first: this layer survives app-source edits
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# `myos` cannot write anywhere else: /app is read-only source, /data is the database
RUN groupadd --system myos \
    && useradd --system --uid 10001 --gid myos --home-dir /home/myos --shell /usr/sbin/nologin myos \
    && mkdir -p /data \
    && chown -R myos:myos /app /data

USER myos
ENV HOME=/home/myos

# Production configuration: Alembic owns the schema, so startup does not create tables.
# Compose overrides these; the values here are sane for `docker run -v myos-data:/data`.
ENV MYOS_DATA_DIR=/data \
    MYOS_DATABASE_URL=sqlite:////data/myos.db \
    MYOS_AUTO_CREATE=0

EXPOSE 8000

# Migrate, then serve. `exec` hands SIGTERM to uvicorn so Ctrl-C stops cleanly.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port \"${MYOS_PORT:-8000}\""]
