# EDUFIND Backend

FastAPI backend for the EDUFIND scientific research verification platform. The API follows the camelCase and enum contracts in `../src/types/verification.ts`.

## Current implementation: Phases 1–4

The backend has environment-backed settings, JSON logs, SQLAlchemy 2 engine/session setup, CORS, a health endpoint, SQLite development support, and Alembic migrations. Document uploads are validated, stored under server-generated names, and extracted page by page with pypdf. Phase 3 adds deterministic scientific-claim and citation extraction, bibliography parsing, citation mentions, claim/citation links, and persisted extraction status. Phase 4 retrieves scholarly metadata from Crossref and OpenAlex, scores citation-to-source matches, and persists abstract or metadata evidence with claim/citation/page provenance.

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

See `.env.example`. SQLite is the initial local database. Set `DATABASE_URL` to a PostgreSQL SQLAlchemy URL for a PostgreSQL deployment and install `.[postgres]`. `UPLOAD_DIR` selects the private document storage directory. `MAX_UPLOAD_SIZE_BYTES` defaults to 50 MiB, matching the current frontend's upload limit; `MIN_EXTRACTABLE_TEXT_CHARS` controls when a PDF is flagged as requiring OCR. `CORS_ORIGINS` accepts a comma-separated list. Crossref is public and requires no key; set `CROSSREF_MAILTO` to use its polite pool. OpenAlex works without a key for light usage; `OPENALEX_API_KEY` is optional. `CROSSREF_API_URL`, `OPENALEX_API_URL`, `RESEARCH_HTTP_TIMEOUT_SECONDS`, and `RESEARCH_RETRY_ATTEMPTS` configure provider clients. Requests use finite timeouts, bounded retries/backoff, and a descriptive User-Agent. Credentials are not returned in API responses or logs.

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
| `GET /api/citations/{document_id}` | Frontend-compatible citation view with resolved metadata/evidence availability when retrieval has been run. `resolved` means a bibliographic match, not scientific verification. |
| `POST /api/documents/{document_id}/retrieve-evidence` | Retrieves Crossref/OpenAlex metadata for Phase 3 citations, matches likely scholarly sources, and stores per-claim evidence. Completed requests are idempotent. |
| `GET /api/documents/{document_id}/evidence-status` | Returns `NOT_STARTED`, `RUNNING`, `COMPLETED`, `PARTIAL`, or `FAILED` retrieval status and counts. |
| `GET /api/documents/{document_id}/evidence` | Returns persisted evidence with claim, citation, page mention, source, and availability provenance. |
| `GET /api/claims/{claim_id}/evidence` | Returns retrieved records associated with one claim. |
| `GET /api/citations/{citation_id}/matches` | Returns candidate source matches, transparent score, method, and match status. |
| `GET /api/sources/{source_id}` | Returns cached publication metadata, abstracts when supplied, and provider/DOI identifiers. |

Stored PDFs are named with generated UUIDs. Responses never contain filesystem paths. Extraction statuses are `EXTRACTED`, `PARTIAL`, and `OCR_REQUIRED`. Empty pages remain represented with their original page numbers. Scanned-only/low-text PDFs are retained and clearly marked; OCR is not implemented.

## Phase 3 extraction behavior and limits

- `claims`, `citations`, `citation_mentions`, `claim_citations`, and `extraction_runs` are persisted in relational tables. Document deletion cascades through the extraction data.
- Claim selection uses deterministic language and numeric/statistical cues. `confidenceScore` describes heuristic selection strength only; it is not model confidence or scientific verification. Original claim text and paragraph context are retained from the extracted page.
- Numbered and common author-year citations are recognized. Bibliography parsing preserves each raw entry and stores DOI, author, year, title, or journal only when the parser can identify them. Incomplete entries remain visible with missing metadata unset.
- A claim is linked only to citation mentions within that claim sentence. Proximity to a bibliography entry or nearby text is not treated as support. `isVerifiedEvidence` is always `false` in Phases 3–4.
- The trigger runs synchronously and is idempotent after completion. Failed runs can be retried. A process interruption while a run is `RUNNING` requires operational recovery; there is no background worker yet.
- The existing frontend's `/api/claims/{claimId}` detail type requires verification verdict fields. That endpoint remains for the later evidence-verification phase rather than returning fabricated verdicts now.

## Phase 4 source matching and evidence limits

- Crossref and OpenAlex are queried through official JSON APIs. Crossref is identified with a configurable User-Agent and optional `mailto`; requests are serialized and paced to the public pool's published limit within each API process. OpenAlex's API key is optional. DOI values are validated and normalized before lookup. DOI-less citations use bounded bibliographic searches.
- Publication records are deduplicated by normalized DOI and provider identifiers. Provider payloads and normalized fields are cached in `research_sources`; completed document runs are idempotent. Failed and partial runs can be retried.
- Match scores use exact DOI matching or a weighted combination of normalized title similarity (65%), author agreement (15%), year (12%), and journal similarity (8%). `MATCHED` requires a score of at least 0.78 and title similarity of at least 0.88; other candidates remain `POSSIBLE` or `UNMATCHED`. Scores indicate bibliographic identity only.
- The frontend-compatible citation field `resolved` reports a matched publication record only. It must not be read as a support/veracity verdict; the backend does not generate verification verdicts in Phase 4.
- Evidence availability is `ABSTRACT`, `METADATA_ONLY`, or `UNAVAILABLE`. OpenAlex abstracts are reconstructed from its inverted index. Crossref abstract text is retained only when the provider returns it. No full text is fetched. Metadata/abstract availability never constitutes a verification verdict or proof of claim support.
- Evidence rows preserve claim, source citation, source, and original citation mention page/text provenance. Unmatched claims with citation links receive explicit `UNAVAILABLE` rows. Claims without linked citations have no evidence rows.
- Provider timeouts, invalid JSON, HTTP failures, and rate limits are handled with bounded retries and sanitized errors. External API tests use mocked responses; normal pytest makes no network requests.
- Retrieval runs synchronously in the API process. A `RUNNING` row prevents duplicate submissions, but process interruption can leave a run requiring retry/recovery. No background worker is included.

## Run checks

```powershell
pytest
```

Pytest uses temporary databases and upload directories and makes no external API calls. Tests cover health/configuration, PDF/document management, extraction, provider response parsing, DOI validation, timeout/rate-limit handling, source matching, evidence persistence/idempotency, API responses, and cascades. Gemini verification, analysis polling, and reports are future phases.

