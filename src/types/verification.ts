export type VerificationVerdict =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED'
  | 'CONTRADICTORY'
  | 'CONTRADICTED'
  | 'POTENTIALLY_OUTDATED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'UNVERIFIABLE';

export type EvidenceAvailability = 'FULL_TEXT' | 'ABSTRACT' | 'NONE';

export type AnalysisStageId =
  | 'UPLOADED'
  | 'EXTRACTING_TEXT'
  | 'EXTRACTING_CLAIMS'
  | 'IDENTIFYING_CITATIONS'
  | 'RETRIEVING_SOURCES'
  | 'ANALYZING_EVIDENCE'
  | 'GENERATING_REPORT';

export type StageState = 'completed' | 'active' | 'pending' | 'error';

export interface AnalysisStageItem {
  id: AnalysisStageId;
  label: string;
  description: string;
  state: StageState;
  detail?: string;
  key?: BackendStageKey;
  display_name?: string;
  status?: BackendStageStatus;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  details?: Record<string, unknown>;
}

export interface DocumentRecord {
  id: string;
  title: string;
  authors: string[];
  publicationInfo?: string;
  fileName: string;
  fileSizeBytes: number;
  uploadedAt: string;
  lastAnalyzedAt?: string;
  status: 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  pageCount?: number;
  totalClaims: number;
  totalCitations: number;
  resolvedCitations: number;
  unresolvedCitations: number;
  extractionStatus?: string;
  extractionWarning?: string | null;
  isDemo?: boolean;
}

export interface CitationReference {
  citationId: string;
  title: string;
  authors: string[];
  year?: number | null;
  doi?: string | null;
  journal?: string | null;
  sourceUrl?: string | null;
  provider?: 'Crossref' | 'OpenAlex' | 'Unknown';
  resolved: boolean;
  evidenceAvailability: EvidenceAvailability;
  abstractSnippet?: string | null;
  linkedClaimIds: string[];
}

export interface ClaimRecord {
  claimId: string;
  documentId: string;
  claimText: string;
  pageNumber?: number;
  surroundingContext?: string;
  citationId?: string;
  referencedPaper?: string;
  authors?: string[];
  publicationYear?: number;
  doi?: string;
  journal?: string;
  evidencePassage?: string;
  evidenceUrl?: string;
  verificationVerdict: VerificationVerdict;
  explanation: string;
  supportingArguments?: string[];
  conflictingEvidence?: string[];
  limitations?: string[];
  confidenceScore?: number;
  evidenceAvailability: EvidenceAvailability;
  sourceProvider?: 'Crossref' | 'OpenAlex';
  highlightedClaimPhrase?: string;
  highlightedEvidencePhrase?: string;
}

export interface AnalysisStatusResponse {
  documentId: string;
  documentTitle: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | AnalysisRunStatus;
  currentStage: AnalysisStageId;
  progressPercent: number | null;
  stages: AnalysisStageItem[];
  claimsDetected: number | null;
  citationsIdentified: number | null;
  evidenceRetrievalStatus: string;
  warnings: string[];
  errors: string[];
  isDemo?: boolean;
}

export interface VerificationReport {
  reportId: string;
  documentId: string;
  documentName: string;
  analyzedAt: string;
  totalClaims: number;
  verdictCounts: Partial<Record<VerificationVerdict, number>>;
  evidenceCounts: Record<EvidenceAvailability, number>;
  status: 'READY' | 'PARTIAL' | 'DRAFT';
  executiveSummary: string;
  limitations: string[];
  isDemo?: boolean;
}

export interface VerdictMeta {
  label: string;
  shortLabel: string;
  color: string;
  bg: string;
  border: string;
  description: string;
}

