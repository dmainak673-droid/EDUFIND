# EDUFIND Backend

FastAPI backend for the EDUFIND scientific research verification platform. The API follows the camelCase and enum contracts in `../src/types/verification.ts`.

## Current implementation: Phases 1–3

The backend has environment-backed settings, JSON logs, SQLAlchemy 2 engine/session setup, CORS, a health endpoint, SQLite development support, and Alembic migrations. Document uploads are validated, stored under server-generated names, and extracted page by page with pypdf. Phase 3 adds deterministic scientific-claim and citation extraction, bibliography parsing, citation mentions, claim/citation links, and persisted extraction status.

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
| `POST /api/documents/{document_id}/extract` | Starts deterministic claim and citation extraction. Repeated requests return the existing completed run; an active run returns `202`. |
| `GET /api/documents/{document_id}/extraction-status` | Returns `NOT_STARTED`, `RUNNING`, `COMPLETED`, or `FAILED`, with counts and timestamps. |
| `GET /api/documents/{document_id}/claims` | Returns extracted claim text, page context, rule-based confidence, method, and detected citation IDs. |
| `GET /api/documents/{document_id}/citations` | Returns raw bibliography/in-text citation records, parsed metadata when available, mention pages, and matching status. |
| `GET /api/documents/{document_id}/claim-citations` | Returns page-level links for citations that appear inside a claim's source sentence. Links explicitly indicate that they are not verified evidence. |
| `GET /api/citations/{document_id}` | Frontend-compatible citation view. Citations remain unresolved with evidence availability `NONE` until source retrieval is implemented. |

Stored PDFs are named with generated UUIDs. Responses never contain filesystem paths. Extraction statuses are `EXTRACTED`, `PARTIAL`, and `OCR_REQUIRED`. Empty pages remain represented with their original page numbers. Scanned-only/low-text PDFs are retained and clearly marked; OCR is not implemented.

## Phase 3 extraction behavior and limits

- `claims`, `citations`, `citation_mentions`, `claim_citations`, and `extraction_runs` are persisted in relational tables. Document deletion cascades through the extraction data.
- Claim selection uses deterministic language and numeric/statistical cues. `confidenceScore` describes heuristic selection strength only; it is not model confidence or scientific verification. Original claim text and paragraph context are retained from the extracted page.
- Numbered and common author-year citations are recognized. Bibliography parsing preserves each raw entry and stores DOI, author, year, title, or journal only when the parser can identify them. Incomplete entries remain visible with missing metadata unset.
- A claim is linked only to citation mentions within that claim sentence. Proximity to a bibliography entry or nearby text is not treated as support. `isVerifiedEvidence` is always `false` in this phase.
- The trigger runs synchronously and is idempotent after completion. Failed runs can be retried. A process interruption while a run is `RUNNING` requires operational recovery; there is no background worker yet.
- The existing frontend's `/api/claims/{claimId}` detail type requires verification verdict fields. That endpoint remains for the later evidence-verification phase rather than returning fabricated verdicts now.

## Run checks

```powershell
pytest
```

Pytest uses temporary databases and upload directories and makes no external API calls. Current tests cover Phase 1 health/configuration, Phase 2 upload/PDF/document management, and Phase 3 extraction, citation matching, status, retry, and cascade behavior. Gemini verification, source resolution, analysis polling, and reports are future phases.

