import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  GitFork,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Upload,
  WifiOff,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import {
  DemoDataBanner,
  EvidenceBadge,
  VerdictBadge,
} from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import { fetchDocumentResults } from '../api/verification';
import { normalizeApiError } from '../api/client';
import {
  DEMO_CITATIONS,
  DEMO_CLAIMS,
  DEMO_DOCUMENTS,
  DEMO_DOCUMENT_ID,
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
  type VerificationVerdict,
} from '../types/verification';

const PAGE_SIZE = 5;

export default function DashboardPage() {
  const { documentId: routeDocumentId } = useParams();
  const navigate = useNavigate();
  const {
    demoMode,
    setDemoMode,
    liveDocuments,
    loadingDocuments,
    refreshDocuments,
    backendHealth,
    refreshHealth,
    activeDocumentId,
    setActiveDocumentId,
  } = useWorkspace();

  // Effective document ID resolution
  const resolvedDocumentId = useMemo(() => {
    if (demoMode) {
      return routeDocumentId || DEMO_DOCUMENT_ID;
    }
    // In live mode, prefer route param if not demo ID, otherwise use activeDocumentId or first live doc
    if (routeDocumentId && routeDocumentId !== DEMO_DOCUMENT_ID) {
      return routeDocumentId;
    }
    if (activeDocumentId && activeDocumentId !== DEMO_DOCUMENT_ID) {
      return activeDocumentId;
    }
    if (liveDocuments.length > 0) {
      return liveDocuments[0].id;
    }
    return '';
  }, [demoMode, routeDocumentId, activeDocumentId, liveDocuments]);

  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [analysisRun, setAnalysisRun] = useState<AnalysisRunResponse | null>(null);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [citations, setCitations] = useState<CitationReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters, search, pagination, selection
  const [searchQuery, setSearchQuery] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<VerificationVerdict | 'ALL'>('ALL');
  const [sortField, setSortField] = useState<'claimId' | 'verdict' | 'confidence'>('claimId');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Request sequence counter to discard stale async responses
  const requestSeqRef = useRef<number>(0);

  useEffect(() => {
    if (resolvedDocumentId) {
      setActiveDocumentId(resolvedDocumentId);
    }
  }, [resolvedDocumentId, setActiveDocumentId]);

  // Load results for the target document
  const loadResults = useCallback(async () => {
    const currentSeq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    // DEMO MODE: completely isolated from live backend data
    if (demoMode) {
      const demoDoc = DEMO_DOCUMENTS.find((d) => d.id === resolvedDocumentId) || DEMO_DOCUMENTS[0];
      setDoc(demoDoc);
      setClaims(DEMO_CLAIMS);
      setCitations(DEMO_CITATIONS);
      setAnalysisRun(null);
      setLoading(false);
      return;
    }

    // LIVE MODE: if no live documents exist, don't attempt backend query for dummy ID
    if (!resolvedDocumentId) {
      setDoc(null);
      setClaims([]);
      setCitations([]);
      setAnalysisRun(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetchDocumentResults(resolvedDocumentId);
      if (currentSeq !== requestSeqRef.current) return;

      setDoc(res.document);
      setClaims(res.claims);
      setCitations(res.citations);
      setAnalysisRun(res.analysis ?? null);
    } catch (err) {
      if (currentSeq !== requestSeqRef.current) return;
      const info = normalizeApiError(err);
      setError(info.message);
      setDoc(null);
      setClaims([]);
      setCitations([]);
      setAnalysisRun(null);
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [demoMode, resolvedDocumentId]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Overall Statistics across documents (Requirement 2)
  const totalUploadedDocs = demoMode ? DEMO_DOCUMENTS.length : liveDocuments.length;
  const totalAnalyzedDocs = demoMode
    ? DEMO_DOCUMENTS.length
    : liveDocuments.filter((d) => d.status === 'COMPLETED' || d.extractionStatus === 'EXTRACTED').length;
  const failedAnalysesCount = demoMode
    ? 0
    : liveDocuments.filter((d) => d.status === 'FAILED').length;
  const warningAnalysesCount = demoMode
    ? 1
    : (analysisRun?.warning_count ?? analysisRun?.warningCount ?? 0) +
      liveDocuments.filter((d) => Boolean(d.extractionWarning)).length;

  // Verdict distribution calculations
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
    claims.forEach((c) => {
      counts[c.verificationVerdict] = (counts[c.verificationVerdict] || 0) + 1;
    });
    return counts;
  }, [claims]);

  const verdictChartData = useMemo(
    () =>
      VERDICT_ORDER.map((v) => ({
        key: v,
        name: VERDICT_META[v].shortLabel,
        count: verdictCounts[v],
        color: VERDICT_META[v].color,
      })),
    [verdictCounts],
  );

  const evidenceChartData = useMemo(() => {
    const counts: Record<EvidenceAvailability, number> = {
      FULL_TEXT: 0,
      ABSTRACT: 0,
      NONE: 0,
    };
    claims.forEach((c) => {
      counts[c.evidenceAvailability] = (counts[c.evidenceAvailability] || 0) + 1;
    });
    return (['FULL_TEXT', 'ABSTRACT', 'NONE'] as EvidenceAvailability[]).map((k) => ({
      name: EVIDENCE_META[k].label,
      value: counts[k],
      color: EVIDENCE_META[k].color,
    }));
  }, [claims]);

  const citationChartData = useMemo(() => {
    const resolved = citations.filter((c) => c.resolved).length;
    const unresolved = citations.filter((c) => !c.resolved).length;
    const crossref = citations.filter((c) => c.provider === 'Crossref').length;
    const openalex = citations.filter((c) => c.provider === 'OpenAlex').length;
    return [
      { name: 'Resolved', count: resolved, color: '#21875A' },
      { name: 'Unresolved', count: unresolved, color: '#C04444' },
      { name: 'Crossref', count: crossref, color: '#101B2D' },
      { name: 'OpenAlex', count: openalex, color: '#5578B8' },
    ];
  }, [citations]);

  // Claims filtering and sorting
  const filteredClaims = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = claims.filter((c) => {
      if (verdictFilter !== 'ALL' && c.verificationVerdict !== verdictFilter) return false;
      if (!q) return true;
      return (
        c.claimId.toLowerCase().includes(q) ||
        c.claimText.toLowerCase().includes(q) ||
        (c.referencedPaper ?? '').toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'claimId') {
        cmp = a.claimId.localeCompare(b.claimId);
      } else if (sortField === 'verdict') {
        cmp = a.verificationVerdict.localeCompare(b.verificationVerdict);
      } else {
        cmp = (a.confidenceScore ?? -1) - (b.confidenceScore ?? -1);
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [claims, searchQuery, verdictFilter, sortField, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filteredClaims.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedClaims = filteredClaims.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const toggleSort = (field: 'claimId' | 'verdict' | 'confidence') => {
    if (sortField === field) setSortAsc((a) => !a);
    else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleDownloadReport = () => {
    if (!doc) return;
    const payload = {
      document: doc,
      analysis: analysisRun,
      verdictSummary: verdictCounts,
      claims,
      citations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.id}-verification-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const evidenceCoveragePct =
    claims.length > 0
      ? Math.round(
          (claims.filter((c) => c.evidenceAvailability !== 'NONE').length /
            claims.length) *
            100,
        )
      : 0;

  // Active status display
  const currentStatus = analysisRun?.status || doc?.status || 'UPLOADED';

  return (
    <WorkspaceLayout
      title="Research Verification Overview"
      subtitle={
        doc
          ? `${doc.title} · Status: ${currentStatus}${
              doc.uploadedAt ? ` · Uploaded ${new Date(doc.uploadedAt).toLocaleDateString()}` : ''
            }`
          : demoMode
            ? 'Demo Scientific Literature Verification Suite'
            : 'Live Research Document Workspace'
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* Document Switcher for Live Mode */}
          {!demoMode && liveDocuments.length > 1 && (
            <select
              value={resolvedDocumentId}
              onChange={(e) => navigate(`/results/${encodeURIComponent(e.target.value)}`)}
              className="cursor-pointer rounded-full border border-[#D9DDE3] bg-white px-3.5 py-1.5 text-xs font-medium text-[#101B2D] transition focus:outline-none focus:ring-1 focus:ring-[#101B2D]"
              aria-label="Select uploaded document"
            >
              {liveDocuments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title.length > 32 ? `${d.title.slice(0, 32)}...` : d.title} ({d.status})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => {
              refreshDocuments();
              loadResults();
            }}
            disabled={loading || loadingDocuments}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D] disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          {doc && (
            <>
              <Link
                to={`/analysis/${encodeURIComponent(doc.id)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#101B2D] no-underline transition hover:border-[#101B2D]"
              >
                <Clock size={13} />
                <span>Pipeline Status</span>
              </Link>
              <Link
                to={`/citations/${encodeURIComponent(doc.id)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#101B2D] no-underline transition hover:border-[#101B2D]"
              >
                <GitFork size={13} />
                <span>Citation Explorer</span>
              </Link>
              <button
                type="button"
                onClick={handleDownloadReport}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#101B2D] px-3.5 py-1.5 text-xs font-semibold text-[#F5F3ED] transition hover:bg-[#1b2c47]"
              >
                <Download size={13} />
                <span>Download Report</span>
              </button>
            </>
          )}
        </div>
      }
    >
      {demoMode && <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />}

      {/* OFFLINE STATE (Live Mode when backend health check failed) */}
      {!demoMode && backendHealth && !backendHealth.online && (
        <div className="mb-6 rounded-2xl border border-[#C04444]/30 bg-[#C04444]/8 p-6">
          <div className="flex items-start gap-3">
            <WifiOff size={22} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <h2 className="text-base font-semibold text-[#101B2D]">
                Backend Service Offline
              </h2>
              <p className="mt-1 text-sm text-[#4B586E]">
                Unable to connect to the EDUFIND FastAPI server at <code>/api/health</code>.
                Make sure the backend server is running on <code>http://localhost:8000</code>.
              </p>
              <button
                type="button"
                onClick={() => {
                  refreshHealth();
                  loadResults();
                }}
                className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED]"
              >
                <RefreshCw size={13} />
                <span>Retry Backend Connection</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOADING STATE */}
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-[#D9DDE3] bg-white py-20 text-sm text-[#71839D]">
          <Loader2 size={18} className="mr-2 animate-spin text-[#101B2D]" />
          Loading verification analytics and document results...
        </div>
      ) : !demoMode && liveDocuments.length === 0 ? (
        /* EMPTY STATE: Live Mode with 0 documents */
        <div className="rounded-2xl border border-dashed border-[#D9DDE3] bg-white p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F5F3ED] text-[#101B2D]">
            <Upload size={24} />
          </div>
          <h2 className="mt-4 text-base font-semibold text-[#101B2D]">
            No Research Papers Verified Yet
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[#71839D]">
            Upload a scientific PDF to run the automated claim extraction, citation resolution, and multi-source evidence verification pipeline.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/upload"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#101B2D] px-5 py-2.5 text-xs font-semibold text-[#F5F3ED] no-underline transition hover:bg-[#1b2c47]"
            >
              <Upload size={14} />
              <span>Upload Scientific PDF</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setDemoMode(true);
                navigate(`/results/${DEMO_DOCUMENT_ID}`);
              }}
              className="cursor-pointer rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-4 py-2.5 text-xs font-medium text-[#101B2D]"
            >
              Inspect Demo Dataset
            </button>
          </div>
        </div>
      ) : error || !doc ? (
        /* ERROR STATE */
        <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <h2 className="text-base font-semibold text-[#101B2D]">
                Verification Results Unavailable
              </h2>
              <p className="mt-1.5 max-w-xl text-sm text-[#4B586E]">
                {error || `No verification dataset could be retrieved for document ID: ${resolvedDocumentId}`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={loadResults}
                  className="cursor-pointer rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED]"
                >
                  Retry
                </button>
                <Link
                  to="/upload"
                  className="inline-flex items-center gap-1 rounded-full border border-[#D9DDE3] bg-white px-4 py-2 text-xs font-medium text-[#101B2D] no-underline"
                >
                  <span>Upload New Document</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setDemoMode(true);
                    navigate(`/results/${DEMO_DOCUMENT_ID}`);
                  }}
                  className="cursor-pointer rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-4 py-2 text-xs font-medium text-[#101B2D]"
                >
                  Open Demo Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* MAIN DASHBOARD CONTENT */
        <div className="space-y-6">
          {/* Top Metric Cards: Requirement 2 (Total uploaded, analyzed, status, warnings) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <div className="rounded-xl border border-[#D9DDE3] bg-white p-4">
              <div className="flex items-center justify-between text-[11px] text-[#71839D]">
                <span>Total Uploaded</span>
                <Layers size={13} className="text-[#5578B8]" />
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-[#101B2D]">
                {totalUploadedDocs}
              </div>
              <div className="mt-0.5 text-[10.5px] text-[#71839D]">
                {demoMode ? 'Demo sample papers' : 'Total workspace files'}
              </div>
            </div>

            <div className="rounded-xl border border-[#D9DDE3] bg-white p-4">
              <div className="flex items-center justify-between text-[11px] text-[#71839D]">
                <span>Total Analyzed</span>
                <FileCheck2 size={13} className="text-[#21875A]" />
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-[#21875A]">
                {totalAnalyzedDocs}
              </div>
              <div className="mt-0.5 text-[10.5px] text-[#71839D]">
                Completed verification
              </div>
            </div>

            <div className="rounded-xl border border-[#D9DDE3] bg-white p-4">
              <div className="flex items-center justify-between text-[11px] text-[#71839D]">
                <span>Active Status</span>
                <Clock size={13} className="text-[#5578B8]" />
              </div>
              <div className="mt-2 truncate text-base font-semibold tracking-tight text-[#101B2D]">
                {currentStatus}
              </div>
              <div className="mt-0.5 truncate text-[10.5px] text-[#71839D]">
                {analysisRun?.current_stage || analysisRun?.currentStage || `${claims.length} claims recorded`}
              </div>
            </div>

            <div className="rounded-xl border border-[#D9DDE3] bg-white p-4">
              <div className="flex items-center justify-between text-[11px] text-[#71839D]">
                <span>Warnings</span>
                <AlertTriangle size={13} className="text-[#B17B26]" />
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-[#B17B26]">
                {warningAnalysesCount}
              </div>
              <div className="mt-0.5 text-[10.5px] text-[#71839D]">
                Extraction / quality notices
              </div>
            </div>

            <div className="rounded-xl border border-[#D9DDE3] bg-white p-4">
              <div className="flex items-center justify-between text-[11px] text-[#71839D]">
                <span>Failed Runs</span>
                <AlertCircle size={13} className="text-[#C04444]" />
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-[#C04444]">
                {failedAnalysesCount}
              </div>
              <div className="mt-0.5 text-[10.5px] text-[#71839D]">
                Failed analysis runs
              </div>
            </div>

            <div className="rounded-xl border border-[#D9DDE3] bg-[#101B2D] p-4 text-[#F5F3ED]">
              <div className="flex items-center justify-between text-[11px] text-[#9FB0C8]">
                <span>Total Claims</span>
                <FileText size={13} />
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">
                {claims.length}
              </div>
              <div className="mt-0.5 text-[10.5px] text-[#9FB0C8]">
                {evidenceCoveragePct}% evidence coverage
              </div>
            </div>
          </div>

          {/* Verdict Distribution Quick Filter Buttons */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {VERDICT_ORDER.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setVerdictFilter((prev) => (prev === v ? 'ALL' : v));
                  setPage(1);
                }}
                className={`cursor-pointer rounded-xl border p-3.5 text-left transition ${
                  verdictFilter === v
                    ? 'border-[#101B2D] bg-[#101B2D] text-[#F5F3ED] shadow-sm'
                    : 'border-[#D9DDE3] bg-white text-[#101B2D] hover:border-[#101B2D]/40'
                }`}
              >
                <div
                  className={`text-[10.5px] font-medium tracking-tight ${
                    verdictFilter === v ? 'text-[#9FB0C8]' : 'text-[#71839D]'
                  }`}
                >
                  {VERDICT_META[v].label}
                </div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-xl font-bold">{verdictCounts[v]}</span>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: VERDICT_META[v].color }}
                  />
                </div>
              </button>
            ))}
          </div>

          {/* 3 Recharts Analytics Cards */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-[#D9DDE3] bg-white p-5">
              <h2 className="text-sm font-semibold text-[#101B2D]">
                Verification Verdict Distribution
              </h2>
              <p className="mt-0.5 text-xs text-[#71839D]">
                Count of extracted claims per verification outcome
              </p>
              <div className="mt-4 h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={verdictChartData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ECEFF3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: '#71839D' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#71839D' }} />
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 10,
                        borderColor: '#D9DDE3',
                      }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {verdictChartData.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-[#D9DDE3] bg-white p-5">
              <h2 className="text-sm font-semibold text-[#101B2D]">
                Evidence Availability Distribution
              </h2>
              <p className="mt-0.5 text-xs text-[#71839D]">
                FULL_TEXT vs ABSTRACT vs NONE source coverage
              </p>
              <div className="mt-4 h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={evidenceChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={74}
                      paddingAngle={3}
                    >
                      {evidenceChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 10,
                        borderColor: '#D9DDE3',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex flex-wrap justify-center gap-3 text-[11px] text-[#4B586E]">
                {evidenceChartData.map((item) => (
                  <span key={item.name} className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    {item.name}: <strong>{item.value}</strong>
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#D9DDE3] bg-white p-5">
              <h2 className="text-sm font-semibold text-[#101B2D]">
                Citation Analysis Summary
              </h2>
              <p className="mt-0.5 text-xs text-[#71839D]">
                Resolution status &amp; scholarly index provenance
              </p>
              <div className="mt-4 h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={citationChartData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ECEFF3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#71839D' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#71839D' }} />
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 10,
                        borderColor: '#D9DDE3',
                      }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {citationChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Citation & Coverage Metadata Strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#D9DDE3] bg-white px-4 py-3.5">
              <div className="text-[11px] text-[#71839D]">Total Citations</div>
              <div className="mt-1 text-lg font-semibold text-[#101B2D]">{citations.length}</div>
            </div>
            <div className="rounded-xl border border-[#D9DDE3] bg-white px-4 py-3.5">
              <div className="text-[11px] text-[#71839D]">Resolved References</div>
              <div className="mt-1 text-lg font-semibold text-[#21875A]">
                {citations.filter((c) => c.resolved).length}
              </div>
            </div>
            <div className="rounded-xl border border-[#D9DDE3] bg-white px-4 py-3.5">
              <div className="text-[11px] text-[#71839D]">Unresolved References</div>
              <div className="mt-1 text-lg font-semibold text-[#C04444]">
                {citations.filter((c) => !c.resolved).length}
              </div>
            </div>
            <div className="rounded-xl border border-[#D9DDE3] bg-white px-4 py-3.5">
              <div className="text-[11px] text-[#71839D]">Evidence Coverage</div>
              <div className="mt-1 text-lg font-semibold text-[#101B2D]">
                {evidenceCoveragePct}%
              </div>
            </div>
          </div>

          {/* RECENT ANALYSIS ACTIVITY: Requirement 2 */}
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#101B2D]">
                  Recent Analysis Activity
                </h2>
                <p className="mt-0.5 text-xs text-[#71839D]">
                  {demoMode ? 'Sample literature datasets' : 'Recently uploaded and analyzed documents in this workspace'}
                </p>
              </div>
              <Link
                to="/upload"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#101B2D] no-underline hover:underline"
              >
                <span>Upload New</span>
                <ExternalLink size={11} />
              </Link>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#ECEFF3] text-[11px] font-semibold text-[#71839D]">
                    <th className="pb-2.5">Document Title</th>
                    <th className="pb-2.5">Pages</th>
                    <th className="pb-2.5">Claims</th>
                    <th className="pb-2.5">Citations</th>
                    <th className="pb-2.5">Status</th>
                    <th className="pb-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECEFF3]">
                  {(demoMode ? DEMO_DOCUMENTS : liveDocuments.slice(0, 5)).map((item) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-[#F5F3ED]/40 transition ${
                        item.id === doc.id ? 'bg-[#F5F3ED]/60 font-medium' : ''
                      }`}
                    >
                      <td className="py-2.5 pr-4 text-[#101B2D]">
                        <div className="truncate max-w-sm">{item.title}</div>
                        <div className="text-[10px] text-[#71839D]">{item.fileName}</div>
                      </td>
                      <td className="py-2.5 text-[#4B586E]">{item.pageCount ?? '—'}</td>
                      <td className="py-2.5 text-[#4B586E]">{item.totalClaims}</td>
                      <td className="py-2.5 text-[#4B586E]">{item.totalCitations}</td>
                      <td className="py-2.5">
                        <span className="inline-flex items-center rounded-md bg-[#101B2D]/8 px-2 py-0.5 text-[10.5px] font-medium text-[#101B2D]">
                          {item.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {item.id === doc.id ? (
                          <span className="text-[11px] font-semibold text-[#21875A]">Active</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => navigate(`/results/${encodeURIComponent(item.id)}`)}
                            className="cursor-pointer text-[11px] font-medium text-[#5578B8] hover:underline"
                          >
                            Inspect
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interactive Scientific Claims Table (Requirement 3) */}
          <div className="rounded-2xl border border-[#D9DDE3] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9DDE3] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-[#101B2D]">
                  Extracted Scientific Claims ({filteredClaims.length})
                </h2>
                {selectedIds.length > 0 && (
                  <p className="mt-0.5 text-xs text-[#5578B8]">
                    {selectedIds.length} claim(s) selected for review
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#71839D]"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search claims or cited sources..."
                    className="h-8.5 rounded-full border border-[#D9DDE3] bg-[#F5F3ED]/40 pr-3 pl-8.5 text-xs text-[#111318] placeholder-[#71839D] transition focus:border-[#101B2D] focus:bg-white focus:outline-none"
                  />
                </div>
                {verdictFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => {
                      setVerdictFilter('ALL');
                      setPage(1);
                    }}
                    className="cursor-pointer rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#71839D] hover:text-[#101B2D]"
                  >
                    Clear Filter ({verdictFilter})
                  </button>
                )}
              </div>
            </div>

            {/* Claims Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#ECEFF3] bg-[#F5F3ED]/30 text-[11px] font-semibold text-[#71839D]">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={
                          paginatedClaims.length > 0 &&
                          paginatedClaims.every((c) => selectedIds.includes(c.claimId))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds((prev) => [
                              ...prev,
                              ...paginatedClaims
                                .map((c) => c.claimId)
                                .filter((id) => !prev.includes(id)),
                            ]);
                          } else {
                            const ids = new Set(paginatedClaims.map((c) => c.claimId));
                            setSelectedIds((prev) => prev.filter((id) => !ids.has(id)));
                          }
                        }}
                        aria-label="Select all on this page"
                        className="h-3.5 w-3.5 accent-[#101B2D]"
                      />
                    </th>
                    <th className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort('claimId')}
                        className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[#71839D]"
                      >
                        <span>Claim ID</span>
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                    <th className="px-3 py-3">Claim &amp; Context</th>
                    <th className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort('verdict')}
                        className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[#71839D]"
                      >
                        <span>Verdict</span>
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                    <th className="px-3 py-3">Evidence</th>
                    <th className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort('confidence')}
                        className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[#71839D]"
                      >
                        <span>Confidence</span>
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECEFF3]">
                  {paginatedClaims.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-xs text-[#71839D]">
                        No scientific claims match your search or filter query.
                      </td>
                    </tr>
                  ) : (
                    paginatedClaims.map((claim) => (
                      <tr
                        key={claim.claimId}
                        onClick={() => navigate(`/claims/${encodeURIComponent(claim.claimId)}`)}
                        className="cursor-pointer transition hover:bg-[#F5F3ED]/55"
                      >
                        <td
                          className="px-4 py-3.5"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(claim.claimId)}
                            onChange={() => toggleRow(claim.claimId)}
                            aria-label={`Select ${claim.claimId}`}
                            className="h-3.5 w-3.5 accent-[#101B2D]"
                          />
                        </td>
                        <td className="px-3 py-3.5 font-mono font-semibold text-[#101B2D]">
                          {claim.claimId}
                        </td>
                        <td className="max-w-md px-3 py-3.5">
                          <div className="line-clamp-2 font-medium text-[#111318]">
                            {claim.claimText}
                          </div>
                          {claim.referencedPaper && (
                            <div className="mt-1 truncate text-[11px] text-[#71839D]">
                              Ref: {claim.referencedPaper}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          <VerdictBadge verdict={claim.verificationVerdict} />
                        </td>
                        <td className="px-3 py-3.5">
                          <EvidenceBadge availability={claim.evidenceAvailability} />
                        </td>
                        <td className="px-3 py-3.5 font-mono text-[#4B586E]">
                          {typeof claim.confidenceScore === 'number'
                            ? `${Math.round(claim.confidenceScore * 100)}%`
                            : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <Link
                            to={`/claims/${encodeURIComponent(claim.claimId)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-full border border-[#D9DDE3] bg-white px-3 py-1 text-[11.5px] font-medium text-[#101B2D] no-underline transition hover:border-[#101B2D]"
                          >
                            <span>Investigate</span>
                            <ExternalLink size={11} />
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between border-t border-[#D9DDE3] px-5 py-3 text-xs text-[#71839D]">
              <span>
                Page {safePage} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="cursor-pointer rounded-full border border-[#D9DDE3] bg-white px-3 py-1 text-xs font-medium text-[#101B2D] disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="cursor-pointer rounded-full border border-[#D9DDE3] bg-white px-3 py-1 text-xs font-medium text-[#101B2D] disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