export const VERDICT_META: Record<VerificationVerdict, VerdictMeta> = {
  SUPPORTED: {
    label: 'Supported',
    shortLabel: 'Supported',
    color: '#21875A',
    bg: 'rgba(33, 135, 90, 0.10)',
    border: 'rgba(33, 135, 90, 0.28)',
    description: 'Primary source evidence directly corroborates the scientific claim.',
  },
  PARTIALLY_SUPPORTED: {
    label: 'Partially Supported',
    shortLabel: 'Partial',
    color: '#B17B26',
    bg: 'rgba(177, 123, 38, 0.10)',
    border: 'rgba(177, 123, 38, 0.28)',
    description: 'Cited evidence supports part of the claim but omits qualifiers or scope.',
  },
  UNSUPPORTED: {
    label: 'Unsupported',
    shortLabel: 'Unsupported',
    color: '#C47A35',
    bg: 'rgba(196, 122, 53, 0.10)',
    border: 'rgba(196, 122, 53, 0.28)',
    description: 'Cited publication does not contain evidence substantiating the claim.',
  },
  CONTRADICTORY: {
    label: 'Contradictory',
    shortLabel: 'Contradictory',
    color: '#C04444',
    bg: 'rgba(192, 68, 68, 0.10)',
    border: 'rgba(192, 68, 68, 0.28)',
    description: 'Retrieved findings directly conflict with the stated claim.',
  },
  CONTRADICTED: {
    label: 'Contradicted',
    shortLabel: 'Contradicted',
    color: '#C04444',
    bg: 'rgba(192, 68, 68, 0.10)',
    border: 'rgba(192, 68, 68, 0.28)',
    description: 'Retrieved findings directly conflict with the stated claim.',
  },
  POTENTIALLY_OUTDATED: {
    label: 'Potentially Outdated',
    shortLabel: 'Outdated',
    color: '#737D91',
    bg: 'rgba(115, 125, 145, 0.12)',
    border: 'rgba(115, 125, 145, 0.30)',
    description: 'Relies on older literature superseded by newer consensus or retractions.',
  },
  INSUFFICIENT_EVIDENCE: {
    label: 'Insufficient Evidence',
    shortLabel: 'Insufficient',
    color: '#64748B',
    bg: 'rgba(100, 116, 139, 0.12)',
    border: 'rgba(100, 116, 139, 0.30)',
    description: 'Available abstract or metadata is insufficient to verify the claim.',
  },
  UNVERIFIABLE: {
    label: 'Unverifiable',
    shortLabel: 'Unverifiable',
    color: '#64748B',
    bg: 'rgba(100, 116, 139, 0.12)',
    border: 'rgba(100, 116, 139, 0.30)',
    description: 'Sufficient scientific evidence could not be retrieved to verify or refute this claim.',
  },
};

export const VERDICT_ORDER: VerificationVerdict[] = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED',
  'CONTRADICTORY',
  'CONTRADICTED',
  'POTENTIALLY_OUTDATED',
  'INSUFFICIENT_EVIDENCE',
  'UNVERIFIABLE',
];

export const EVIDENCE_META: Record<
  EvidenceAvailability,
  { label: string; color: string; description: string }
> = {
  FULL_TEXT: {
    label: 'Full Text',
    color: '#21875A',
    description: 'Complete peer-reviewed manuscript text was retrieved and inspected.',
  },
  ABSTRACT: {
    label: 'Abstract Only',
    color: '#B17B26',
    description: 'Only the bibliographic abstract was accessible; methods and tables could not be checked.',
  },
  NONE: {
    label: 'No Text Retrieved',
    color: '#64748B',
    description: 'No open full text or abstract could be resolved from Crossref or OpenAlex.',
  },
};

/* =========================================================================
   Backend Schemas (FastAPI / Pydantic Alignment)
   ========================================================================= */

export type BackendStageKey =
  | 'VALIDATING'
  | 'EXTRACTING'
  | 'EXTRACTING_CLAIMS'
  | 'RETRIEVING_EVIDENCE'
  | 'VERIFYING';

export type BackendStageStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export type AnalysisRunStatus =
  | 'QUEUED'
  | 'VALIDATING'
  | 'EXTRACTING'
  | 'EXTRACTING_CLAIMS'
  | 'RETRIEVING_EVIDENCE'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_WARNINGS'
  | 'FAILED';

export interface AnalysisStageResponse {
  key: BackendStageKey;
  display_name: string;
  status: BackendStageStatus;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  details: Record<string, unknown>;
  id?: AnalysisStageId;
  label?: string;
  description?: string;
  state?: StageState;
  detail?: string;
}

