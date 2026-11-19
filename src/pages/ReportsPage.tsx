import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Printer,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import {
  DemoDataBanner,
  EvidenceBadge,
  VerdictBadge,
} from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import { fetchDocumentResults, fetchReports } from '../api/verification';
import { normalizeApiError, type ApiErrorInfo } from '../api/client';
import {
  DEMO_CITATIONS,
  DEMO_CLAIMS,
  DEMO_DOCUMENTS,
  DEMO_REPORTS,
} from '../data/demoData';
import {
  EVIDENCE_META,
  VERDICT_META,
  VERDICT_ORDER,
  type CitationReference,
  type ClaimRecord,
  type DocumentRecord,
  type EvidenceAvailability,
  type VerificationReport,
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

export default function ReportsPage() {
  const { demoMode, setDemoMode } = useWorkspace();

  const [reports, setReports] = useState<VerificationReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const [detailDoc, setDetailDoc] = useState<DocumentRecord | null>(null);
  const [detailClaims, setDetailClaims] = useState<ClaimRecord[]>([]);
  const [detailCitations, setDetailCitations] = useState<CitationReference[]>([]);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  const loadReports = async () => {
    if (demoMode) {
      setReports(DEMO_REPORTS);
      setSelectedReportId(DEMO_REPORTS[0]?.reportId ?? null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const liveReports = await fetchReports();
      setReports(liveReports);
      setSelectedReportId(liveReports[0]?.reportId ?? null);
    } catch (err) {
      setReports([]);
      setSelectedReportId(null);
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  const selectedReport = useMemo(
    () => reports.find((r) => r.reportId === selectedReportId) ?? reports[0] ?? null,
    [reports, selectedReportId],
  );

  useEffect(() => {
    if (!selectedReport) {
      setDetailDoc(null);
      setDetailClaims([]);
      setDetailCitations([]);
      return;
    }

    if (demoMode || selectedReport.isDemo) {
      const doc =
        DEMO_DOCUMENTS.find((d) => d.id === selectedReport.documentId) ?? DEMO_DOCUMENTS[0];
      setDetailDoc(doc);
      setDetailClaims(DEMO_CLAIMS.filter((c) => c.documentId === doc.id));
      setDetailCitations(DEMO_CITATIONS);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    fetchDocumentResults(selectedReport.documentId)
      .then((res) => {
        if (cancelled) return;
        setDetailDoc(res.document);
        setDetailClaims(res.claims);
        setDetailCitations(res.citations);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailDoc(null);
        setDetailClaims([]);
        setDetailCitations([]);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedReport, demoMode]);

  const handleExportJson = (report: VerificationReport) => {
    const payload = {
      report,
      document: detailDoc,
      claims: detailClaims,
      citations: detailCitations,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.reportId}_verification_report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const evidenceOrder: EvidenceAvailability[] = ['FULL_TEXT', 'ABSTRACT', 'NONE'];

  return (
    <WorkspaceLayout
      title="Verification Reports"
      subtitle="Structured, traceable academic verification reports compiled from extracted claims and retrieved literature."
      actions={
        selectedReport ? (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={() => handleExportJson(selectedReport)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#D9DDE3] bg-white px-4 py-2 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
            >
              <Download size={14} />
              Export JSON
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#101B2D] px-4 py-2 text-xs font-medium text-[#F5F3ED] transition hover:bg-[#1B2B46]"
            >
              <Printer size={14} />
              Print / Save PDF
            </button>
          </div>
        ) : undefined
      }
    >
      {demoMode && <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />}

      {/* Live backend error state */}
      {!demoMode && error && (
        <div className="mb-6 rounded-2xl border border-[#C04444]/30 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-[#C04444]" />
              <div>
                <h2 className="text-sm font-semibold text-[#101B2D]">
                  Unable to load live verification reports
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-[#4B586E]">{error.message}</p>
                <p className="mt-2 text-[11.5px] text-[#71839D]">
                  Expected FastAPI endpoint: <code className="font-mono">GET /api/reports</code>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadReports}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-3.5 py-1.5 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
              >
                <RefreshCw size={13} />
                Retry
              </button>
              <button
                type="button"
                onClick={() => setDemoMode(true)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#101B2D] px-3.5 py-1.5 text-xs font-medium text-[#F5F3ED] transition hover:bg-[#1B2B46]"
              >
                Inspect Demo Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report List */}
      <section className="mb-8 print:hidden">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wider text-[#71839D] uppercase">
            Generated Reports ({reports.length})
          </h2>
          {!demoMode && (
            <button
              type="button"
              onClick={loadReports}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[#5578B8] hover:text-[#101B2D]"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          )}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8 text-center text-sm text-[#71839D]">
            Loading verification reports...
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8 text-center">
            <FileCheck2 size={28} className="mx-auto text-[#71839D]" />
            <p className="mt-3 text-sm font-medium text-[#101B2D]">
              No verification reports available yet
            </p>
            <p className="mt-1 text-xs text-[#71839D]">
              Upload a scientific research PDF to generate a traceable verification report.
            </p>
            <Link
              to="/upload"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#101B2D] px-4 py-2 text-xs font-medium text-[#F5F3ED]"
            >
              Upload Research PDF
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {reports.map((report) => {
              const isSelected = selectedReport?.reportId === report.reportId;
              return (
                <div
                  key={report.reportId}
                  onClick={() => setSelectedReportId(report.reportId)}
                  className={`cursor-pointer rounded-2xl border p-5 transition ${
                    isSelected
                      ? 'border-[#101B2D] bg-white shadow-[0_6px_20px_rgba(16,27,45,0.06)]'
                      : 'border-[#D9DDE3] bg-white/80 hover:border-[#71839D]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-[#F5F3ED] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#101B2D]">
                          {report.reportId}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#21875A]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#21875A]">
                          <CheckCircle2 size={11} />
                          {report.status}
                        </span>
                        <span className="text-xs text-[#71839D]">
                          Analyzed {formatDateTime(report.analyzedAt)}
                        </span>
                      </div>
                      <h3 className="mt-2 text-base font-semibold text-[#101B2D]">
                        {report.documentName}
                      </h3>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-[#D9DDE3] bg-[#F5F3ED] px-2.5 py-1 text-[11px] font-medium text-[#101B2D]">
                          {report.totalClaims} Total Claims
                        </span>
                        {VERDICT_ORDER.map((v) => {
                          const count = report.verdictCounts[v] ?? 0;
                          if (count === 0) return null;
                          return (
                            <span
                              key={v}
                              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                              style={{
                                color: VERDICT_META[v].color,
                                backgroundColor: VERDICT_META[v].bg,
                                border: `1px solid ${VERDICT_META[v].border}`,
                              }}
                            >
                              {VERDICT_META[v].shortLabel}: {count}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Link
                        to={`/results/${report.documentId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-3.5 py-1.5 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
                      >
                        Open Dashboard
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedReportId(report.reportId);
                        }}
                        className="rounded-full bg-[#101B2D] px-3.5 py-1.5 text-xs font-medium text-[#F5F3ED] transition hover:bg-[#1B2B46]"
                      >
                        {isSelected ? 'Viewing Report' : 'Open Report'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Detailed Academic Verification Report (8 Required Sections) */}
      {selectedReport && (
        <article className="rounded-2xl border border-[#D9DDE3] bg-white p-6 shadow-[0_2px_10px_rgba(16,27,45,0.04)] sm:p-10 print:border-0 print:p-0 print:shadow-none">
          {/* Academic Report Header */}
          <div className="border-b border-[#D9DDE3] pb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold tracking-widest text-[#71839D] uppercase">
              <span>EDUFIND AI · Scientific Claim Verification Report</span>
              <span className="font-mono">{selectedReport.reportId}</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#101B2D]">
              {selectedReport.documentName}
            </h2>
            <p className="mt-2 text-xs text-[#71839D]">
              Generated on {formatDateTime(selectedReport.analyzedAt)}
              {selectedReport.isDemo ? ' · Sample Demonstration Dataset' : ''}
            </p>
          </div>

          {detailLoading ? (
            <div className="py-12 text-center text-sm text-[#71839D]">
              Loading full report details...
            </div>
          ) : (
            <div className="mt-8 space-y-10">
              {/* 1. Document Information */}
              <section>
                <h3 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  1. Document Information
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-4 rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/60 p-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-[11px] font-medium text-[#71839D]">File Name</div>
                    <div className="mt-1 truncate text-xs font-semibold text-[#101B2D]">
                      {detailDoc?.fileName ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-[#71839D]">Authors</div>
                    <div className="mt-1 text-xs font-semibold text-[#101B2D]">
                      {detailDoc?.authors?.length ? detailDoc.authors.join(', ') : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-[#71839D]">Publication Info</div>
                    <div className="mt-1 text-xs font-semibold text-[#101B2D]">
                      {detailDoc?.publicationInfo ?? 'Uploaded Manuscript'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-[#71839D]">Scope</div>
                    <div className="mt-1 text-xs font-semibold text-[#101B2D]">
                      {detailDoc?.pageCount ? `${detailDoc.pageCount} pages · ` : ''}
                      {selectedReport.totalClaims} claims · {detailCitations.length} citations
                    </div>
                  </div>
                </div>
              </section>

              {/* 2. Executive Summary */}
              <section>
                <h3 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  2. Executive Summary
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[#111318]">
                  {selectedReport.executiveSummary}
                </p>
              </section>

              {/* 3. Verification Statistics */}
              <section>
                <h3 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  3. Verification Statistics
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {VERDICT_ORDER.map((v) => {
                    const count = selectedReport.verdictCounts[v] ?? 0;
                    const pct =
                      selectedReport.totalClaims > 0
                        ? Math.round((count / selectedReport.totalClaims) * 100)
                        : 0;
                    return (
                      <div
                        key={v}
                        className="rounded-xl border border-[#D9DDE3] bg-white p-3.5"
                      >
                        <div className="text-[11px] font-medium text-[#71839D]">
                          {VERDICT_META[v].shortLabel}
                        </div>
                        <div
                          className="mt-1 text-2xl font-semibold"
                          style={{ color: VERDICT_META[v].color }}
                        >
                          {count}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#71839D]">{pct}% of claims</div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {evidenceOrder.map((ev) => {
                    const count = selectedReport.evidenceCounts[ev] ?? 0;
                    return (
                      <div
                        key={ev}
                        className="flex items-center justify-between rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/50 px-4 py-3"
                      >
                        <div>
                          <div className="text-xs font-semibold text-[#101B2D]">
                            {EVIDENCE_META[ev].label}
                          </div>
                          <div className="text-[11px] text-[#71839D]">
                            Evidence availability tier
                          </div>
                        </div>
                        <span
                          className="text-lg font-semibold"
                          style={{ color: EVIDENCE_META[ev].color }}
                        >
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 4. Individual Claim Verdicts */}
              <section>
                <h3 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  4. Individual Claim Verdicts
                </h3>
                <div className="mt-3 overflow-x-auto rounded-xl border border-[#D9DDE3]">
                  <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#D9DDE3] bg-[#F5F3ED] text-[11px] font-semibold tracking-wider text-[#71839D] uppercase">
                        <th className="px-4 py-3">Claim ID</th>
                        <th className="px-4 py-3">Extracted Claim</th>
                        <th className="px-4 py-3">Verdict</th>
                        <th className="px-4 py-3">Evidence</th>
                        <th className="px-4 py-3 text-right print:hidden">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#D9DDE3]">
                      {detailClaims.map((claim) => (
                        <tr key={claim.claimId} className="align-top hover:bg-[#F5F3ED]/40">
                          <td className="px-4 py-3 font-mono font-semibold text-[#101B2D]">
                            {claim.claimId}
                            {claim.pageNumber ? (
                              <div className="mt-0.5 font-sans text-[10.5px] font-normal text-[#71839D]">
                                p. {claim.pageNumber}
                              </div>
                            ) : null}
                          </td>
                          <td className="max-w-md px-4 py-3 leading-relaxed text-[#111318]">
                            {claim.claimText}
                          </td>
                          <td className="px-4 py-3">
                            <VerdictBadge verdict={claim.verificationVerdict} />
                          </td>
                          <td className="px-4 py-3">
                            <EvidenceBadge availability={claim.evidenceAvailability} />
                          </td>
                          <td className="px-4 py-3 text-right print:hidden">
                            <Link
                              to={`/claims/${claim.claimId}`}
                              className="font-medium text-[#5578B8] hover:text-[#101B2D]"
                            >
                              Investigate →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 5. Evidence Explanations */}
              <section>
                <h3 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  5. Evidence Explanations
                </h3>
                <div className="mt-3 space-y-4">
                  {detailClaims.map((claim) => (
                    <div
                      key={`exp-${claim.claimId}`}
                      className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/40 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#101B2D]">
                            {claim.claimId}
                          </span>
                          <VerdictBadge verdict={claim.verificationVerdict} />
                        </div>
                        <EvidenceBadge availability={claim.evidenceAvailability} />
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-[#111318]">
                        {claim.explanation}
                      </p>
                      {claim.evidencePassage && (
                        <blockquote className="mt-3 border-l-2 border-[#5578B8] pl-3 text-xs italic text-[#4B586E]">
                          “{claim.evidencePassage}”
                        </blockquote>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* 6. Citation Information */}
              <section>
                <h3 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  6. Citation Information
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {detailCitations.map((cit) => (
                    <div
                      key={cit.citationId}
                      className="rounded-xl border border-[#D9DDE3] bg-white p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-semibold text-[#101B2D]">
                          {cit.citationId}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                            cit.resolved
                              ? 'bg-[#21875A]/10 text-[#21875A]'
                              : 'bg-[#C47A35]/10 text-[#C47A35]'
                          }`}
                        >
                          {cit.resolved ? `Resolved · ${cit.provider ?? 'Indexed'}` : 'Unresolved'}
                        </span>
                      </div>
                      <div className="mt-2 text-xs font-semibold text-[#101B2D]">{cit.title}</div>
                      <div className="mt-1 text-[11px] text-[#71839D]">
                        {cit.authors.join(', ')}
                        {cit.year ? ` (${cit.year})` : ''}
                        {cit.journal ? ` · ${cit.journal}` : ''}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <EvidenceBadge availability={cit.evidenceAvailability} />
                        <span className="text-[11px] text-[#71839D]">
                          Linked claims: {cit.linkedClaimIds.join(', ') || 'None'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 7. Source References */}
              <section>
                <h3 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  7. Source References
                </h3>
                <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-xs leading-relaxed text-[#111318]">
                  {detailCitations.map((cit) => (
                    <li key={`ref-${cit.citationId}`}>
                      <span className="font-medium">{cit.authors.join(', ')}</span>
                      {cit.year ? ` (${cit.year}). ` : '. '}
                      <span>{cit.title}. </span>
                      {cit.journal ? <em className="text-[#4B586E]">{cit.journal}. </em> : null}
                      {cit.doi ? (
                        <a
                          href={cit.sourceUrl || `https://doi.org/${cit.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5578B8] hover:underline"
                        >
                          doi:{cit.doi}
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="text-[#71839D]">[Unindexed / No DOI resolved]</span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>

              {/* 8. Verification Limitations */}
              <section>
                <h3 className="text-xs font-semibold tracking-wider text-[#5578B8] uppercase">
                  8. Verification Limitations
                </h3>
                <div className="mt-3 rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/60 p-5">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert size={16} className="mt-0.5 shrink-0 text-[#B17B26]" />
                    <ul className="space-y-2 text-xs leading-relaxed text-[#4B586E]">
                      {selectedReport.limitations.map((item, idx) => (
                        <li key={idx}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>

              {/* Report Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#D9DDE3] pt-5 text-[11px] text-[#71839D]">
                <span className="inline-flex items-center gap-1.5">
                  <BookOpen size={13} />
                  EDUFIND AI · Traceable Scientific Evidence Verification
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={13} />
                  Sources queried via Crossref &amp; OpenAlex where available
                </span>
              </div>
            </div>
          )}
        </article>
      )}
    </WorkspaceLayout>
  );
}
