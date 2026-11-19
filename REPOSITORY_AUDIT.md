# EDUFIND Repository Audit

Audit date: 2026-11-19  
Audited ref: `main` (repository audit updated through Phase 4)

## A. Existing architecture

The repository contains a React 19 + TypeScript + Vite single-page frontend and a FastAPI backend under `backend/`. The frontend uses React Router, Axios, and Tailwind CSS; `src/api/client.ts` points at `http://127.0.0.1:8000` by default. The backend uses SQLAlchemy, Alembic, SQLite locally, pypdf for page text, deterministic Phase 3 extraction, and Phase 4 Crossref/OpenAlex retrieval.

## B. Frontend API contract

`src/api/verification.ts` defines these calls:

| Method and path | Request | Expected response |
| --- | --- | --- |
| `GET /api/health` | none | `status` and optional `version` strings |
| `POST /api/upload` | multipart field `file` | upload response may use `document_id`, `documentId`, or `id`; filename may use `filename` or `file_name`; size is `size` |
| `GET /api/analysis/{documentId}` | none | `AnalysisStatusResponse` |
| `GET /api/results/{documentId}` | none | `{ document, claims, citations }` |
| `GET /api/claims/{claimId}` | none | `ClaimRecord` |
| `GET /api/citations/{documentId}` | none | `{ document, citations }` |
| `GET /api/reports` | none | `VerificationReport[]` |

Types are in `src/types/verification.ts`. Field names are camelCase. Stage IDs are `UPLOADED`, `EXTRACTING_TEXT`, `EXTRACTING_CLAIMS`, `IDENTIFYING_CITATIONS`, `RETRIEVING_SOURCES`, `ANALYZING_EVIDENCE`, and `GENERATING_REPORT`. Stage states are lowercase `completed`, `active`, `pending`, and `error`. Verdicts are `SUPPORTED`, `PARTIALLY_SUPPORTED`, `UNSUPPORTED`, `CONTRADICTORY`, `POTENTIALLY_OUTDATED`, and `INSUFFICIENT_EVIDENCE`. Evidence availability is `FULL_TEXT`, `ABSTRACT`, or `NONE`.

The frontend normalizes errors from a JSON `detail` field. Upload callers expect `file` and accept `document_id` as the canonical identifier.

## C. Existing features

- A multi-page research verification UI with upload, dashboard, analysis, claim details, citation explorer, reports, and settings screens.
- Typed API wrappers for health, upload, analysis status, results, claim details, citations, and reports.
- Demo data and UI demo mode are present; live health checks and live-data fetch paths are wired into the screens, with demo state available as a fallback. Demo data is frontend data, not backend verification results.
- The app package includes `@google/genai`, but the audited frontend API path does not implement a server-side verification pipeline.

The backend does not implement Gemini verification, OCR, full-text retrieval, analysis polling, reports, or the frontend's claim detail response with verdict fields. PyMuPDF is not used.

## D. Missing backend features

The remaining backend capabilities include Gemini verification, OCR/full-text retrieval, pipeline orchestration and polling, result/report routes, and the frontend's claim detail endpoint. Phase 4 adds external scholarly metadata retrieval and traceable evidence records but does not verify claims.

## E. Integration risks

- The UI types are the contract; backend serialization must use camelCase and preserve the exact enum strings above.
- The health wrapper only needs a string `status`; returning `status: "ok"` and a version is compatible.
- Upload should return `document_id`, `filename`, `size`, and `title` while retaining the multipart field `file`.
- No analysis-start API is present in `verification.ts`; avoid relying on it until a frontend call is added.
- `src/data/demoData.ts` is frontend-only and must not become a source of backend verification claims.
- The frontend may render optional fields as absent; backend schemas should keep optional properties optional.

## F. Recommended implementation sequence

1. Phase 1: configuration, database foundation, health endpoint, and backend setup documentation.
2. Phase 2: document model, secure upload/storage, pypdf extraction, and document APIs.
3. Phase 3: schema-validated claim extraction and citation parsing with traceability.
4. Phase 4: Crossref/OpenAlex clients, caching, and explicit evidence availability.
5. Phase 5: evidence-grounded Gemini verification and quotation validation.
6. Phase 6: persisted seven-stage orchestration and polling response.
7. Phase 7: results, citations, claims, and report APIs matching frontend types.
8. Phase 8: broadened security, integration tests, performance review, and operational docs.

## G. Phase 1 files

- `backend/pyproject.toml`: Python dependencies and tooling configuration.
- `backend/.env.example`: backend settings without secrets.
- `backend/app/core/config.py`: environment-backed settings.
- `backend/app/core/logging.py`: safe structured logging setup.
- `backend/app/db/base.py` and `backend/app/db/session.py`: SQLAlchemy base and session lifecycle.
- `backend/app/api/routes/health.py`: health endpoint.
- `backend/app/main.py`: FastAPI app, CORS, and database lifespan.
- `backend/tests/test_health.py`: health route contract test.
- `backend/README.md`: setup and Phase 1 architecture notes.

## Phase 2 implementation update (2026-11-19)

