#!/bin/sh
set -e

# Automatically run Alembic migrations on startup if enabled
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
    echo "Applying Alembic database migrations..."
    alembic upgrade head
    echo "Migrations applied successfully."
fi

exec "$@"
