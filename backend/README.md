# EDUFIND Backend

FastAPI backend for the EDUFIND scientific research verification platform. The API follows the camelCase and enum contracts in `../src/types/verification.ts`.

## Current implementation: Phases 1–2

The backend has environment-backed settings, JSON logs, SQLAlchemy 2 engine/session setup, CORS, a health endpoint, SQLite development support, and Alembic migrations. Document uploads are validated, stored under server-generated names, and extracted page by page with pypdf. Metadata and page text are stored in relational tables.

## Setup (Windows PowerShell)

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
Copy-Item .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The Vite frontend's default API URL already points to `http://127.0.0.1:8000`. Health is available at `GET /api/health`; OpenAPI docs are at `/docs`.

## Database migrations

Use `alembic upgrade head` to create/update the schema. After model changes, create a revision with `alembic revision --autogenerate -m "describe schema change"`, inspect it, then apply with `alembic upgrade head`. Development and test environments also create registered tables on startup; production expects migrations to be applied before starting the API.

## Configuration

See `.env.example`. SQLite is the initial local database. Set `DATABASE_URL` to a PostgreSQL SQLAlchemy URL for a PostgreSQL deployment and install `.[postgres]`. `UPLOAD_DIR` selects the private document storage directory. `MAX_UPLOAD_SIZE_BYTES` defaults to 50 MiB, matching the current frontend's upload limit; `MIN_EXTRACTABLE_TEXT_CHARS` controls when a PDF is flagged as requiring OCR. `CORS_ORIGINS` accepts a comma-separated list. API keys are intentionally blank and must be supplied through environment variables when integrations are implemented.

## Document endpoints

| Method and path | Description |
| --- | --- |
| `POST /api/upload` | Frontend-compatible upload; multipart field is `file`. Returns `document_id`, `filename`, `size`, `title`, page count, and extraction status. |
| `POST /api/documents/upload` | Alias for the frontend-compatible upload route. |
| `GET /api/documents?page=1&pageSize=20` | Paginated document metadata (`pageSize` maximum is 100). |
| `GET /api/documents/{document_id}` | Document metadata, authors, page count, and extraction status. |
| `DELETE /api/documents/{document_id}` | Deletes the record, extracted page rows, and stored PDF. |

Stored PDFs are named with generated UUIDs. Responses never contain filesystem paths. Extraction statuses are `EXTRACTED`, `PARTIAL`, and `OCR_REQUIRED`. Empty pages remain represented with their original page numbers. Scanned-only/low-text PDFs are retained and clearly marked; OCR is not implemented.

## Run checks

```powershell
pytest
```

Pytest uses temporary databases and upload directories and makes no external API calls. The Phase 2 tests cover upload validation, extraction, CRUD, and failed-write cleanup. Gemini verification, citation/claim extraction, analysis polling, and reports are future phases.

