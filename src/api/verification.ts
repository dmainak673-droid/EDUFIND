import { apiClient, normalizeApiError, type ApiErrorInfo } from './client';
import {
  adaptDocumentResponseToRecord,
  adaptExtractedClaimToRecord,
  adaptFrontendCitationToReference,
  adaptVerdictToClaimRecord,
  adaptVerificationResultToClaimRecord,
  toUiAnalysisStatus,
  type AnalysisHistoryResponse,
  type AnalysisResultResponse,
  type AnalysisRunResponse,
  type AnalysisStatusResponse,
  type ClaimExtractionListResponse,
  type ClaimRecord,
  type CitationReference,
  type CitationResponse,
  type DocumentCitationsResponse,
  type DocumentListResponse,
  type DocumentRecord,
  type DocumentResponse,
  type ReportHistoryResponse,
  type ReportResponse,
  type VerificationDocumentResultsResponse,
  type VerificationReport,
  type VerificationResultResponse,
} from '../types/verification';

export interface HealthCheckResult {
  online: boolean;
  status?: string;
  version?: string;
  error?: ApiErrorInfo;
}

export interface UploadPdfResult {
  documentId: string;
  fileName: string;
  fileSizeBytes?: number;
  title?: string;
  message?: string;
  raw?: Record<string, unknown>;
}

export interface UploadOptions {
  maxClaims?: number;
}

/**
 * Health check endpoint: GET /api/health
 */
export async function checkBackendHealth(): Promise<HealthCheckResult> {
  try {
    const res = await apiClient.get<{ status?: string; version?: string }>('/api/health', {
      timeout: 5000,
    });
    return {
      online: true,
      status: typeof res.data?.status === 'string' ? res.data.status : 'ok',
      version: typeof res.data?.version === 'string' ? res.data.version : undefined,
    };
  } catch (err) {
    return {
      online: false,
      error: normalizeApiError(err),
    };
  }
}

/**
 * Upload research PDF: POST /api/upload
 * Supports both (file, options, onProgress) and (file, onProgress)
 */
export async function uploadResearchPdf(
  file: File,
  optionsOrProgress?: UploadOptions | ((percent: number) => void),
  maybeProgress?: (percent: number) => void,
): Promise<UploadPdfResult> {
  const options = typeof optionsOrProgress === 'object' && optionsOrProgress !== null ? optionsOrProgress : undefined;
  const onProgress = typeof optionsOrProgress === 'function' ? optionsOrProgress : maybeProgress;

  const formData = new FormData();
  formData.append('file', file);
  if (typeof options?.maxClaims === 'number') {
    formData.append('max_claims', String(options.maxClaims));
  }

  const res = await apiClient.post('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
    onUploadProgress: (evt) => {
      if (evt.total && onProgress) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    },
  });

  const data = (res.data ?? {}) as Record<string, unknown>;
  const documentId = String(
    data.document_id ??
      data.documentId ??
      data.id ??
      `doc-${Date.now()}`,
  );

  return {
    documentId,
    fileName: String(data.filename ?? data.file_name ?? file.name),
    fileSizeBytes: typeof data.size === 'number' ? data.size : file.size,
    title: typeof data.title === 'string' ? data.title : file.name.replace(/\.pdf$/i, ''),
    message: typeof data.message === 'string' ? data.message : 'PDF uploaded successfully.',
    raw: data,
  };
}

/**
 * Start document analysis: POST /api/documents/{document_id}/analyze
 */
export async function startDocumentAnalysis(
  documentId: string,
): Promise<AnalysisRunResponse> {
  const res = await apiClient.post<AnalysisRunResponse>(
    `/api/documents/${encodeURIComponent(documentId)}/analyze`,
    undefined,
    { timeout: 180_000 },
  );
  return res.data;
}

/**
 * Fetch analysis status: GET /api/documents/{document_id}/analysis-status
 * Returns AnalysisRunResponse with backward-compatible adapter properties for AnalysisStatusResponse
 */
export async function fetchAnalysisStatus(
  documentId: string,
): Promise<AnalysisRunResponse & AnalysisStatusResponse> {
  const res = await apiClient.get<AnalysisRunResponse>(
    `/api/documents/${encodeURIComponent(documentId)}/analysis-status`,
  );
  const uiAdapted = toUiAnalysisStatus(res.data);
  return {
    ...res.data,
    ...uiAdapted,
  } as AnalysisRunResponse & AnalysisStatusResponse;
}