export interface AnalysisRunResponse {
  id: string;
  analysis_id?: string;
  analysisId?: string;
  document_id: string;
  documentId?: string;
  status: AnalysisRunStatus;
  current_stage?: string | null;
  currentStage?: string | null;
  progress_percent?: number;
  progressPercent?: number;
  retry_count?: number;
  retryCount?: number;
  warning_count?: number;
  warningCount?: number;
  error_message: string | null;
  errorMessage?: string | null;
  total_claims_detected: number;
  claims_verified: number;
  claims_detected?: number;
  claimsDetected?: number;
  citations_identified?: number;
  citationsIdentified?: number;
  evidence_records?: number;
  evidenceRecords?: number;
  verification_results?: number;
  verificationResults?: number;
  verdict_counts?: Record<string, number>;
  verdictCounts?: Record<string, number>;
  created_at: string;
  createdAt?: string;
  started_at: string | null;
  startedAt?: string | null;
  completed_at: string | null;
  completedAt?: string | null;
  stages: AnalysisStageResponse[];
}

export interface AnalysisEvidenceSnapshotResponse {
  id?: string;
  evidence_id?: string;
  evidenceId?: string;
  relation?: string;
  excerpt?: string;
  rationale?: string;
  evidence_availability?: string;
  evidenceAvailability?: string;
  citation_id?: string;
  citationId?: string;
  citation_title?: string | null;
  citationTitle?: string | null;
  citation_authors?: string[];
  citationAuthors?: string[];
  citation_year?: number | null;
  citationYear?: number | null;
  citation_journal?: string | null;
  citationJournal?: string | null;
  citation_doi?: string | null;
  citationDoi?: string | null;
  raw_reference?: string;
  rawReference?: string;
  citation_mention_page_number?: number | null;
  citationMentionPageNumber?: number | null;
  citation_mention_text?: string | null;
  citationMentionText?: string | null;
  source_id?: string | null;
  sourceId?: string | null;
  source_title?: string | null;
  sourceTitle?: string | null;
  source_doi?: string | null;
  sourceDoi?: string | null;
  source_provider?: string | null;
  sourceProvider?: string | null;
  source_authors?: Array<Record<string, unknown>>;
  sourceAuthors?: Array<Record<string, unknown>>;
  source_journal?: string | null;
  sourceJournal?: string | null;
  source_year?: number | null;
  sourceYear?: number | null;
  source_identifiers?: Array<Record<string, string>>;
  sourceIdentifiers?: Array<Record<string, string>>;
  source_url?: string | null;
  sourceUrl?: string | null;
  title?: string;
  doi?: string | null;
  source_type?: string | null;
  relevance_score?: number | null;
  text_snippet?: string | null;
}

export interface AnalysisVerdictResponse {
  claim_id?: string;
  claimId?: string;
  original_claim?: string;
  originalClaim?: string;
  claim_text?: string;
  claim_page_number?: number | null;
  claimPageNumber?: number | null;
  claim_context?: string | null;
  claimContext?: string | null;
  verdict: VerificationVerdict | string;
  confidence_score?: number | null;
  confidenceScore?: number | null;
  explanation: string | null;
  evidence_availability?: string;
  evidenceAvailability?: string;
  limitations?: string[];
  evidence?: AnalysisEvidenceSnapshotResponse[];
  evidence_snippets?: AnalysisEvidenceSnapshotResponse[];
  citations?: string[];
  model_identifier?: string;
  modelIdentifier?: string;
  prompt_version?: string;
  promptVersion?: string;
  verified_at?: string;
  verifiedAt?: string;
}

export interface AnalysisResultResponse {
  analysis_id?: string;
  analysisId?: string;
  document_id?: string;
  documentId?: string;
  status: AnalysisRunStatus | string;
  current_stage?: string | null;
  currentStage?: string | null;
  progress_percent?: number;
  progressPercent?: number;
  retry_count?: number;
  retryCount?: number;
  warning_count?: number;
  warningCount?: number;
  error_message?: string | null;
  errorMessage?: string | null;
  created_at?: string;
  createdAt?: string;
  started_at?: string | null;
  startedAt?: string | null;
  completed_at?: string | null;
  completedAt?: string | null;
  stages?: AnalysisStageResponse[];
  claims_detected?: number;
  claimsDetected?: number;
  citations_identified?: number;
  citationsIdentified?: number;
  evidence_records?: number;
  evidenceRecords?: number;
  verification_results?: number;
  verificationResults?: number;
  verdict_counts?: Record<string, number>;
  verdictCounts?: Record<string, number>;
  results: AnalysisVerdictResponse[];
}

