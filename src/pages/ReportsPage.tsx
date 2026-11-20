import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileCheck2,
  FileCode,
  FileDown,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Upload,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import {
  DemoDataBanner,
  EvidenceBadge,
  VerdictBadge,
} from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  downloadReportPdf,
  fetchDocumentAnalyses,
  fetchDocumentResults,
  generateAnalysisReport,
  listAnalysisReports,
} from '../api/verification';
import { normalizeApiError, type ApiErrorInfo } from '../api/client';
import {
  DEMO_CITATIONS,
  DEMO_CLAIMS,
  DEMO_DOCUMENTS,
  DEMO_DOCUMENT_ID,
  DEMO_REPORTS,
} from '../data/demoData';
import {
  EVIDENCE_META,
  VERDICT_META,
  VERDICT_ORDER,
  type AnalysisRunResponse,
  type CitationReference,
  type ClaimRecord,
  type DocumentRecord,
  type EvidenceAvailability,
  type ReportResponse,
  type VerificationReport,
  type VerificationVerdict,
} from '../types/verification';

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateMarkdownReport(data: {
  doc: DocumentRecord;
  analysis?: AnalysisRunResponse | null;
  verdictCounts: Record<VerificationVerdict, number>;
  claims: ClaimRecord[];
  citations: CitationReference[];
}): string {
  const { doc, analysis, verdictCounts, claims, citations } = data;
  const lines: string[] = [];

  lines.push(`# EDUFIND AI — Scientific Evidence Verification Report`);
  lines.push(``);
  lines.push(`**Document Title**: ${doc.title}`);
  lines.push(`**Original File**: ${doc.fileName}`);
  lines.push(`**Authors**: ${doc.authors.length ? doc.authors.join(', ') : 'Not specified'}`);
  lines.push(`**Uploaded At**: ${new Date(doc.uploadedAt).toLocaleString()}`);
  if (analysis) {
    lines.push(`**Analysis Run ID**: \`${analysis.id}\``);
    lines.push(`**Analysis Status**: ${analysis.status}`);
  }
  lines.push(`**Report Generated**: ${new Date().toLocaleString()}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 1. Executive Summary & Verdict Distribution`);
  lines.push(``);
  lines.push(`| Verification Verdict | Count |`);
  lines.push(`| :--- | :--- |`);
  VERDICT_ORDER.forEach((v) => {
    lines.push(`| ${VERDICT_META[v].label} | ${verdictCounts[v] || 0} |`);
  });
  lines.push(``);
  lines.push(`- **Total Claims Extracted**: ${claims.length}`);
  lines.push(`- **Total Bibliographic Citations**: ${citations.length}`);
  lines.push(`- **Resolved References**: ${citations.filter((c) => c.resolved).length}`);
  lines.push(`- **Unresolved References**: ${citations.filter((c) => !c.resolved).length}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 2. Extracted Scientific Claims & Verification Dossier`);
  lines.push(``);
  if (claims.length === 0) {
    lines.push(`*No scientific claims were recorded for this analysis.*`);
  } else {
    claims.forEach((claim, idx) => {
      lines.push(`### Claim ${idx + 1}: ${claim.claimId}`);
      lines.push(``);
      lines.push(`> "${claim.claimText}"`);
      lines.push(``);
      lines.push(`- **Verdict**: **${claim.verificationVerdict}**`);
      if (typeof claim.confidenceScore === 'number') {
        lines.push(`- **Model Confidence**: ${Math.round(claim.confidenceScore * 100)}%`);
      }
      lines.push(`- **Evidence Availability**: ${claim.evidenceAvailability}`);
      if (claim.pageNumber) {
        lines.push(`- **Manuscript Page**: ${claim.pageNumber}`);
      }
      if (claim.referencedPaper) {
        lines.push(`- **Cited Publication**: ${claim.referencedPaper}`);
      }
      if (claim.doi) {
        lines.push(`- **DOI**: [${claim.doi}](https://doi.org/${claim.doi})`);
      }
      lines.push(``);
      lines.push(`**Verification Assessment:**`);
      lines.push(claim.explanation);
      lines.push(``);
      if (claim.supportingArguments?.length) {
        lines.push(`**Supporting Arguments:**`);
        claim.supportingArguments.forEach((arg) => lines.push(`* ${arg}`));
        lines.push(``);
      }
      if (claim.conflictingEvidence?.length) {
        lines.push(`**Contradicting Evidence:**`);
        claim.conflictingEvidence.forEach((conf) => lines.push(`* ${conf}`));
        lines.push(``);
      }
      if (claim.limitations?.length) {
        lines.push(`**Verification Limitations:**`);
        claim.limitations.forEach((lim) => lines.push(`* ${lim}`));
        lines.push(``);
      }
      lines.push(``);
    });
  }
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 3. Scholarly Bibliography & Index Provenance`);
  lines.push(``);
  if (citations.length === 0) {
    lines.push(`*No citation references were extracted.*`);
  } else {
    citations.forEach((cit, idx) => {
      const authors = cit.authors.length ? cit.authors.join(', ') : 'Unknown authors';
      const year = cit.year ? ` (${cit.year})` : '';
      const journal = cit.journal ? ` *${cit.journal}*` : '';
      const doi = cit.doi ? ` [doi:${cit.doi}](${cit.sourceUrl || `https://doi.org/${cit.doi}`})` : '';
      const resolved = cit.resolved ? ` [Resolved via ${cit.provider || 'Scholarly Index'}]` : ' [Unresolved]';
      lines.push(`${idx + 1}. **${authors}**${year}. ${cit.title}.${journal}.${doi}${resolved}`);
    });
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`*Official report generated by EDUFIND AI Verification Suite.*`);

  return lines.join('\n');
}

export default function ReportsPage() {
  const {
    demoMode,
    setDemoMode,
    liveDocuments,
    loadingDocuments,
    refreshDocuments,
    activeDocumentId,
    setActiveDocumentId,
  } = useWorkspace();

  // Active document selection
  const selectedDocId = useMemo(() => {
    if (demoMode) return DEMO_DOCUMENT_ID;
    if (activeDocumentId && activeDocumentId !== DEMO_DOCUMENT_ID) return activeDocumentId;
    if (liveDocuments.length > 0) return liveDocuments[0].id;
    return '';
  }, [demoMode, activeDocumentId, liveDocuments]);

  // Document dossier states
  const [detailDoc, setDetailDoc] = useState<DocumentRecord | null>(null);
  const [detailAnalysis, setDetailAnalysis] = useState<AnalysisRunResponse | null>(null);
  const [detailClaims, setDetailClaims] = useState<ClaimRecord[]>([]);
  const [detailCitations, setDetailCitations] = useState<CitationReference[]>([]);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  // Backend generated PDF reports state (POST & GET /api/analyses/{id}/reports)
  const [pdfReports, setPdfReports] = useState<ReportResponse[]>([]);
  const [loadingReports, setLoadingReports] = useState<boolean>(false);
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Demo reports state
  const [demoReports] = useState<VerificationReport[]>(DEMO_REPORTS);
  const [selectedDemoReportId, setSelectedDemoReportId] = useState<string>(DEMO_REPORTS[0].reportId);

  // Request race condition guard
  const requestSeqRef = useRef<number>(0);

  // Load document dossier and report history
  const loadDossierAndReports = useCallback(async () => {
    const currentSeq = ++requestSeqRef.current;
    setError(null);
    setSuccessNotice(null);

    // DEMO MODE: load demo fixtures
    if (demoMode) {
      const demoDoc = DEMO_DOCUMENTS.find((d) => d.id === selectedDocId) || DEMO_DOCUMENTS[0];
      setDetailDoc(demoDoc);
      setDetailAnalysis(null);
      setDetailClaims(DEMO_CLAIMS);
      setDetailCitations(DEMO_CITATIONS);
      setPdfReports([]);
      setDetailLoading(false);
      return;
    }

    // LIVE MODE: if no documents in workspace, reset
    if (!selectedDocId) {
      setDetailDoc(null);
      setDetailAnalysis(null);
      setDetailClaims([]);
      setDetailCitations([]);
      setPdfReports([]);
      setDetailLoading(false);
      return;
    }

    setDetailLoading(true);
    setLoadingReports(true);

    try {
      // 1. Fetch document results (metadata, claims, citations, latest run)
      const results = await fetchDocumentResults(selectedDocId);
      if (currentSeq !== requestSeqRef.current) return;

      setDetailDoc(results.document);
      setDetailClaims(results.claims);
      setDetailCitations(results.citations);
      setDetailAnalysis(results.analysis ?? null);

      // 2. Fetch analysis history to locate completed run for reports
      let completedRunId = results.analysis?.id;
      if (!completedRunId) {
        try {
          const history = await fetchDocumentAnalyses(selectedDocId);
          const found = history.analyses?.find(
            (r) => r.status === 'COMPLETED' || r.status === 'COMPLETED_WITH_WARNINGS',
          );
          if (found) completedRunId = found.id;
        } catch {
          // No history
        }
      }

      // 3. If an analysis run exists, fetch generated reports list via GET /api/analyses/{id}/reports
      if (completedRunId) {
        try {
          const historyRes = await listAnalysisReports(completedRunId);
          if (currentSeq === requestSeqRef.current) {
            setPdfReports(historyRes.reports || []);
          }
        } catch {
          if (currentSeq === requestSeqRef.current) {
            setPdfReports([]);
          }
        }
      } else {
        setPdfReports([]);
      }
    } catch (err) {
      if (currentSeq !== requestSeqRef.current) return;
      const info = normalizeApiError(err);
      setError(info);
      setDetailDoc(null);
      setDetailClaims([]);
      setDetailCitations([]);
      setPdfReports([]);
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setDetailLoading(false);
        setLoadingReports(false);
      }
    }
  }, [demoMode, selectedDocId]);

  useEffect(() => {
    loadDossierAndReports();
  }, [loadDossierAndReports]);

  // Generate ReportLab PDF via POST /api/analyses/{analysis_id}/reports
  const handleGeneratePdfReport = async () => {
    if (!detailAnalysis?.id || generatingPdf) return;

    setGeneratingPdf(true);
    setError(null);
    setSuccessNotice(null);

    try {
      const newReport = await generateAnalysisReport(detailAnalysis.id);
      setPdfReports((prev) => [newReport, ...prev.filter((r) => (r.report_id || r.id || r.reportId) !== (newReport.report_id || newReport.id || newReport.reportId))]);
      setSuccessNotice(`Official PDF report "${newReport.filename}" generated successfully!`);
    } catch (err) {
      const info = normalizeApiError(err);
      setError(info);
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Download PDF Report via GET /api/reports/{report_id}/download
  const handleDownloadPdf = async (report: ReportResponse) => {
    const reportId = report.report_id || report.id || report.reportId;
    if (!reportId || downloadingReportId) return;

    setDownloadingReportId(reportId);
    setError(null);

    try {
      const blob = await downloadReportPdf(reportId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = report.filename || `edufind-verification-report-${reportId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const info = normalizeApiError(err);
      setError(info);
    } finally {
      setDownloadingReportId(null);
    }
  };

  // JSON Report Export (client-side export from actual backend verification records)
  const handleExportJson = () => {
    if (!detailDoc) return;
    const payload = {
      document: detailDoc,
      analysis: detailAnalysis,
      verdictSummary: verdictCounts,
      claims: detailClaims,
      citations: detailCitations,
      generatedAt: new Date().toISOString(),
      engine: 'EDUFIND AI Automated Scientific Verification Pipeline',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${detailDoc.fileName.replace(/\.pdf$/i, '')}_verification_report.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Markdown Report Export (client-side export from actual backend verification records)
  const handleExportMarkdown = () => {
    if (!detailDoc) return;
    const md = generateMarkdownReport({
      doc: detailDoc,
      analysis: detailAnalysis,
      verdictCounts,
      claims: detailClaims,
      citations: detailCitations,
    });
    const blob = new Blob([md], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${detailDoc.fileName.replace(/\.pdf$/i, '')}_verification_report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  // Verdict distribution counts
  const verdictCounts = useMemo(() => {
    const counts: Record<VerificationVerdict, number> = {
      SUPPORTED: 0,
      PARTIALLY_SUPPORTED: 0,
      UNSUPPORTED: 0,
      CONTRADICTORY: 0,
      CONTRADICTED: 0,
      POTENTIALLY_OUTDATED: 0,
      INSUFFICIENT_EVIDENCE: 0,
      UNVERIFIABLE: 0,
    };
    detailClaims.forEach((c) => {
      counts[c.verificationVerdict] = (counts[c.verificationVerdict] || 0) + 1;
    });
    return counts;
  }, [detailClaims]);

  const evidenceCounts = useMemo(() => {
    const counts: Record<EvidenceAvailability, number> = {
      FULL_TEXT: 0,
      ABSTRACT: 0,
      NONE: 0,
    };
    detailClaims.forEach((c) => {
      counts[c.evidenceAvailability] = (counts[c.evidenceAvailability] || 0) + 1;
    });
    return counts;
  }, [detailClaims]);

  const isAnalysisComplete =
    detailAnalysis?.status === 'COMPLETED' ||
    detailAnalysis?.status === 'COMPLETED_WITH_WARNINGS';

  const evidenceOrder: EvidenceAvailability[] = ['FULL_TEXT', 'ABSTRACT', 'NONE'];

  return (
    <WorkspaceLayout
      title="Verification Reports &amp; Export"
      subtitle={
        detailDoc
          ? `${detailDoc.title} · ${detailClaims.length} Claims · ${pdfReports.length} PDF Reports Generated`
          : 'Official literature verification dossiers and downloadable reporting artifacts'
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* Document Switcher in Live Mode */}
          {!demoMode && liveDocuments.length > 1 && (
            <select
              value={selectedDocId}
              onChange={(e) => setActiveDocumentId(e.target.value)}
              className="cursor-pointer rounded-full border border-[#D9DDE3] bg-white px-3.5 py-1.5 text-xs font-medium text-[#101B2D] transition focus:outline-none focus:ring-1 focus:ring-[#101B2D]"
              aria-label="Select document for reporting"
            >
              {liveDocuments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title.length > 32 ? `${d.title.slice(0, 32)}...` : d.title}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={loadDossierAndReports}
            disabled={detailLoading || loadingReports}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-1.5 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D] disabled:opacity-50"
          >
            <RefreshCw size={13} className={detailLoading || loadingReports ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          {detailDoc && (
            <>
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
                title="Export structured JSON dossier"
              >
                <FileCode size={13} />
                <span>Export JSON</span>
              </button>
              <button
                type="button"
                onClick={handleExportMarkdown}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
                title="Export clean Markdown dossier"
              >
                <FileText size={13} />
                <span>Export MD</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
              >
                <Printer size={13} />
                <span>Print</span>
              </button>
            </>
          )}
        </div>
      }
    >
      {demoMode && <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />}

      {/* Success Notification */}
      {successNotice && (
        <div className="mb-6 flex items-center justify-between rounded-2xl border border-[#21875A]/30 bg-[#21875A]/10 p-4 text-xs font-medium text-[#14583A]">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-[#21875A]" />
            <span>{successNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            className="cursor-pointer text-[#14583A] underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Notification */}
      {error && (
        <div className="mb-6 rounded-2xl border border-[#C04444]/30 bg-[#C04444]/8 p-4 text-xs text-[#8C2D2D]">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <p className="font-semibold">{error.message}</p>
              {error.status === 409 && (
                <p className="mt-1 text-[11px] opacity-90">
                  Reports can only be generated for analyses that have successfully finished verification (COMPLETED or COMPLETED_WITH_WARNINGS).
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LOADING STATE */}
      {detailLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-[#D9DDE3] bg-white py-20 text-sm text-[#71839D]">
          <Loader2 size={18} className="mr-2 animate-spin text-[#101B2D]" />
          Loading verification dossier and report archives...
        </div>
      ) : !demoMode && liveDocuments.length === 0 ? (
        /* EMPTY STATE: Live Mode with 0 documents */
        <div className="rounded-2xl border border-dashed border-[#D9DDE3] bg-white p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F5F3ED] text-[#101B2D]">
            <Upload size={24} />
          </div>
          <h2 className="mt-4 text-base font-semibold text-[#101B2D]">
            No Reports Available
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[#71839D]">
            Upload a research paper and run verification analysis to generate PDF, Markdown, and JSON verification reports.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/upload"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#101B2D] px-5 py-2.5 text-xs font-semibold text-[#F5F3ED] no-underline transition hover:bg-[#1b2c47]"
            >
              <Upload size={14} />
              <span>Upload Research PDF</span>
            </Link>
            <button
              type="button"
              onClick={() => setDemoMode(true)}
              className="cursor-pointer rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-4 py-2.5 text-xs font-medium text-[#101B2D]"
            >
              Inspect Demo Reports
            </button>
          </div>
        </div>
      ) : !detailDoc ? (
        /* NO DOCUMENT SELECTED OR ERROR */
        <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <h2 className="text-base font-semibold text-[#101B2D]">
                Report Dossier Unavailable
              </h2>
              <p className="mt-1 text-sm text-[#4B586E]">
                {error?.message || 'Could not retrieve verification report data for this document.'}
              </p>
              <button
                type="button"
                onClick={loadDossierAndReports}
                className="mt-4 cursor-pointer rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED]"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* MAIN REPORTS INTERFACE */
        <div className="space-y-6">
          {/* Phase 7 PDF Report Generation & Download Banner */}
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-xl">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[#5578B8] uppercase">
                    Phase 7 Report Generation Engine
                  </span>
                  {detailAnalysis && (
                    <span className="rounded-md bg-[#101B2D]/8 px-2 py-0.5 text-[10.5px] font-medium text-[#101B2D]">
                      Status: {detailAnalysis.status}
                    </span>
                  )}
                </div>
                <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-[#101B2D]">
                  Official Publication-Quality PDF Report
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-[#4B586E]">
                  Generate immutable, standalone ReportLab PDF verification dossiers with claim provenance, cited bibliography tables, and evidence availability breakdown.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {!demoMode && isAnalysisComplete && (
                  <button
                    type="button"
                    onClick={handleGeneratePdfReport}
                    disabled={generatingPdf}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#101B2D] px-5 py-2.5 text-xs font-semibold text-[#F5F3ED] transition hover:bg-[#1b2c47] disabled:opacity-50"
                  >
                    {generatingPdf ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} className="text-[#F5F3ED]" />
                    )}
                    <span>{generatingPdf ? 'Generating PDF...' : 'Generate PDF Report'}</span>
                  </button>
                )}

                {!demoMode && !isAnalysisComplete && detailAnalysis && (
                  <Link
                    to={`/analysis/${encodeURIComponent(detailDoc.id)}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-4 py-2 text-xs font-medium text-[#101B2D] no-underline hover:border-[#101B2D]"
                  >
                    <Clock size={13} />
                    <span>View Pipeline Progress</span>
                  </Link>
                )}

                <button
                  type="button"
                  onClick={handleExportJson}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-2 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
                >
                  <FileCode size={13} />
                  <span>Download JSON</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportMarkdown}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-2 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
                >
                  <FileText size={13} />
                  <span>Download MD</span>
                </button>
              </div>
            </div>

            {/* List of previously generated PDF reports (GET /api/analyses/{id}/reports) */}
            {!demoMode && (
              <div className="mt-5 border-t border-[#ECEFF3] pt-4">
                <h3 className="text-xs font-semibold text-[#101B2D]">
                  Generated PDF Reports Archive ({pdfReports.length})
                </h3>
                {pdfReports.length === 0 ? (
                  <p className="mt-2 text-xs text-[#71839D]">
                    {isAnalysisComplete
                      ? 'No PDF reports generated yet for this analysis run. Click "Generate PDF Report" above to compile a ReportLab PDF artifact.'
                      : 'Analysis is currently processing or has not completed. Reports can be generated once verification finishes.'}
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-[#ECEFF3] rounded-xl border border-[#ECEFF3] bg-[#F5F3ED]/30">
                    {pdfReports.map((r) => {
                      const rId = r.report_id || r.id || r.reportId;
                      const isDownloading = downloadingReportId === rId;
                      return (
                        <div
                          key={rId}
                          className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs"
                        >
                          <div className="flex items-center gap-2.5">
                            <FileText size={16} className="text-[#101B2D]" />
                            <div>
                              <div className="font-mono font-medium text-[#101B2D]">
                                {r.filename}
                              </div>
                              <div className="text-[10.5px] text-[#71839D]">
                                Created {formatDateTime(r.created_at || r.createdAt)} · Size: {formatBytes(r.file_size || r.fileSize)}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(r)}
                            disabled={isDownloading}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#101B2D] px-3.5 py-1 text-[11px] font-semibold text-[#F5F3ED] transition hover:bg-[#1b2c47] disabled:opacity-50"
                          >
                            {isDownloading ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <FileDown size={12} />
                            )}
                            <span>{isDownloading ? 'Downloading...' : 'Download PDF'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interactive Scientific Verification Dossier Viewer */}
          <article className="rounded-2xl border border-[#D9DDE3] bg-white p-8">
            {/* Header */}
            <div className="border-b border-[#D9DDE3] pb-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-[#5578B8]">
                  VERIFICATION DOSSIER · {detailDoc.id}
                </span>
                <span className="rounded-full bg-[#21875A]/10 px-3 py-1 font-mono text-xs font-semibold text-[#21875A]">
                  STATUS: {detailDoc.status}
                </span>
              </div>
              <h1 className="mt-2 text-xl font-bold tracking-tight text-[#101B2D] sm:text-2xl">
                {detailDoc.title}
              </h1>
              <p className="mt-1 text-xs text-[#71839D]">
                Original File: <code>{detailDoc.fileName}</code> · Uploaded:{' '}
                {formatDateTime(detailDoc.uploadedAt)}
                {detailDoc.pageCount ? ` · ${detailDoc.pageCount} pages` : ''}
              </p>
            </div>

            {/* Section 1: Executive Summary */}
            <section className="mt-6 border-b border-[#D9DDE3] pb-6">
              <h2 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                1. Executive Summary
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#111318]">
                Automated multi-source scientific literature verification performed across{' '}
                <strong>{detailClaims.length} extracted claims</strong> and{' '}
                <strong>{detailCitations.length} bibliographic references</strong>. Primary evidence
                retrieval cross-referenced against scholarly index APIs (Crossref, OpenAlex) to
                corroborate scientific assertions against primary literature.
              </p>
            </section>

            {/* Section 2: Verdict Breakdown */}
            <section className="mt-6 border-b border-[#D9DDE3] pb-6">
              <h2 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                2. Verification Verdict Distribution
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {VERDICT_ORDER.map((v) => (
                  <div
                    key={v}
                    className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/50 p-3.5 text-left"
                  >
                    <div className="text-[10.5px] font-medium text-[#71839D]">
                      {VERDICT_META[v].label}
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between">
                      <span className="text-xl font-bold text-[#101B2D]">
                        {verdictCounts[v] || 0}
                      </span>
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: VERDICT_META[v].color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Section 3: Evidence Availability */}
            <section className="mt-6 border-b border-[#D9DDE3] pb-6">
              <h2 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                3. Evidence Availability &amp; Source Coverage
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {evidenceOrder.map((ea) => (
                  <div
                    key={ea}
                    className="flex items-center justify-between rounded-xl border border-[#D9DDE3] bg-white p-4"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[#101B2D]">
                        {EVIDENCE_META[ea].label}
                      </div>
                      <div className="text-[11px] text-[#71839D]">
                        {EVIDENCE_META[ea].description}
                      </div>
                    </div>
                    <span className="font-mono text-xl font-bold text-[#101B2D]">
                      {evidenceCounts[ea] || 0}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Section 4: Detailed Claims Dossier */}
            <section className="mt-6 border-b border-[#D9DDE3] pb-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  4. Extracted Claims &amp; Verification Evidence ({detailClaims.length})
                </h2>
                <Link
                  to={`/results/${encodeURIComponent(detailDoc.id)}`}
                  className="text-xs font-medium text-[#5578B8] hover:underline"
                >
                  View in Dashboard
                </Link>
              </div>

              {detailClaims.length === 0 ? (
                <p className="mt-4 text-xs text-[#71839D]">
                  No claims have been extracted or verified for this document yet.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {detailClaims.map((claim) => (
                    <div
                      key={claim.claimId}
                      className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/30 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#101B2D]">
                            {claim.claimId}
                          </span>
                          {claim.pageNumber && (
                            <span className="text-[11px] text-[#71839D]">
                              Page {claim.pageNumber}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <VerdictBadge verdict={claim.verificationVerdict} />
                          <EvidenceBadge availability={claim.evidenceAvailability} />
                          {typeof claim.confidenceScore === 'number' && (
                            <span className="font-mono text-xs text-[#4B586E]">
                              {Math.round(claim.confidenceScore * 100)}%
                            </span>
                          )}
                        </div>
                      </div>

                      <blockquote className="mt-3 border-l-2 border-[#101B2D] pl-3 text-xs font-medium text-[#111318]">
                        &ldquo;{claim.claimText}&rdquo;
                      </blockquote>

                      <p className="mt-3 text-xs leading-relaxed text-[#4B586E]">
                        {claim.explanation}
                      </p>

                      {claim.referencedPaper && (
                        <div className="mt-2.5 text-[11px] text-[#71839D]">
                          <strong>Referenced Publication:</strong> {claim.referencedPaper}
                          {claim.doi ? (
                            <a
                              href={`https://doi.org/${claim.doi}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 font-mono text-[#5578B8] hover:underline"
                            >
                              doi:{claim.doi}
                            </a>
                          ) : null}
                        </div>
                      )}

                      {claim.supportingArguments && claim.supportingArguments.length > 0 && (
                        <div className="mt-2.5 rounded-lg bg-[#21875A]/8 p-2.5 text-[11px] text-[#14583A]">
                          <strong>Supporting Evidence Excerpt:</strong>
                          <ul className="mt-1 space-y-0.5">
                            {claim.supportingArguments.map((arg, i) => (
                              <li key={i}>• {arg}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {claim.conflictingEvidence && claim.conflictingEvidence.length > 0 && (
                        <div className="mt-2.5 rounded-lg bg-[#C04444]/8 p-2.5 text-[11px] text-[#8C2D2D]">
                          <strong>Contradicting Evidence Excerpt:</strong>
                          <ul className="mt-1 space-y-0.5">
                            {claim.conflictingEvidence.map((conf, i) => (
                              <li key={i}>• {conf}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Section 5: Bibliographic References */}
            <section className="mt-6 border-b border-[#D9DDE3] pb-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  5. Bibliographic References &amp; Scholarly Provenance ({detailCitations.length})
                </h2>
                <Link
                  to={`/citations/${encodeURIComponent(detailDoc.id)}`}
                  className="text-xs font-medium text-[#5578B8] hover:underline"
                >
                  View Citation Graph
                </Link>
              </div>

              {detailCitations.length === 0 ? (
                <p className="mt-4 text-xs text-[#71839D]">
                  No citations were extracted from this document.
                </p>
              ) : (
                <ol className="mt-4 list-decimal space-y-2.5 pl-5 text-xs leading-relaxed text-[#111318]">
                  {detailCitations.map((cit) => (
                    <li key={cit.citationId}>
                      <span className="font-medium">
                        {cit.authors.length ? cit.authors.join(', ') : 'Unknown authors'}
                      </span>
                      {cit.year ? ` (${cit.year}). ` : '. '}
                      <span>{cit.title}. </span>
                      {cit.journal ? <em className="text-[#4B586E]">{cit.journal}. </em> : null}
                      {cit.doi ? (
                        <a
                          href={cit.sourceUrl || `https://doi.org/${cit.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 font-mono text-[11px] text-[#5578B8] hover:underline"
                        >
                          doi:{cit.doi}
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="text-[#71839D]">[No DOI resolved]</span>
                      )}
                      <span className="ml-2 font-mono text-[10.5px] text-[#71839D]">
                        ({cit.resolved ? `Resolved via ${cit.provider}` : 'Unresolved'})
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Section 6: Limitations & Methodology */}
            <section className="mt-6">
              <h2 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                6. Verification Methodology &amp; Limitations
              </h2>
              <div className="mt-3 rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/60 p-5">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0 text-[#B17B26]" />
                  <ul className="space-y-1.5 text-xs leading-relaxed text-[#4B586E]">
                    <li>• Verification verdicts reflect retrieved primary literature evidence and do not replace domain-expert peer review.</li>
                    <li>• Citations where only abstract text was retrievable are flagged as <code>ABSTRACT</code> availability.</li>
                    <li>• Unresolved references denote citations whose titles or DOIs could not be mapped to Crossref or OpenAlex.</li>
                    <li>• Model confidence scores represent confidence in the evidence alignment assessment, not the absolute empirical truth of the scientific claim.</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Footer */}
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#D9DDE3] pt-5 text-[11px] text-[#71839D]">
              <span className="inline-flex items-center gap-1.5">
                <BookOpen size={13} />
                EDUFIND AI · Scientific Literature Evidence Verification
              </span>
              <span className="inline-flex items-center gap-1.5">
                <FileText size={13} />
                Phase 7 Report Generation &amp; Persistence Engine
              </span>
            </div>
          </article>
        </div>
      )}
    </WorkspaceLayout>
  );
}