/**
 * Fetch analysis results: GET /api/analyses/{analysis_id}
 */
export async function fetchAnalysisResults(
  analysisId: string,
): Promise<AnalysisResultResponse> {
  const res = await apiClient.get<AnalysisResultResponse>(
    `/api/analyses/${encodeURIComponent(analysisId)}`,
  );
  return res.data;
}

/**
 * Fetch analysis history for document: GET /api/documents/{document_id}/analyses
 */
export async function fetchDocumentAnalyses(
  documentId: string,
): Promise<AnalysisHistoryResponse> {
  const res = await apiClient.get<AnalysisHistoryResponse>(
    `/api/documents/${encodeURIComponent(documentId)}/analyses`,
  );
  return res.data;
}

/**
 * Retry failed analysis run: POST /api/analyses/{analysis_id}/retry
 */
export async function retryAnalysis(
  analysisId: string,
): Promise<AnalysisRunResponse> {
  const res = await apiClient.post<AnalysisRunResponse>(
    `/api/analyses/${encodeURIComponent(analysisId)}/retry`,
    undefined,
    { timeout: 180_000 },
  );
  return res.data;
}

/**
 * Fetch claim verification: GET /api/claims/{claim_id}/verification
 */
export async function fetchClaimVerification(
  claimId: string,
): Promise<VerificationResultResponse> {
  const res = await apiClient.get<VerificationResultResponse>(
    `/api/claims/${encodeURIComponent(claimId)}/verification`,
  );
  return res.data;
}

/**
 * Fetch document list: GET /api/documents?page={page}&pageSize={pageSize}
 */
export async function fetchDocuments(
  page = 1,
  pageSize = 20,
): Promise<DocumentListResponse> {
  const res = await apiClient.get<DocumentListResponse>('/api/documents', {
    params: { page, pageSize },
  });
  return res.data;
}

/**
 * Fetch single document: GET /api/documents/{document_id}
 */
export async function fetchDocument(
  documentId: string,
): Promise<DocumentResponse> {
  const res = await apiClient.get<DocumentResponse>(
    `/api/documents/${encodeURIComponent(documentId)}`,
  );
  return res.data;
}

/**
 * Delete document: DELETE /api/documents/{document_id}
 */
export async function deleteDocument(documentId: string): Promise<void> {
  await apiClient.delete(`/api/documents/${encodeURIComponent(documentId)}`);
}

/**
 * Fetch document extracted claims: GET /api/documents/{document_id}/claims
 */
export async function fetchDocumentClaims(
  documentId: string,
): Promise<ClaimExtractionListResponse> {
  const res = await apiClient.get<ClaimExtractionListResponse>(
    `/api/documents/${encodeURIComponent(documentId)}/claims`,
  );
  return res.data;
}

/**
 * Fetch document verification results: GET /api/documents/{document_id}/verification-results
 */
export async function fetchDocumentVerificationResults(
  documentId: string,
): Promise<VerificationDocumentResultsResponse> {
  const res = await apiClient.get<VerificationDocumentResultsResponse>(
    `/api/documents/${encodeURIComponent(documentId)}/verification-results`,
  );
  return res.data;
}

/**
 * Fetch document citations: GET /api/citations/{document_id}
 * Returns DocumentCitationsResponse with adapter properties for CitationReference compatibility
 */
export async function fetchDocumentCitations(
  documentId: string,
): Promise<Omit<DocumentCitationsResponse, 'document' | 'citations'> & { document: DocumentRecord | null; citations: (CitationResponse & CitationReference)[] }> {
  const res = await apiClient.get<DocumentCitationsResponse>(
    `/api/citations/${encodeURIComponent(documentId)}`,
  );
  const adaptedDocument = res.data.document ? adaptDocumentResponseToRecord(res.data.document) : null;
  const adaptedCitations = (res.data.citations || []).map((c) => {
    const ref = adaptFrontendCitationToReference(c);
    return {
      ...c,
      ...ref,
      id: ref.citationId,
      raw_text: ('rawReference' in c && c.rawReference) || ('raw_text' in c && c.raw_text) || ref.title,
    } as CitationResponse & CitationReference;
  });

  return {
    ...res.data,
    document: adaptedDocument,
    citations: adaptedCitations,
  };
}