export interface AnalysisHistoryResponse {
  document_id?: string;
  documentId?: string;
  analyses: AnalysisRunResponse[];
}

export interface DocumentMetadataResponse {
  title: string | null;
  authors: string[];
  publication_date: string | null;
  doi: string | null;
  journal: string | null;
  arxiv_id: string | null;
  page_count: number | null;
}

export interface DocumentResponse {
  id: string;
  title: string;
  authors?: string[];
  publicationInfo?: string | null;
  publication_info?: string | null;
  fileName?: string;
  file_name?: string;
  filename?: string;
  fileSizeBytes?: number;
  file_size_bytes?: number;
  size?: number;
  uploadedAt?: string;
  uploaded_at?: string;
  created_at?: string;
  status: 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  pageCount?: number;
  page_count?: number;
  totalClaims?: number;
  total_claims?: number;
  totalCitations?: number;
  total_citations?: number;
  resolvedCitations?: number;
  resolved_citations?: number;
  unresolvedCitations?: number;
  unresolved_citations?: number;
  extractionStatus?: string;
  extraction_status?: string;
  extractionWarning?: string | null;
  extraction_warning?: string | null;
  file_hash?: string;
  file_path?: string;
  metadata?: DocumentMetadataResponse | null;
  metadata_info?: DocumentMetadataResponse | null;
}

export interface DocumentListResponse {
  documents: DocumentResponse[];
  total: number;
  page: number;
  page_size?: number;
  pageSize?: number;
}

export interface EvidenceReferenceResponse {
  evidence_id?: string;
  evidenceId?: string;
  relation?: string;
  excerpt?: string;
  rationale?: string;
  citation_id?: string;
  citationId?: string;
  source_id?: string | null;
  sourceId?: string | null;
  source_title?: string | null;
  sourceTitle?: string | null;
  doi?: string | null;
  provider?: string | null;
  citation_mention_page_number?: number | null;
  citationMentionPageNumber?: number | null;
  evidence_availability?: string;
  evidenceAvailability?: string;
  title?: string;
  snippet?: string | null;
  source_url?: string | null;
  sourceUrl?: string | null;
  source_type?: string | null;
  relevance_score?: number | null;
}

export interface VerificationResultResponse {
  verification_id?: string;
  verificationId?: string;
  run_id?: string;
  runId?: string;
  claim_id?: string;
  claimId?: string;
  document_id?: string;
  documentId?: string;
  original_claim?: string;
  originalClaim?: string;
  verdict: VerificationVerdict;
  explanation: string | null;
  supporting_evidence?: EvidenceReferenceResponse[];
  supportingEvidence?: EvidenceReferenceResponse[];
  contradictory_evidence?: EvidenceReferenceResponse[];
  contradictoryEvidence?: EvidenceReferenceResponse[];
  other_evidence?: EvidenceReferenceResponse[];
  otherEvidence?: EvidenceReferenceResponse[];
  evidence_limitations?: string[];
  evidenceLimitations?: string[];
  confidence_score?: number | null;
  confidenceScore?: number | null;
  evidence_availability?: string;
  evidenceAvailability?: string;
  verification_timestamp?: string;
  verificationTimestamp?: string;
  model_identifier?: string;
  modelIdentifier?: string;
  prompt_version?: string;
  promptVersion?: string;
  methodology?: string | null;
  model_name?: string | null;
  evidence_used?: EvidenceReferenceResponse[];
}

export interface VerificationDocumentResultsResponse {
  document_id?: string;
  documentId?: string;
  run_id?: string | null;
  runId?: string | null;
  status: string;
  results: VerificationResultResponse[];
  total: number;
}

export interface ClaimExtractionResponse {
  claim_id?: string;
  claimId?: string;
  document_id?: string;
  documentId?: string;
  claim_text?: string;
  claimText?: string;
  page_number?: number;
  pageNumber?: number;
  paragraph_context?: string;
  paragraphContext?: string;
  extraction_method?: string;
  extractionMethod?: string;
  confidence_score?: number;
  confidenceScore?: number;
  citation_ids?: string[];
  citationIds?: string[];
}

export interface ClaimExtractionListResponse {
  document_id?: string;
  documentId?: string;
  claims: ClaimExtractionResponse[];
  total: number;
}

