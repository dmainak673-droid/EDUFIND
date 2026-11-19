import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ArrowUpDown,
  Download,
  ExternalLink,
  GitFork,
  Loader2,
  Search,
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
  type CitationReference,
  type ClaimRecord,
  type DocumentRecord,
  type EvidenceAvailability,
  type VerificationVerdict,
} from '../types/verification';

const PAGE_SIZE = 5;

export default function DashboardPage() {
  const { documentId = DEMO_DOCUMENT_ID } = useParams();
  const navigate = useNavigate();
  const { demoMode, setDemoMode, setActiveDocumentId } = useWorkspace();

  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [citations, setCitations] = useState<CitationReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<VerificationVerdict | 'ALL'>('ALL');
  const [sortField, setSortField] = useState<'claimId' | 'verdict' | 'confidence'>('claimId');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setActiveDocumentId(documentId);
  }, [documentId, setActiveDocumentId]);

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (demoMode && documentId === DEMO_DOCUMENT_ID) {
      setDoc(DEMO_DOCUMENTS[0]);
      setClaims(DEMO_CLAIMS);
      setCitations(DEMO_CITATIONS);
      setLoading(false);
      return;
    }

    try {
      const res = await fetchDocumentResults(documentId);
      setDoc(res.document);
      setClaims(res.claims);
      setCitations(res.citations);
    } catch (err) {
      const info = normalizeApiError(err);
      setError(info.message);
      setDoc(null);
      setClaims([]);
      setCitations([]);
    } finally {
      setLoading(false);
    }
  }, [demoMode, documentId]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const verdictCounts = useMemo(() => {
    const counts: Record<VerificationVerdict, number> = {
      SUPPORTED: 0,
      PARTIALLY_SUPPORTED: 0,
      UNSUPPORTED: 0,
      CONTRADICTORY: 0,
      POTENTIALLY_OUTDATED: 0,
      INSUFFICIENT_EVIDENCE: 0,
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

  return (
    <WorkspaceLayout
      title="Research Verification Overview"
      subtitle={
        doc
          ? `${doc.title} · Status: ${doc.status}${
              doc.lastAnalyzedAt
                ? ` · Last analyzed ${new Date(doc.lastAnalyzedAt).toLocaleString()}`
                : ''
            }`
          : `Document ID: ${documentId}`
      }
      actions={
        doc && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/citations/${encodeURIComponent(doc.id)}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-2 text-xs font-medium text-[#101B2D] no-underline transition hover:border-[#101B2D]"
            >
              <GitFork size={13} />
              <span>Citation Explorer</span>
            </Link>
            <button
              type="button"
              onClick={handleDownloadReport}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED] transition hover:bg-[#1b2c47]"
            >
              <Download size={13} />
              <span>Download Report</span>
            </button>
          </div>
        )
      }
    >
      {doc?.isDemo && <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-[#D9DDE3] bg-white py-20 text-sm text-[#71839D]">
          <Loader2 size={18} className="mr-2 animate-spin text-[#101B2D]" />
          Loading verification analytics...
        </div>
      ) : error || !doc ? (
        <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <h2 className="text-base font-semibold text-[#101B2D]">
                Verification results not available from backend
              </h2>
              <p className="mt-1.5 max-w-xl text-sm text-[#4B586E]">
                {error || 'No verification dataset found for this document ID.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={loadResults}
                  className="cursor-pointer rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED]"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDemoMode(true);
                    navigate(`/results/${DEMO_DOCUMENT_ID}`);
                  }}
                  className="cursor-pointer rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-4 py-2 text-xs font-medium text-[#101B2D]"
                >
                  Open Demo Verification Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 7 Statistics Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className="rounded-xl border border-[#D9DDE3] bg-[#101B2D] p-4 text-[#F5F3ED]">
              <div className="text-[11px] font-medium text-[#9FB0C8]">Total Claims</div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">{claims.length}</div>
            </div>
            {VERDICT_ORDER.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setVerdictFilter((prev) => (prev === v ? 'ALL' : v));
                  setPage(1);
                }}
                className={`cursor-pointer rounded-xl border p-4 text-left transition ${
                  verdictFilter === v
                    ? 'border-[#101B2D] bg-white ring-1 ring-[#101B2D]'
                    : 'border-[#D9DDE3] bg-white hover:border-[#71839D]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#71839D]">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: VERDICT_META[v].color }}
                  />
                  <span className="truncate">{VERDICT_META[v].shortLabel}</span>
                </div>
                <div
                  className="mt-2 text-2xl font-semibold tracking-tight"
                  style={{ color: VERDICT_META[v].color }}
                >
                  {verdictCounts[v]}
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

          {/* Interactive Claims Table */}
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
                    placeholder="Search claims or citations..."
                    className="w-56 rounded-full border border-[#D9DDE3] bg-[#F5F3ED]/60 py-1.5 pr-3 pl-8 text-xs text-[#101B2D] placeholder:text-[#71839D] focus:border-[#101B2D] focus:outline-none"
                  />
                </div>
                <select
                  value={verdictFilter}
                  onChange={(e) => {
                    setVerdictFilter(e.target.value as VerificationVerdict | 'ALL');
                    setPage(1);
                  }}
                  aria-label="Filter by verification verdict"
                  className="rounded-full border border-[#D9DDE3] bg-white px-3 py-1.5 text-xs font-medium text-[#101B2D] focus:border-[#101B2D] focus:outline-none"
                >
                  <option value="ALL">All Verdicts</option>
                  {VERDICT_ORDER.map((v) => (
                    <option key={v} value={v}>
                      {VERDICT_META[v].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#D9DDE3] bg-[#F5F3ED]/60 text-[11px] font-semibold text-[#71839D] uppercase">
                    <th className="w-10 px-4 py-3">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort('claimId')}
                        className="inline-flex cursor-pointer items-center gap-1 uppercase"
                      >
                        <span>Claim ID</span>
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                    <th className="px-3 py-3">Extracted Claim</th>
                    <th className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort('verdict')}
                        className="inline-flex cursor-pointer items-center gap-1 uppercase"
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
                        className="inline-flex cursor-pointer items-center gap-1 uppercase"
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
                        No claims match your current search or verdict filter.
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

            {/* Pagination */}
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
