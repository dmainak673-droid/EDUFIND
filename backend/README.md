# EDUFIND Backend

FastAPI backend for the EDUFIND scientific research verification platform. The API follows the camelCase and enum contracts in `../src/types/verification.ts`.

## Phase 1 foundation

Phase 1 adds environment-backed settings, JSON logs, SQLAlchemy 2 engine/session setup, CORS configuration, a health endpoint, a SQLite development database, and Alembic migration scaffolding. There are no database models yet; model and migration work starts with document persistence in Phase 2. Local startup creates the upload directory and any registered model tables.

## Setup (Windows PowerShell)

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The Vite frontend's default API URL already points to `http://127.0.0.1:8000`. Health is available at `GET /api/health`; OpenAPI docs are at `/docs`.

## Database migrations

```powershell
alembic revision --autogenerate -m "add document tables"
alembic upgrade head
```

## Configuration

See `.env.example`. SQLite is the initial local database. Set `DATABASE_URL` to a PostgreSQL SQLAlchemy URL for a PostgreSQL deployment. `CORS_ORIGINS` accepts a comma-separated list. API keys are intentionally blank and must be supplied through environment variables when integrations are implemented.

## Run checks

```powershell
pytest
```

The current backend scope is Phase 1 only. Upload, PDF extraction, analysis, and reports are not implemented yet.