export interface FrontendCitationReference {
  citation_id?: string;
  citationId?: string;
  id?: string;
  title: string;
  authors: string[];
  year?: number | null;
  doi?: string | null;
  journal?: string | null;
  resolved: boolean;
  evidence_availability?: 'FULL_TEXT' | 'ABSTRACT' | 'NONE';
  evidenceAvailability?: 'FULL_TEXT' | 'ABSTRACT' | 'NONE';
  abstract_snippet?: string | null;
  abstractSnippet?: string | null;
  source_url?: string | null;
  sourceUrl?: string | null;
  provider?: 'Crossref' | 'OpenAlex' | 'Unknown';
  linked_claim_ids?: string[];
  linkedClaimIds?: string[];
  raw_reference?: string;
  rawReference?: string;
  reference_status?: 'BIBLIOGRAPHY' | 'UNMATCHED' | 'AMBIGUOUS';
  referenceStatus?: 'BIBLIOGRAPHY' | 'UNMATCHED' | 'AMBIGUOUS';
}

export interface CitationResponse {
  id: string;
  raw_text?: string;
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
  journal: string | null;
  source_url: string | null;
  resolved: boolean;
  resolution_metadata?: Record<string, unknown>;
  citationId?: string;
  evidenceAvailability?: EvidenceAvailability;
  linkedClaimIds?: string[];
  abstractSnippet?: string | null;
  sourceUrl?: string | null;
  provider?: 'Crossref' | 'OpenAlex' | 'Unknown';
}

export interface DocumentCitationsResponse {
  document?: DocumentResponse | null;
  document_id?: string;
  citations: (CitationResponse & FrontendCitationReference)[];
}

export interface ReportResponse {
  id?: string;
  report_id?: string;
  reportId?: string;
  analysis_id?: string;
  analysisId?: string;
  filename: string;
  file_size?: number;
  fileSize?: number;
  created_at?: string;
  createdAt?: string;
  document_id?: string;
  document_title?: string;
  document_filename?: string;
  analysis_status?: AnalysisRunStatus;
  total_claims?: number;
  verdict_counts?: Record<string, number>;
  overall_integrity_score?: number;
  format?: 'JSON' | 'MARKDOWN' | 'PDF';
  generated_at?: string;
}

export interface ReportHistoryResponse {
  analysis_id?: string;
  analysisId?: string;
  reports: ReportResponse[];
}

/* =========================================================================
   Compatibility Adapters (Bridge Backend Models to Existing UI Types)
   ========================================================================= */

export function mapBackendVerdictToUi(verdict: string): VerificationVerdict {
  switch (verdict) {
    case 'SUPPORTED':
      return 'SUPPORTED';
    case 'CONTRADICTED':
    case 'CONTRADICTORY':
      return 'CONTRADICTORY';
    case 'PARTIALLY_SUPPORTED':
      return 'PARTIALLY_SUPPORTED';
    case 'INSUFFICIENT_EVIDENCE':
      return 'INSUFFICIENT_EVIDENCE';
    case 'UNVERIFIABLE':
      return 'UNVERIFIABLE';
    case 'UNSUPPORTED':
      return 'UNSUPPORTED';
    case 'POTENTIALLY_OUTDATED':
      return 'POTENTIALLY_OUTDATED';
    default:
      return 'INSUFFICIENT_EVIDENCE';
  }
}

export function mapBackendStatusToUi(
  status: AnalysisRunStatus,
): 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' {
  switch (status) {
    case 'QUEUED':
      return 'QUEUED';
    case 'COMPLETED':
    case 'COMPLETED_WITH_WARNINGS':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'VALIDATING':
    case 'EXTRACTING':
    case 'EXTRACTING_CLAIMS':
    case 'RETRIEVING_EVIDENCE':
    case 'VERIFYING':
    default:
      return 'PROCESSING';
  }
}

