import { apiClient, normalizeApiError, type ApiErrorInfo } from './client';
import type {
  AnalysisStatusResponse,
  CitationReference,
  ClaimRecord,
  DocumentRecord,
  VerificationReport,
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

export async function checkBackendHealth(): Promise<HealthCheckResult> {
  try {
    const res = await apiClient.get('/api/health', { timeout: 4000 });
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

export async function uploadResearchPdf(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadPdfResult> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await apiClient.post('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (evt) => {
      if (evt.total && onProgress) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    },
  });

  const data = (res.data ?? {}) as Record<string, unknown>;
  const documentId =
    String(
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

export async function fetchAnalysisStatus(documentId: string): Promise<AnalysisStatusResponse> {
  const res = await apiClient.get(`/api/analysis/${encodeURIComponent(documentId)}`);
  return res.data as AnalysisStatusResponse;
}

export async function fetchDocumentResults(documentId: string): Promise<{
  document: DocumentRecord;
  claims: ClaimRecord[];
  citations: CitationReference[];
}> {
  const res = await apiClient.get(`/api/results/${encodeURIComponent(documentId)}`);
  return res.data;
}

export async function fetchClaimDetail(claimId: string): Promise<ClaimRecord> {
  const res = await apiClient.get(`/api/claims/${encodeURIComponent(claimId)}`);
  return res.data as ClaimRecord;
}

export async function fetchDocumentCitations(documentId: string): Promise<{
  document: DocumentRecord;
  citations: CitationReference[];
}> {
  const res = await apiClient.get(`/api/citations/${encodeURIComponent(documentId)}`);
  return res.data;
}

export async function fetchReports(): Promise<VerificationReport[]> {
  const res = await apiClient.get('/api/reports');
  return res.data as VerificationReport[];
}