- Added SQLAlchemy `documents` and `document_pages` tables, constraints, indexes, cascade behavior, and an Alembic revision. SQLite foreign-key enforcement is enabled.
- Added bounded chunked upload handling with a 50 MiB default cap, `.pdf` filename requirement, `%PDF-` signature check, generated UUID storage names, rollback cleanup, and sanitized client errors.
- Added pypdf metadata and per-page text extraction. Empty pages are preserved. Low/no-text files are retained with `OCR_REQUIRED`; mixed text/empty-page files use `PARTIAL`. OCR is not claimed or implemented.
- Added frontend-compatible `POST /api/upload` plus `POST /api/documents/upload`, and paginated list, detail, and delete endpoints. Existing frontend upload response keys (`document_id`, `filename`, `size`, `title`) and multipart field `file` are retained; document results serialize camelCase fields.
- Added isolated test fixtures and tests for signatures, empty/oversized/malformed/encrypted inputs, extraction, metadata, OCR-needed status, duplicate names/path traversal, CRUD, pagination, and upload cleanup on database failure.
- Validation status: Python syntax and TOML checks passed; Alembic `upgrade head` and `downgrade base` both passed against a temporary SQLite database; `git diff --check` passed; pytest passed with 18 tests and one upstream Starlette/AnyIO deprecation warning. The test run used the available Python 3.14 runtime with its working Pydantic installation and a workspace-local pytest temp directory.

## Phase 3 implementation update (2026-11-19)

- Added `Claim`, `Citation`, `CitationMention`, `ClaimCitation`, and one-per-document `ExtractionRun` models with indexes, uniqueness/check constraints, and document-delete cascades. Added Alembic revision `20261119_03_claim_citation_extraction.py` without changing earlier revisions.
- Added deterministic, dependency-free claim selection; numbered and author-year citation detection; reference-section splitting; conservative bibliography/DOI parsing; alias matching that preserves ambiguity; and transactional persistence. Extraction is idempotent after completion and failed runs can be retried.
- Added APIs for extraction trigger/status, document claim records, raw citation records, claim/citation links, and the existing frontend citation wrapper. Citation links are explicitly detected mentions, never verified evidence. Existing upload, document CRUD, health, frontend enums, and frontend files are unchanged.
- Validation status: all 32 backend tests passed (one upstream Starlette/AnyIO deprecation warning); Alembic upgrade to head and downgrade to base passed; Python syntax/TOML checks and `git diff --check` passed.
- Limitations: extraction is deterministic and heuristic, bibliography parsing is incomplete by design, no external resolution or evidence verification is performed, OCR is unavailable, and `/api/claims/{claimId}` remains deferred because the frontend's claim detail type requires verification fields.

## Phase 4 implementation update (2026-11-19)

- Added Crossref REST API v1 and OpenAlex Works API clients with DOI lookups and bounded bibliographic searches, optional configuration, request timeouts, retry/backoff, descriptive User-Agent, Crossref `mailto`, and defensive parsing of incomplete provider responses. Automated tests mock all HTTP.
- Added DOI normalization/validation and deterministic citation matching. Matches report score, method, and `MATCHED`/`POSSIBLE`/`UNMATCHED`; metadata similarity never creates a scientific verdict.
- Added `research_sources`, `source_identifiers`, `source_matches`, `evidence_records`, and `evidence_retrieval_runs`, with indexes, foreign keys, uniqueness/check constraints, UTC timestamps, document/citation/claim cascades, and migration `20261119_04`.
- Added synchronous, idempotent retrieval with explicit `ABSTRACT`, `METADATA_ONLY`, and `UNAVAILABLE` records. Claim/citation and citation mention page/text provenance are preserved. OpenAlex abstracts are reconstructed from returned inverted indexes; no full text or Gemini is used.
- Added POST retrieval, GET status, document/claim evidence, citation matches, and source detail endpoints. Existing frontend citation API returns bibliography matches and abstracts where available. Its `resolved` value means metadata match only. No frontend files changed; claim verdict detail remains deferred.
- Limits: synchronous requests, no full-text/OCR, provider completeness varies, title-based matches may be uncertain, and claim verification is out of scope.

## Phase 5 implementation update (2026-11-19)

- Added the isolated official `google-genai` SDK provider using Pydantic structured JSON, configured model/API key/timeout/retry settings, no tools or browsing, sanitized provider errors, and bounded retries for transient failures.
- Added evidence-grounded claim and document verification with five verdict categories. Abstract/full-text evidence must already be linked to the claim. Metadata-only records are excluded as evidence; missing assessable text produces a deterministic `INSUFFICIENT_EVIDENCE` result without an API call.
- Added server-side evidence ID validation and exact excerpt checks before persistence. A supported verdict requires a direct-support record; a contradicted verdict requires a contradictory record. Unsupported references or excerpts fail that claim and do not persist a verdict.
- Added `verification_runs`, `verification_results`, and `verification_evidence_links` with foreign keys, checks, indexes, per-document active-run uniqueness, result history, and cascade deletion; migration `20261119_05` preserves prior records.
- Added claim verify/result, document verify/status/results, and verification-by-ID endpoints. Existing frontend files and previous endpoints are unchanged; the current frontend verdict union does not match Phase 5's verdicts, so no frontend integration was attempted.
- Tests mock Gemini and require no key. Abstract-only evidence is labeled, confidence is assessment confidence rather than truth probability, and full-text inspection is not claimed. Runs remain synchronous and may need recovery after process interruption.

