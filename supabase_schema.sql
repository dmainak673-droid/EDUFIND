-- EDUFIND PostgreSQL Complete Schema for Supabase
-- Paste this directly into the Supabase SQL Editor and click "Run".

-- 1. Documents & Pages
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(36) PRIMARY KEY,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(40) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    authors JSONB NOT NULL DEFAULT '[]'::jsonb,
    pdf_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
    extraction_status VARCHAR(24) NOT NULL CHECK (extraction_status IN ('EXTRACTED', 'PARTIAL', 'OCR_REQUIRED')),
    extraction_warning TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS ix_documents_created_at ON documents (created_at);

CREATE TABLE IF NOT EXISTS document_pages (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    extracted_text TEXT NOT NULL DEFAULT '',
    CONSTRAINT uq_document_pages_document_page UNIQUE (document_id, page_number)
);
CREATE INDEX IF NOT EXISTS ix_document_pages_document_id ON document_pages (document_id);

-- 2. Extraction Runs, Claims & Citations
CREATE TABLE IF NOT EXISTS extraction_runs (
    id VARCHAR(36) PRIMARY KEY,
    document_id VARCHAR(36) NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('NOT_STARTED', 'RUNNING', 'COMPLETED', 'FAILED')),
    method VARCHAR(32) NOT NULL DEFAULT 'RULE_BASED',
    claim_count INTEGER NOT NULL DEFAULT 0,
    citation_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS claims (
    id VARCHAR(36) PRIMARY KEY,
    document_id VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    claim_text TEXT NOT NULL,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    paragraph_context TEXT,
    confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    method VARCHAR(32) NOT NULL DEFAULT 'RULE_BASED',
    extraction_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS ix_claims_document_id ON claims (document_id);

CREATE TABLE IF NOT EXISTS citations (
    id VARCHAR(36) PRIMARY KEY,
    document_id VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    cleaned_text TEXT,
    doi VARCHAR(255),
    authors JSONB DEFAULT '[]'::jsonb,
    year INTEGER,
    title VARCHAR(500),
    journal VARCHAR(255),
    volume VARCHAR(50),
    issue VARCHAR(50),
    pages VARCHAR(50),
    url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS ix_citations_document_id ON citations (document_id);

CREATE TABLE IF NOT EXISTS citation_mentions (
    id SERIAL PRIMARY KEY,
    citation_id VARCHAR(36) NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
    document_id VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    mention_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS claim_citations (
    id SERIAL PRIMARY KEY,
    claim_id VARCHAR(36) NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    citation_id VARCHAR(36) NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
    citation_mention_id INTEGER REFERENCES citation_mentions(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_claim_citations UNIQUE (claim_id, citation_id, page_number)
);

-- 3. External Research & Evidence Records
CREATE TABLE IF NOT EXISTS research_sources (
    id VARCHAR(36) PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    identifier VARCHAR(255) NOT NULL,
    doi VARCHAR(255),
    title VARCHAR(500),
    authors JSONB DEFAULT '[]'::jsonb,
    journal VARCHAR(255),
    publication_date VARCHAR(64),
    publication_year INTEGER,
    publication_type VARCHAR(64),
    abstract TEXT,
    url TEXT,
    raw JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_research_sources_provider_id UNIQUE (provider, identifier)
);
CREATE INDEX IF NOT EXISTS ix_research_sources_doi ON research_sources (doi);

CREATE TABLE IF NOT EXISTS source_identifiers (
    id SERIAL PRIMARY KEY,
    source_id VARCHAR(36) NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    identifier VARCHAR(255) NOT NULL,
    CONSTRAINT uq_source_identifiers UNIQUE (source_id, provider, identifier)
);

CREATE TABLE IF NOT EXISTS source_matches (
    id SERIAL PRIMARY KEY,
    citation_id VARCHAR(36) NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
    source_id VARCHAR(36) NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
    score DOUBLE PRECISION NOT NULL,
    status VARCHAR(20) NOT NULL,
    method VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_source_matches UNIQUE (citation_id, source_id)
);

CREATE TABLE IF NOT EXISTS evidence_retrieval_runs (
    id VARCHAR(36) PRIMARY KEY,
    document_id VARCHAR(36) NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    citations_processed INTEGER NOT NULL DEFAULT 0,
    records_retrieved INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS evidence_records (
    id VARCHAR(36) PRIMARY KEY,
    claim_id VARCHAR(36) NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    citation_id VARCHAR(36) NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
    source_id VARCHAR(36) REFERENCES research_sources(id) ON DELETE SET NULL,
    excerpt TEXT,
    relation VARCHAR(32) NOT NULL DEFAULT 'UNSPECIFIED',
    rationale TEXT,
    evidence_availability VARCHAR(32) NOT NULL DEFAULT 'UNAVAILABLE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS ix_evidence_records_claim_id ON evidence_records (claim_id);

-- 4. Verification Runs & Verdicts
CREATE TABLE IF NOT EXISTS verification_runs (
    id VARCHAR(36) PRIMARY KEY,
    document_id VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    claims_verified INTEGER NOT NULL DEFAULT 0,
    model_identifier VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS verification_results (
    id VARCHAR(36) PRIMARY KEY,
    verification_run_id VARCHAR(36) NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,
    claim_id VARCHAR(36) NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    verdict VARCHAR(32) NOT NULL,
    confidence_score DOUBLE PRECISION,
    explanation TEXT,
    limitations JSONB DEFAULT '[]'::jsonb,
    evidence_availability VARCHAR(32) NOT NULL DEFAULT 'UNAVAILABLE',
    model_identifier VARCHAR(120),
    prompt_version VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS ix_verification_results_claim_id ON verification_results (claim_id);

CREATE TABLE IF NOT EXISTS verification_evidence_links (
    id SERIAL PRIMARY KEY,
    verification_result_id VARCHAR(36) NOT NULL REFERENCES verification_results(id) ON DELETE CASCADE,
    evidence_record_id VARCHAR(36) NOT NULL REFERENCES evidence_records(id) ON DELETE CASCADE,
    verbatim_excerpt TEXT NOT NULL,
    CONSTRAINT uq_verification_evidence_links UNIQUE (verification_result_id, evidence_record_id)
);

-- 5. Unified Analysis Pipeline & Fencing Leases
CREATE TABLE IF NOT EXISTS document_operation_leases (
    document_id VARCHAR(36) PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    owner_id VARCHAR(36) NOT NULL,
    operation VARCHAR(32) NOT NULL,
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS analysis_runs (
    id VARCHAR(36) PRIMARY KEY,
    execution_token VARCHAR(36),
    document_id VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    active_document_id VARCHAR(36) UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL CHECK (status IN ('QUEUED','VALIDATING','EXTRACTING','EXTRACTING_CLAIMS','RETRIEVING_EVIDENCE','VERIFYING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED')),
    current_stage VARCHAR(32),
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    retry_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    claims_detected INTEGER NOT NULL DEFAULT 0,
    citations_identified INTEGER NOT NULL DEFAULT 0,
    evidence_records INTEGER NOT NULL DEFAULT 0,
    verification_results INTEGER NOT NULL DEFAULT 0,
    verdict_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    verdict_details JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS ix_analysis_runs_document_created ON analysis_runs (document_id, created_at);
CREATE INDEX IF NOT EXISTS ix_analysis_runs_execution_token ON analysis_runs (execution_token);

CREATE TABLE IF NOT EXISTS analysis_stage_executions (
    id VARCHAR(36) PRIMARY KEY,
    analysis_id VARCHAR(36) NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    stage_key VARCHAR(32) NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','SKIPPED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    output_run_id VARCHAR(36),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_code VARCHAR(48),
    error_message TEXT,
    CONSTRAINT uq_analysis_stage_key UNIQUE (analysis_id, stage_key)
);
CREATE INDEX IF NOT EXISTS ix_analysis_stage_analysis_position ON analysis_stage_executions (analysis_id, position);

-- 6. Generated Reports
CREATE TABLE IF NOT EXISTS reports (
    id VARCHAR(36) PRIMARY KEY,
    analysis_id VARCHAR(36) NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    filename VARCHAR(64) NOT NULL UNIQUE,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS ix_reports_analysis_created ON reports (analysis_id, created_at);

-- 7. Alembic Migration Stamp
CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(32) NOT NULL PRIMARY KEY
);
DELETE FROM alembic_version;
INSERT INTO alembic_version (version_num) VALUES ('20261120_09');