export function toUiAnalysisStatus(
  run: AnalysisRunResponse,
  documentTitle?: string,
): AnalysisStatusResponse {
  const totalStages = run.stages?.length || 5;
  const completedStages = run.stages?.filter((s) => s.status === 'COMPLETED').length || 0;
  const hasRunning = run.stages?.some((s) => s.status === 'RUNNING');
  const progressPercent =
    run.status === 'COMPLETED' || run.status === 'COMPLETED_WITH_WARNINGS'
      ? 100
      : run.status === 'FAILED'
        ? null
        : Math.round(((completedStages + (hasRunning ? 0.5 : 0)) / totalStages) * 100);

  const runningStage = run.stages?.find((s) => s.status === 'RUNNING');
  let currentStage: AnalysisStageId = 'EXTRACTING_CLAIMS';
  if (runningStage) {
    if (runningStage.key === 'VALIDATING') currentStage = 'UPLOADED';
    else if (runningStage.key === 'EXTRACTING') currentStage = 'EXTRACTING_TEXT';
    else if (runningStage.key === 'EXTRACTING_CLAIMS') currentStage = 'EXTRACTING_CLAIMS';
    else if (runningStage.key === 'RETRIEVING_EVIDENCE') currentStage = 'RETRIEVING_SOURCES';
    else if (runningStage.key === 'VERIFYING') currentStage = 'ANALYZING_EVIDENCE';
  } else if (run.status === 'COMPLETED' || run.status === 'COMPLETED_WITH_WARNINGS') {
    currentStage = 'GENERATING_REPORT';
  }

  const stageItems: AnalysisStageItem[] = (run.stages || []).map((s) => {
    let id: AnalysisStageId = 'EXTRACTING_CLAIMS';
    if (s.key === 'VALIDATING') id = 'UPLOADED';
    else if (s.key === 'EXTRACTING') id = 'EXTRACTING_TEXT';
    else if (s.key === 'EXTRACTING_CLAIMS') id = 'EXTRACTING_CLAIMS';
    else if (s.key === 'RETRIEVING_EVIDENCE') id = 'RETRIEVING_SOURCES';
    else if (s.key === 'VERIFYING') id = 'ANALYZING_EVIDENCE';

    let state: StageState = 'pending';
    if (s.status === 'COMPLETED') state = 'completed';
    else if (s.status === 'RUNNING') state = 'active';
    else if (s.status === 'FAILED') state = 'error';

    return {
      ...s,
      id,
      label: s.display_name,
      description: s.error_message || `${s.display_name} (${s.status.toLowerCase()})`,
      state,
      detail: s.error_message || undefined,
    };
  });

  return {
    documentId: run.document_id,
    documentTitle: documentTitle || `Document ${run.document_id.slice(0, 8)}`,
    status:
      run.status === 'COMPLETED' || run.status === 'COMPLETED_WITH_WARNINGS'
        ? 'COMPLETED'
        : run.status === 'FAILED'
          ? 'FAILED'
          : run.status === 'QUEUED'
            ? 'QUEUED'
            : 'PROCESSING',
    currentStage,
    progressPercent,
    stages: stageItems,
    claimsDetected: run.total_claims_detected,
    citationsIdentified: null,
    evidenceRetrievalStatus: run.status === 'FAILED' ? 'Failed' : 'Active',
    warnings: [],
    errors: run.error_message ? [run.error_message] : [],
    isDemo: false,
  };
}

export function adaptDocumentResponseToRecord(doc: DocumentResponse): DocumentRecord {
  const meta = doc.metadata || doc.metadata_info;
  const fileName = doc.fileName || doc.file_name || doc.filename || 'document.pdf';
  const title = doc.title || meta?.title || fileName.replace(/\.[^/.]+$/, '');
  const authors = doc.authors?.length ? doc.authors : meta?.authors?.length ? meta.authors : [];
  const publicationInfo =
    doc.publicationInfo ||
    doc.publication_info ||
    [meta?.journal, meta?.publication_date].filter(Boolean).join(' · ') ||
    undefined;
  const fileSizeBytes = doc.fileSizeBytes ?? doc.file_size_bytes ?? doc.size ?? 0;
  const uploadedAt = doc.uploadedAt || doc.uploaded_at || doc.created_at || new Date().toISOString();
  const pageCount = doc.pageCount ?? doc.page_count ?? meta?.page_count ?? undefined;
  const totalClaims = doc.totalClaims ?? doc.total_claims ?? 0;
  const totalCitations = doc.totalCitations ?? doc.total_citations ?? 0;
  const resolvedCitations = doc.resolvedCitations ?? doc.resolved_citations ?? 0;
  const unresolvedCitations = doc.unresolvedCitations ?? doc.unresolved_citations ?? 0;

  return {
    id: doc.id,
    title,
    authors,
    publicationInfo,
    fileName,
    fileSizeBytes,
    uploadedAt,
    status: doc.status || 'UPLOADED',
    pageCount,
    totalClaims,
    totalCitations,
    resolvedCitations,
    unresolvedCitations,
    extractionStatus: doc.extractionStatus || doc.extraction_status,
    extractionWarning: doc.extractionWarning ?? doc.extraction_warning ?? null,
    isDemo: false,
  };
}

