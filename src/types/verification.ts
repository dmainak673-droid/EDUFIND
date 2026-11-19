export type VerificationVerdict =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED'
  | 'CONTRADICTORY'
  | 'POTENTIALLY_OUTDATED'
  | 'INSUFFICIENT_EVIDENCE';

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
  isDemo?: boolean;
}

export interface CitationReference {
  citationId: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  journal?: string;
  sourceUrl?: string;
  provider?: 'Crossref' | 'OpenAlex' | 'Unknown';
  resolved: boolean;
  evidenceAvailability: EvidenceAvailability;
  abstractSnippet?: string;
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
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
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
  verdictCounts: Record<VerificationVerdict, number>;
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
};

export const VERDICT_ORDER: VerificationVerdict[] = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED',
  'CONTRADICTORY',
  'POTENTIALLY_OUTDATED',
  'INSUFFICIENT_EVIDENCE',
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