/**
 * Generate analysis report: POST /api/analyses/{analysis_id}/reports
 */
export async function generateAnalysisReport(
  analysisId: string,
): Promise<ReportResponse> {
  const res = await apiClient.post<ReportResponse>(
    `/api/analyses/${encodeURIComponent(analysisId)}/reports`,
  );
  return res.data;
}

/**
 * List analysis reports: GET /api/analyses/{analysis_id}/reports
 */
export async function listAnalysisReports(
  analysisId: string,
): Promise<ReportHistoryResponse> {
  const res = await apiClient.get<ReportHistoryResponse>(
    `/api/analyses/${encodeURIComponent(analysisId)}/reports`,
  );
  return res.data;
}

/**
 * Download report PDF: GET /api/reports/{report_id}/download
 */
export async function downloadReportPdf(reportId: string): Promise<Blob> {
  const res = await apiClient.get<Blob>(
    `/api/reports/${encodeURIComponent(reportId)}/download`,
    {
      responseType: 'blob',
      headers: { Accept: 'application/pdf' },
      timeout: 30_000,
    },
  );
  return res.data;
}

/* =========================================================================
   Live Verification Results & Claim Details Integration
   ========================================================================= */

/**
 * Fetch full results for a document by composing backend verification, analysis, and citation endpoints.
 */
export async function fetchDocumentResults(documentId: string): Promise<{
  document: DocumentRecord;
  claims: ClaimRecord[];
  citations: CitationReference[];
  analysis?: AnalysisRunResponse;
}> {
  // 1. Fetch document metadata
  const docResponse = await fetchDocument(documentId);
  const document = adaptDocumentResponseToRecord(docResponse);

  // 2. Fetch citations for this document
  let citations: CitationReference[] = [];
  try {
    const citationsRes = await fetchDocumentCitations(documentId);
    citations = citationsRes.citations;
  } catch {
    // If citations endpoint not yet populated, keep empty list
  }

  // 3. Fetch latest analysis run for this document
  let latestRun: AnalysisRunResponse | undefined = undefined;
  try {
    const history = await fetchDocumentAnalyses(documentId);
    if (history?.analyses?.length) {
      latestRun = history.analyses[0];
    }
  } catch {
    try {
      latestRun = await fetchAnalysisStatus(documentId);
    } catch {
      // No active run
    }
  }

  // 4. Fetch verification results / claims
  let claims: ClaimRecord[] = [];
  if (latestRun?.id) {
    try {
      const resultRes = await fetchAnalysisResults(latestRun.id);
      if (resultRes?.results?.length) {
        claims = resultRes.results.map((v) => adaptVerdictToClaimRecord(v, documentId));
      }
    } catch {
      // Fallback to verification document results
    }
  }

  if (claims.length === 0) {
    try {
      const verifRes = await fetchDocumentVerificationResults(documentId);
      if (verifRes?.results?.length) {
        claims = verifRes.results.map((v) => adaptVerificationResultToClaimRecord(v, documentId));
      }
    } catch {
      // No verification results
    }
  }

  // If verification not yet run, check for extracted claims
  if (claims.length === 0) {
    try {
      const extractedClaimsRes = await fetchDocumentClaims(documentId);
      if (extractedClaimsRes?.claims?.length) {
        claims = extractedClaimsRes.claims.map((c) => adaptExtractedClaimToRecord(c, documentId));
      }
    } catch {
      // No claims extracted
    }
  }

  return {
    document,
    claims,
    citations,
    analysis: latestRun,
  };
}

/**
 * Fetch single claim details using GET /api/claims/{claim_id}/verification
 */
export async function fetchClaimDetail(claimId: string): Promise<ClaimRecord> {
  const verifRes = await fetchClaimVerification(claimId);
  return adaptVerificationResultToClaimRecord(verifRes, verifRes.document_id || verifRes.documentId || '');
}

export async function fetchReports(): Promise<VerificationReport[]> {
  const res = await apiClient.get('/api/reports');
  return res.data as VerificationReport[];
}