function cleanStr(val: string | null | undefined): string | undefined {
  return typeof val === 'string' && val.trim().length > 0 ? val : undefined;
}

export function adaptVerdictToClaimRecord(
  verdict: AnalysisVerdictResponse,
  documentId: string,
): ClaimRecord {
  const primaryEvidence = verdict.evidence?.[0] || verdict.evidence_snippets?.[0];
  const supporting = (verdict.evidence || verdict.evidence_snippets || []).filter((e) =>
    ['DIRECT_SUPPORT', 'INDIRECT_SUPPORT', 'PARTIAL_SUPPORT', 'SUPPORTS'].includes(e.relation || ''),
  );
  const conflicting = (verdict.evidence || verdict.evidence_snippets || []).filter((e) =>
    ['CONTRADICTORY', 'CONTRADICTS'].includes(e.relation || ''),
  );

  return {
    claimId: verdict.claimId || verdict.claim_id || `claim-${Date.now()}`,
    documentId,
    claimText: verdict.originalClaim || verdict.original_claim || verdict.claim_text || 'Unspecified scientific claim',
    pageNumber: verdict.claimPageNumber ?? verdict.claim_page_number ?? undefined,
    surroundingContext: cleanStr(verdict.claimContext || verdict.claim_context),
    verificationVerdict: mapBackendVerdictToUi(verdict.verdict as string),
    explanation: verdict.explanation || 'No assessment explanation provided.',
    confidenceScore: verdict.confidenceScore ?? verdict.confidence_score ?? undefined,
    evidenceAvailability: ((verdict.evidenceAvailability || verdict.evidence_availability || 'NONE') as EvidenceAvailability),
    limitations: verdict.limitations || [],
    supportingArguments: supporting.map((e) => (e.excerpt ? (e.rationale ? `${e.rationale}: "${e.excerpt}"` : e.excerpt) : e.rationale || '')).filter(Boolean),
    conflictingEvidence: conflicting.map((e) => (e.excerpt ? (e.rationale ? `${e.rationale}: "${e.excerpt}"` : e.excerpt) : e.rationale || '')).filter(Boolean),
    citationId: cleanStr(primaryEvidence?.citationId || primaryEvidence?.citation_id),
    referencedPaper: cleanStr(primaryEvidence?.sourceTitle || primaryEvidence?.source_title || primaryEvidence?.citationTitle || primaryEvidence?.citation_title),
    authors: primaryEvidence?.citationAuthors || primaryEvidence?.citation_authors,
    publicationYear: primaryEvidence?.citationYear ?? primaryEvidence?.citation_year ?? undefined,
    journal: cleanStr(primaryEvidence?.citationJournal || primaryEvidence?.citation_journal || primaryEvidence?.sourceJournal || primaryEvidence?.source_journal),
    doi: cleanStr(primaryEvidence?.citationDoi || primaryEvidence?.citation_doi || primaryEvidence?.sourceDoi || primaryEvidence?.source_doi),
    evidencePassage: cleanStr(primaryEvidence?.excerpt || primaryEvidence?.text_snippet),
    evidenceUrl: cleanStr(primaryEvidence?.sourceUrl || primaryEvidence?.source_url || (primaryEvidence?.sourceDoi ? `https://doi.org/${primaryEvidence.sourceDoi}` : primaryEvidence?.citationDoi ? `https://doi.org/${primaryEvidence.citationDoi}` : undefined)),
    sourceProvider: (primaryEvidence?.sourceProvider || primaryEvidence?.source_provider) as 'Crossref' | 'OpenAlex' | undefined,
  };
}

