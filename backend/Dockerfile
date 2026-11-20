# Production Dockerfile for EDUFIND FastAPI Backend
FROM python:3.12-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

# Install system dependencies (curl for container healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create dedicated non-root application user and group
RUN groupadd -g 10001 edufind && \
    useradd -u 10001 -g edufind -s /bin/bash -m edufind

# Install Python package dependencies first for optimal Docker layer caching
COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip install ".[postgres]"

# Copy backend application source, alembic migrations, entrypoint, and config
COPY alembic.ini docker-entrypoint.sh ./
COPY app/ ./app/
COPY migrations/ ./migrations/

# Make entrypoint executable, create upload directories, and set permissions
RUN chmod +x docker-entrypoint.sh && \
    mkdir -p /app/uploads/reports && \
    chown -R edufind:edufind /app

# Switch to non-root user
USER edufind

EXPOSE 8000

# Container healthcheck querying the health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
