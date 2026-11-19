# EDUFIND Backend

FastAPI backend for the EDUFIND scientific research verification platform. The API follows the camelCase and enum contracts in `../src/types/verification.ts`.

## Current implementation: Phases 1–6

The backend has environment-backed settings, JSON logs, SQLAlchemy 2 engine/session setup, CORS, a health endpoint, SQLite development support, and Alembic migrations. Document uploads are validated, stored under server-generated names, and extracted page by page with pypdf. Phase 3 adds deterministic scientific-claim and citation extraction; Phase 4 retrieves Crossref/OpenAlex metadata and persists traceable evidence; Phase 5 adds evidence-grounded Gemini claim assessments with structured outputs, persisted verdict history, and evidence-reference validation; Phase 6 orchestrates those stages as one persisted synchronous analysis.

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
Set `GEMINI_API_KEY` in the backend environment to enable AI assessments. `GEMINI_MODEL` defaults to `gemini-3.8-flash`; `GEMINI_TIMEOUT_SECONDS` and `GEMINI_RETRY_ATTEMPTS` set bounded request behavior. The key is never logged or returned. Tests use a mocked provider and do not require a key.

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
| `POST /api/claims/{claim_id}/verify` | Verifies one extracted claim against its associated abstract/full-text evidence records. No assessable text produces a persisted `INSUFFICIENT_EVIDENCE` abstention without an API call. |
| `GET /api/claims/{claim_id}/verification` | Returns the latest persisted claim assessment and validated evidence references. |
| `POST /api/documents/{document_id}/verify` | Starts a synchronous verification run for all extracted claims. An active document run returns `202`; a run can be `COMPLETED`, `PARTIAL`, or `FAILED`. |
| `POST /api/documents/{document_id}/analyze` | Synchronously runs validation, persisted PDF text checks, claim/citation extraction, evidence retrieval, and verification. Returns the persisted analysis and ordered stages. |
| `GET /api/documents/{document_id}/analysis-status` | Returns latest analysis state, current stage, work-based progress, timestamps, retries, warnings, and stage errors. |
| `GET /api/documents/{document_id}/analyses` | Returns the document's analysis history. |
| `GET /api/analyses/{analysis_id}` | Returns consolidated claim, citation, evidence and verification counts, verdict totals, and snapshotted claim assessments. |
| `POST /api/analyses/{analysis_id}/retry` | Retries failed, warning, or stale interrupted analyses while retaining completed earlier stages. |
| `GET /api/documents/{document_id}/verification-status` | Returns the latest verification run state and progress counts. |
| `GET /api/documents/{document_id}/verification-results` | Returns the latest run's stored claim assessments. |
| `GET /api/verifications/{verification_id}` | Returns one run and its results. |

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

## Phase 5 verification behavior and limits

- Gemini calls use Google's `google-genai` SDK with JSON/Pydantic structured output and no tools or browsing. Prompts explicitly treat claims, context, metadata, and abstracts as untrusted data, so embedded instructions cannot override the system instruction.
- Only evidence records already linked to the claim and containing abstract/full-text text are assessable. Metadata-only records are not sent as evidence. The backend validates every model evidence ID against the records supplied for that claim and checks each returned excerpt is present verbatim (whitespace-normalized) in that record; an unknown ID, duplicate ID, or invented excerpt fails that claim rather than being stored.
- The verdicts are `SUPPORTED`, `CONTRADICTED`, `PARTIALLY_SUPPORTED`, `INSUFFICIENT_EVIDENCE`, and `UNVERIFIABLE`. The backend abstains with deterministic `INSUFFICIENT_EVIDENCE` when there is no abstract/full text. `SUPPORTED` requires a validated direct-support excerpt; `CONTRADICTED` requires a validated contradictory excerpt. Otherwise the backend downgrades to insufficient evidence.
- Results preserve the original claim, explanation, support/contradiction/other evidence links, limitations, confidence, evidence availability, timestamp, model, and prompt version. Confidence is confidence in the assessment, not probability that the claim is true. Abstract-only limitations are always added by the backend; no full-text inspection is claimed.
- Runs are synchronous. One active verification run per document is enforced with a unique database key. Document runs save successful claim results and may end `PARTIAL` if individual claims fail; raw provider errors and credentials are never returned. A crashed process may leave a `RUNNING` row requiring operator recovery.
- The existing frontend was not modified. Its current verdict enum does not match Phase 5's five verdicts, so Phase 5 exposes these results only through the new backend endpoints. The existing `GET /api/claims/{claimId}` result contract is still deferred; no verdict is fabricated into it.

## Phase 6 unified analysis pipeline

- The analyze route is synchronous; the API persists each stage before executing it and does not claim background work. A concurrent request reuses the active analysis. A conflicting standalone Phase 3–5 operation receives `409` while unified analysis owns the per-document operation lease. Later submissions after completion create a new history entry.
- Stages run in order: `VALIDATING`, `EXTRACTING`, `EXTRACTING_CLAIMS`, `RETRIEVING_EVIDENCE`, and `VERIFYING`. PDF text extraction already occurs during upload, so `EXTRACTING` validates and reuses the stored page text. Claim/citation extraction, provider retrieval, and Gemini verification reuse Phase 3–5 services and persisted records.
- Stage rows retain attempts, timestamps, and sanitized errors. Heartbeats update the analysis and operation lease during extraction, retrieval, and verification. Progress is the percentage of stages that completed or completed with warnings; skipped and unfinished stages do not inflate it. A dependent `RUNNING` record keeps the analysis active and returns `202`; it is never treated as completed. Partial provider/verification results and documents with no extracted claims can complete with warnings. `INSUFFICIENT_EVIDENCE` remains a valid verification verdict.
- Retry uses a conditional database update, a fresh analysis execution token, and a per-document operation lease. Stage changes, heartbeats, Phase 6 extraction persistence, snapshots, and finalization are fenced by that token; a previous attempt cannot commit or release a later attempt's lease. Stale verification recovery conditionally transitions the run to `FAILED`, clears its active key, and preserves all per-claim results.
- Lease expiry is derived from the configured maximum provider request duration and retry count: the policy covers two sequential research-provider requests or the configured Gemini retry sequence, plus a 60-second database/scheduling margin. Provider calls also renew leases from a separate database session every 30 seconds, and stage callbacks update dependent-run timestamps. A worker paused beyond the calculated expiry can still lose ownership; it must discard pending writes and retry. Migration `20261120_08` adds the nullable execution-token column/index for backward-compatible rollout; new and retried analyses receive a fresh token.
- Analysis snapshots preserve claim text/context/page, verdict, explanation, assessment confidence, evidence IDs and excerpts, relation/rationale, citation/mention provenance, source identifiers, limitations, model, prompt version, and timestamp as JSON independent of mutable phase tables. Migration `20261119_06` adds analysis/history; `20261119_07` adds document operation leases; `20261120_08` adds analysis execution fencing. Existing upload/frontend contracts remain unchanged; this phase adds no frontend integration.

## Run checks

```powershell
pytest
```

Pytest uses temporary databases and upload directories. Phase 6 tests mock Phase 3–5 services and external providers and cover stage completion/active states, stale verification recovery, atomic retry contention, standalone operation conflicts, heartbeats, partial retrieval, insufficient evidence, durable evidence snapshots, migration upgrade/downgrade, duplicate analysis prevention, per-execution fencing, expired-lease takeover, lease renewal, late extraction/retrieval/verification workers, and provider-call heartbeat behavior.

