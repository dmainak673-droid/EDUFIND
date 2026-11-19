# EDUFIND Repository Audit

Audit date: 2026-11-19  
Audited ref: `main` (`8ca67ee002b96ab800c5c0b46b4e843207ca3b4b`)

## A. Existing architecture

The repository is a React 19 + TypeScript + Vite single-page frontend. It uses React Router, Axios, and Tailwind CSS. `src/api/client.ts` points at `http://127.0.0.1:8000` by default. There is no backend directory, Python project metadata, requirements file, database, migration setup, or backend test suite in the audited revision.

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

No PDF extraction engine exists in this repository at the audited revision. The brief's note about an existing `pypdf` migration does not match this checkout; Phase 2 will introduce pypdf unless later repository history or files establish otherwise. PyMuPDF will not be introduced.

## D. Missing backend features

All backend capabilities are missing: FastAPI app, configuration, persistence, migrations, document upload/storage, pypdf extraction, claim and citation extraction, scholarly-source clients, evidence retrieval, Gemini verification, pipeline orchestration, result/report routes, security controls, and backend tests.

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

