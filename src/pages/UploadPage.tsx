import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { DemoDataBanner } from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import { uploadResearchPdf } from '../api/verification';
import { normalizeApiError } from '../api/client';
import { DEMO_DOCUMENTS, DEMO_DOCUMENT_ID } from '../data/demoData';
import type { DocumentRecord } from '../types/verification';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function UploadPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSubmittingRef = useRef<boolean>(false);

  const {
    demoMode,
    setDemoMode,
    backendHealth,
    checkingHealth,
    refreshHealth,
    liveDocuments,
    loadingDocuments,
    documentsError,
    refreshDocuments,
    addLiveDocument,
    removeLiveDocument,
    pendingUploadDoc,
    setPendingUploadDoc,
  } = useWorkspace();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const validateAndSelect = useCallback((file: File | undefined | null) => {
    setValidationError(null);
    setUploadError(null);
    setStatusMessage(null);
    setUploadProgress(0);

    if (!file) return;
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setValidationError('Only academic PDF files (.pdf) are accepted for verification.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setValidationError('File exceeds the 50 MB upload limit.');
      return;
    }
    setSelectedFile(file);
  }, []);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    validateAndSelect(e.dataTransfer.files?.[0]);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    validateAndSelect(e.target.files?.[0]);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setValidationError(null);
    setUploadError(null);
    setStatusMessage(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDismissPending = () => {
    setPendingUploadDoc(null);
    handleClear();
  };

  const handleStartVerification = async () => {
    if (!selectedFile || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    setStatusMessage('Uploading PDF manuscript to server...');

    try {
      // Step 1: Upload the file
      const result = await uploadResearchPdf(selectedFile, (pct) => {
        setUploadProgress(pct);
        if (pct >= 100) {
          setStatusMessage('Processing PDF pages and metadata on backend...');
        }
      });

      const documentId = result.documentId;
      const newDoc: DocumentRecord = {
        id: documentId,
        title: result.title || selectedFile.name.replace(/\.pdf$/i, ''),
        authors: [],
        publicationInfo: 'Uploaded Research PDF',
        fileName: result.fileName,
        fileSizeBytes: result.fileSizeBytes ?? selectedFile.size,
        uploadedAt: new Date().toISOString(),
        status: 'PROCESSING',
        totalClaims: 0,
        totalCitations: 0,
        resolvedCitations: 0,
        unresolvedCitations: 0,
        isDemo: false,
      };

      // Step 2: Store in context and persistent storage
      addLiveDocument(newDoc);
      setPendingUploadDoc(newDoc);
      refreshDocuments().catch(() => {});

      // Step 3: Non-blocking handoff - navigate immediately to AnalysisPage!
      // AnalysisPage will verify status and initiate the synchronous analysis pipeline
      // without blocking the user on this upload screen.
      setStatusMessage('Handoff to analysis monitor...');
      navigate(`/analysis/${encodeURIComponent(documentId)}`);
    } catch (err) {
      const info = normalizeApiError(err);
      setUploadError(info.message);
      setStatusMessage(null);
    } finally {
      setUploading(false);
      isSubmittingRef.current = false;
    }
  };

  const handleDeleteDocument = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(id);
    try {
      await removeLiveDocument(id);
    } catch (err) {
      const info = normalizeApiError(err);
      setUploadError(`Failed to delete document: ${info.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const documentsList = demoMode ? DEMO_DOCUMENTS : liveDocuments;

  return (
    <WorkspaceLayout
      title="Upload Research PDF"
      subtitle="Submit an academic manuscript to extract claims, resolve citations, and verify supporting evidence."
      actions={
        <button
          type="button"
          onClick={refreshHealth}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-2 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
        >
          <RefreshCw size={13} className={checkingHealth ? 'animate-spin' : ''} />
          <span>
            Backend:{' '}
            {backendHealth?.online ? 'Connected (/api/health)' : 'Offline'}
          </span>
        </button>
      }
    >
      {demoMode && <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />}

      {/* Pending Upload Recovery Banner */}
      {pendingUploadDoc && !demoMode && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#5578B8]/30 bg-[#5578B8]/8 px-4 py-3.5 text-xs text-[#101B2D]">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#5578B8] text-white">
              <FileText size={16} />
            </span>
            <div>
              <div className="font-semibold text-[#101B2D]">
                Pending Document Uploaded: {pendingUploadDoc.title}
              </div>
              <div className="mt-0.5 text-[#5578B8]">
                Document ID: {pendingUploadDoc.id} · Stored on backend and ready for verification
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/analysis/${encodeURIComponent(pendingUploadDoc.id)}`)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#101B2D] px-3.5 py-1.5 text-xs font-semibold text-[#F5F3ED] transition hover:bg-[#1b2c47]"
            >
              <span>Continue Verification</span>
              <ArrowRight size={13} />
            </button>
            <button
              type="button"
              onClick={handleDismissPending}
              className="cursor-pointer rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#71839D] transition hover:text-[#C04444]"
            >
              Upload Different PDF
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Upload Dropzone Card */}
        <div className="lg:col-span-7">
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6 shadow-[0_1px_2px_rgba(16,27,45,0.04)]">
            <h2 className="text-base font-semibold text-[#101B2D]">
              Manuscript Upload
            </h2>
            <p className="mt-1 text-xs text-[#71839D]">
              Uploads directly to <code className="rounded bg-[#F5F3ED] px-1.5 py-0.5 text-[#101B2D]">POST /api/upload</code> and hands off to live verification monitor.
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`mt-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
                dragActive
                  ? 'border-[#5578B8] bg-[#5578B8]/6'
                  : 'border-[#D9DDE3] bg-[#F5F3ED]/55 hover:border-[#71839D]'
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#101B2D] text-[#F5F3ED]">
                <Upload size={20} />
              </div>
              <p className="mt-4 text-sm font-medium text-[#101B2D]">
                Drag and drop a scientific research PDF here
              </p>
              <p className="mt-1 text-xs text-[#71839D]">
                PDF format only · Maximum 50 MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="mt-5 cursor-pointer rounded-full border border-[#101B2D] bg-white px-4 py-2 text-xs font-semibold text-[#101B2D] transition hover:bg-[#101B2D] hover:text-[#F5F3ED] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Browse Files
              </button>
            </div>

            {validationError && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#C04444]/30 bg-[#C04444]/8 px-4 py-3 text-xs text-[#C04444]">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {selectedFile && (
              <div className="mt-5 rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#101B2D] text-[#F5F3ED]">
                      <FileText size={18} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#101B2D]">
                        {selectedFile.name}
                      </div>
                      <div className="mt-0.5 text-xs text-[#71839D]">
                        {formatBytes(selectedFile.size)} · Ready for upload
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={uploading}
                    aria-label="Remove selected file"
                    className="cursor-pointer rounded-lg p-1.5 text-[#71839D] transition hover:bg-white hover:text-[#C04444] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {uploading && (
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-[11px] font-medium text-[#4B586E]">
                      <span>{statusMessage || 'Uploading PDF to FastAPI backend...'}</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#D9DDE3]">
                      <div
                        className="h-full bg-[#101B2D] transition-[width] duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {uploadError && (
              <div className="mt-4 rounded-xl border border-[#C04444]/30 bg-[#C04444]/8 p-4 text-xs text-[#C04444]">
                <div className="flex items-start gap-2.5">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold">Upload failed</div>
                    <p className="mt-1 text-[#8C2D2D]">{uploadError}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleStartVerification}
                        className="cursor-pointer rounded-full bg-[#101B2D] px-3 py-1.5 text-[11.5px] font-medium text-[#F5F3ED]"
                      >
                        Retry Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDemoMode(true);
                          navigate(`/results/${DEMO_DOCUMENT_ID}`);
                        }}
                        className="cursor-pointer rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#101B2D]"
                      >
                        Inspect Demo Verification Instead
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#D9DDE3] pt-5">
              <div className="text-xs text-[#71839D]">
                Never simulates real verification when backend is offline.
              </div>
              <button
                type="button"
                disabled={!selectedFile || uploading}
                onClick={handleStartVerification}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#101B2D] px-5 py-2.5 text-xs font-semibold text-[#F5F3ED] transition hover:bg-[#1b2c47] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {uploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <span>Start Verification</span>
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Document Information & Workspace Documents */}
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
            <h2 className="text-base font-semibold text-[#101B2D]">
              Selected Document Metadata
            </h2>
            {selectedFile ? (
              <dl className="mt-4 space-y-3 text-xs">
                <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Document Title</dt>
                  <dd className="text-right font-medium text-[#101B2D]">
                    {selectedFile.name.replace(/\.pdf$/i, '')}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">File Size</dt>
                  <dd className="font-medium text-[#101B2D]">{formatBytes(selectedFile.size)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Author / Publication</dt>
                  <dd className="text-right text-[#71839D]">Extracted after upload</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Upload Date</dt>
                  <dd className="font-medium text-[#101B2D]">{new Date().toLocaleDateString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#71839D]">File Status</dt>
                  <dd className="font-semibold text-[#21875A]">Validated PDF</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-[#71839D]">
                Select a research PDF to inspect file size, title preview, and upload status before launching verification.
              </p>
            )}
          </div>

          <div id="documents" className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#101B2D]">
                  {demoMode ? 'Sample Research Document (Demo)' : 'My Uploaded Documents'}
                </h2>
                {loadingDocuments && <Loader2 size={13} className="animate-spin text-[#71839D]" />}
              </div>
              <span className="rounded-md bg-[#F5F3ED] px-2 py-0.5 text-[11px] font-medium text-[#71839D]">
                {documentsList.length}
              </span>
            </div>

            {documentsError && (
              <div className="mt-3 rounded-lg border border-[#C04444]/30 bg-[#C04444]/8 p-2.5 text-xs text-[#C04444]">
                {documentsError}
              </div>
            )}

            {documentsList.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-[#D9DDE3] bg-[#F5F3ED]/50 p-5 text-center text-xs text-[#71839D]">
                No live documents uploaded in this session yet. Upload a PDF or switch to Demo Mode to explore a completed verification.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {documentsList.map((doc) => (
                  <div
                    key={doc.id}
                    className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/45 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-[#101B2D]">{doc.title}</div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {doc.isDemo ? (
                          <span className="rounded bg-[#101B2D] px-1.5 py-0.5 text-[10px] font-semibold text-[#F5F3ED]">
                            DEMO
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteDocument(doc.id, e)}
                            disabled={deletingId === doc.id}
                            title="Delete document from backend"
                            aria-label={`Delete ${doc.title}`}
                            className="cursor-pointer rounded p-1 text-[#71839D] transition hover:bg-white hover:text-[#C04444] disabled:opacity-40"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-[#71839D]">
                      {doc.authors.length > 0 ? doc.authors.join(', ') : doc.fileName}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to={`/results/${doc.id}`}
                        className="rounded-full bg-[#101B2D] px-3 py-1 text-[11.5px] font-medium text-[#F5F3ED] no-underline transition hover:bg-[#1b2c47]"
                      >
                        Open Dashboard
                      </Link>
                      <Link
                        to={`/analysis/${doc.id}`}
                        className="rounded-full border border-[#D9DDE3] bg-white px-3 py-1 text-[11.5px] font-medium text-[#101B2D] no-underline transition hover:border-[#101B2D]"
                      >
                        Analysis Stages
                      </Link>
                      <Link
                        to={`/citations/${doc.id}`}
                        className="rounded-full border border-[#D9DDE3] bg-white px-3 py-1 text-[11.5px] font-medium text-[#101B2D] no-underline transition hover:border-[#101B2D]"
                      >
                        Citations
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