export function adaptVerificationResultToClaimRecord(
  res: VerificationResultResponse,
  documentId: string,
): ClaimRecord {
  const primaryEvidence =
    (res.supportingEvidence || res.supporting_evidence)?.[0] ||
    (res.contradictoryEvidence || res.contradictory_evidence)?.[0] ||
    (res.otherEvidence || res.other_evidence)?.[0] ||
    res.evidence_used?.[0];

  const supporting = (res.supportingEvidence || res.supporting_evidence || []).map((e) =>
    e.excerpt ? (e.rationale ? `${e.rationale}: "${e.excerpt}"` : e.excerpt) : e.rationale || '',
  ).filter(Boolean);

  const conflicting = (res.contradictoryEvidence || res.contradictory_evidence || []).map((e) =>
    e.excerpt ? (e.rationale ? `${e.rationale}: "${e.excerpt}"` : e.excerpt) : e.rationale || '',
  ).filter(Boolean);

  return {
    claimId: res.claimId || res.claim_id || `claim-${Date.now()}`,
    documentId: res.documentId || res.document_id || documentId,
    claimText: res.originalClaim || res.original_claim || 'Unspecified scientific claim',
    verificationVerdict: mapBackendVerdictToUi(res.verdict as string),
    explanation: res.explanation || 'No verification explanation provided.',
    confidenceScore: res.confidenceScore ?? res.confidence_score ?? undefined,
    evidenceAvailability: ((res.evidenceAvailability || res.evidence_availability || 'NONE') as EvidenceAvailability),
    limitations: res.evidenceLimitations || res.evidence_limitations || [],
    supportingArguments: supporting,
    conflictingEvidence: conflicting,
    citationId: cleanStr(primaryEvidence?.citationId || primaryEvidence?.citation_id),
    referencedPaper: cleanStr(primaryEvidence?.sourceTitle || primaryEvidence?.source_title),
    doi: cleanStr(primaryEvidence?.doi),
    evidencePassage: cleanStr(primaryEvidence?.excerpt || primaryEvidence?.snippet),
    evidenceUrl: cleanStr(primaryEvidence?.sourceUrl || primaryEvidence?.source_url || (primaryEvidence?.doi ? `https://doi.org/${primaryEvidence.doi}` : undefined)),
    sourceProvider: (primaryEvidence?.provider || primaryEvidence?.source_type) as 'Crossref' | 'OpenAlex' | undefined,
  };
}

export function adaptExtractedClaimToRecord(
  claim: ClaimExtractionResponse,
  documentId: string,
): ClaimRecord {
  return {
    claimId: claim.claimId || claim.claim_id || `claim-${Date.now()}`,
    documentId: claim.document_id || claim.documentId || documentId,
    claimText: claim.claimText || claim.claim_text || 'Extracted scientific claim',
    pageNumber: claim.pageNumber ?? claim.page_number,
    surroundingContext: claim.paragraphContext || claim.paragraph_context,
    verificationVerdict: 'UNVERIFIABLE',
    explanation: 'Extracted claim pending full scientific verification.',
    confidenceScore: claim.confidenceScore ?? claim.confidence_score,
    evidenceAvailability: 'NONE',
    limitations: [],
    supportingArguments: [],
    conflictingEvidence: [],
    citationId: claim.citationIds?.[0] || claim.citation_ids?.[0],
  };
}

export function adaptFrontendCitationToReference(
  c: FrontendCitationReference | CitationResponse,
): CitationReference {
  const citationId = ('citationId' in c && c.citationId) || ('citation_id' in c && c.citation_id) || ('id' in c && c.id) || `cit-${Date.now()}`;
  const rawRef = ('rawReference' in c && c.rawReference) || ('raw_reference' in c && c.raw_reference) || ('raw_text' in c && c.raw_text) || '';
  const title = c.title || rawRef || 'Untitled Citation';
  const doi = c.doi || null;
  const sourceUrl = c.sourceUrl || c.source_url || (doi ? `https://doi.org/${doi}` : null);
  const evidenceAvailability = (c.evidenceAvailability || ('evidence_availability' in c && c.evidence_availability) || 'NONE') as EvidenceAvailability;
  const linkedClaimIds = c.linkedClaimIds || ('linked_claim_ids' in c && c.linked_claim_ids) || [];

  return {
    citationId,
    title,
    authors: c.authors || [],
    year: c.year ?? null,
    doi,
    journal: c.journal ?? null,
    sourceUrl,
    provider: (c.provider as 'Crossref' | 'OpenAlex' | 'Unknown') || 'Unknown',
    resolved: Boolean(c.resolved),
    evidenceAvailability,
    abstractSnippet: c.abstractSnippet || ('abstract_snippet' in c && c.abstract_snippet) || null,
    linkedClaimIds,
  };
}
