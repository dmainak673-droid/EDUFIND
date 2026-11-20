import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ExternalLink,
  FileSearch,
  Loader2,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { DemoDataBanner, EvidenceBadge } from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import { fetchDocument, fetchDocumentCitations } from '../api/verification';
import { normalizeApiError } from '../api/client';
import {
  DEMO_CITATIONS,
  DEMO_DOCUMENTS,
  DEMO_DOCUMENT_ID,
} from '../data/demoData';
import {
  adaptDocumentResponseToRecord,
  type CitationReference,
  type DocumentRecord,
} from '../types/verification';

export default function CitationExplorerPage() {
  const { documentId = DEMO_DOCUMENT_ID } = useParams();
  const { demoMode, setDemoMode, activeDocumentId } = useWorkspace();

  const resolvedDocumentId = !demoMode && documentId === DEMO_DOCUMENT_ID && activeDocumentId !== DEMO_DOCUMENT_ID
    ? activeDocumentId
    : documentId;

  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [citations, setCitations] = useState<CitationReference[]>([]);
  const [selectedCitation, setSelectedCitation] = useState<CitationReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCitations = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (demoMode && resolvedDocumentId === DEMO_DOCUMENT_ID) {
      setDoc(DEMO_DOCUMENTS[0]);
      setCitations(DEMO_CITATIONS);
      setSelectedCitation(DEMO_CITATIONS[0]);
      setLoading(false);
      return;
    }

    try {
      const res = await fetchDocumentCitations(resolvedDocumentId);
      let documentRecord = res.document;
      if (!documentRecord) {
        try {
          const docRes = await fetchDocument(resolvedDocumentId);
          documentRecord = adaptDocumentResponseToRecord(docRes);
        } catch {
          // Document metadata fallback failed
        }
      }
      setDoc(documentRecord);
      setCitations(res.citations);
      setSelectedCitation(res.citations[0] ?? null);
    } catch (err) {
      const info = normalizeApiError(err);
      setError(info.message);
      setDoc(null);
      setCitations([]);
      setSelectedCitation(null);
    } finally {
      setLoading(false);
    }
  }, [demoMode, resolvedDocumentId]);

  useEffect(() => {
    loadCitations();
  }, [loadCitations]);

  // Compute radial node coordinates around the central manuscript node
  const cx = 320;
  const cy = 220;
  const radiusX = 225;
  const radiusY = 155;

  return (
    <WorkspaceLayout
      title="Citation Explorer"
      subtitle="Interactive citation graph mapping the uploaded paper to its resolved and unresolved references"
      actions={
        <Link
          to={`/results/${encodeURIComponent(resolvedDocumentId)}`}
          className="rounded-full border border-[#D9DDE3] bg-white px-4 py-2 text-xs font-medium text-[#101B2D] no-underline hover:border-[#101B2D]"
        >
          Return to Overview
        </Link>
      }
    >
      {doc?.isDemo && <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-[#D9DDE3] bg-white py-20 text-sm text-[#71839D]">
          <Loader2 size={18} className="mr-2 animate-spin text-[#101B2D]" />
          Loading citation graph...
        </div>
      ) : error || !doc ? (
        <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <h2 className="text-base font-semibold text-[#101B2D]">
                Citation graph unavailable
              </h2>
              <p className="mt-1 text-sm text-[#4B586E]">{error}</p>
              <button
                type="button"
                onClick={loadCitations}
                className="mt-4 cursor-pointer rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED]"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Interactive SVG Node Graph */}
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-5 lg:col-span-7">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[#101B2D]">
                  Citation Relationship Graph
                </h2>
                <p className="text-xs text-[#71839D]">
                  Click any reference node to inspect publication metadata and linked claims
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[#4B586E]">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#21875A]" />
                  Full Text
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#B17B26]" />
                  Abstract
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#C04444]" />
                  Unresolved
                </span>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#ECEFF3] bg-[#F5F3ED]/45">
              {citations.length === 0 ? (
                <div className="flex h-72 flex-col items-center justify-center p-8 text-center text-xs text-[#71839D]">
                  <p className="text-sm font-semibold text-[#101B2D]">No Citations Identified</p>
                  <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[#71839D]">
                    No bibliographic references were identified in this manuscript, or citation extraction is still processing.
                  </p>
                </div>
              ) : (
                <svg viewBox="0 0 640 440" className="h-auto w-full select-none">
                {/* Edges */}
                {citations.map((cit, idx) => {
                  const angle = (idx / Math.max(1, citations.length)) * Math.PI * 2 - Math.PI / 2;
                  const nx = cx + Math.cos(angle) * radiusX;
                  const ny = cy + Math.sin(angle) * radiusY;
                  const isSelected = selectedCitation?.citationId === cit.citationId;
                  return (
                    <line
                      key={`edge-${cit.citationId}`}
                      x1={cx}
                      y1={cy}
                      x2={nx}
                      y2={ny}
                      stroke={isSelected ? '#101B2D' : cit.resolved ? '#B6C1D1' : '#C04444'}
                      strokeWidth={isSelected ? 2.4 : 1.4}
                      strokeDasharray={cit.resolved ? undefined : '5 4'}
                    />
                  );
                })}

                {/* Central Main Manuscript Node */}
                <g>
                  <circle cx={cx} cy={cy} r={52} fill="#101B2D" />
                  <circle cx={cx} cy={cy} r={58} fill="none" stroke="#101B2D" strokeOpacity={0.22} />
                  <text
                    x={cx}
                    y={cy - 6}
                    textAnchor="middle"
                    fill="#F5F3ED"
                    fontSize="11"
                    fontWeight="600"
                  >
                    MAIN PAPER
                  </text>
                  <text
                    x={cx}
                    y={cy + 12}
                    textAnchor="middle"
                    fill="#9FB0C8"
                    fontSize="10"
                  >
                    {citations.length} References
                  </text>
                </g>

                {/* Citation Nodes */}
                {citations.map((cit, idx) => {
                  const angle = (idx / Math.max(1, citations.length)) * Math.PI * 2 - Math.PI / 2;
                  const nx = cx + Math.cos(angle) * radiusX;
                  const ny = cy + Math.sin(angle) * radiusY;
                  const isSelected = selectedCitation?.citationId === cit.citationId;
                  const nodeColor = !cit.resolved
                    ? '#C04444'
                    : cit.evidenceAvailability === 'FULL_TEXT'
                      ? '#21875A'
                      : '#B17B26';

                  return (
                    <g
                      key={cit.citationId}
                      onClick={() => setSelectedCitation(cit)}
                      className="cursor-pointer"
                    >
                      {isSelected && (
                        <circle
                          cx={nx}
                          cy={ny}
                          r={31}
                          fill="none"
                          stroke="#101B2D"
                          strokeWidth={2}
                        />
                      )}
                      <circle
                        cx={nx}
                        cy={ny}
                        r={24}
                        fill="#FFFFFF"
                        stroke={nodeColor}
                        strokeWidth={2.5}
                      />
                      <text
                        x={nx}
                        y={ny - 1}
                        textAnchor="middle"
                        fill="#101B2D"
                        fontSize="10.5"
                        fontWeight="600"
                      >
                        {cit.citationId}
                      </text>
                      <text
                        x={nx}
                        y={ny + 12}
                        textAnchor="middle"
                        fill="#71839D"
                        fontSize="9"
                      >
                        {cit.year ?? 'N/A'}
                      </text>
                    </g>
                  );
                })}
              </svg>
              )}
            </div>
          </div>

          {/* Selected Node Inspector */}
          <div className="space-y-4 lg:col-span-5">
            {selectedCitation ? (
              <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#71839D]">
                    {selectedCitation.citationId} ·{' '}
                    {selectedCitation.resolved ? 'RESOLVED' : 'UNRESOLVED'}
                  </span>
                  <EvidenceBadge availability={selectedCitation.evidenceAvailability} />
                </div>

                <h3 className="mt-3 text-base font-semibold leading-snug text-[#101B2D]">
                  {selectedCitation.title}
                </h3>

                <dl className="mt-4 space-y-2.5 text-xs">
                  <div className="flex justify-between gap-3 border-b border-[#F0EFEA] pb-2">
                    <dt className="text-[#71839D]">Authors</dt>
                    <dd className="text-right text-[#111318]">
                      {selectedCitation.authors.join(', ')}
                    </dd>
                  </div>
                  {selectedCitation.journal && (
                    <div className="flex justify-between gap-3 border-b border-[#F0EFEA] pb-2">
                      <dt className="text-[#71839D]">Journal</dt>
                      <dd className="text-right text-[#111318]">{selectedCitation.journal}</dd>
                    </div>
                  )}
                  {selectedCitation.year && (
                    <div className="flex justify-between gap-3 border-b border-[#F0EFEA] pb-2">
                      <dt className="text-[#71839D]">Year</dt>
                      <dd className="font-mono text-[#111318]">{selectedCitation.year}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 border-b border-[#F0EFEA] pb-2">
                    <dt className="text-[#71839D]">Index Source</dt>
                    <dd className="font-medium text-[#101B2D]">
                      {selectedCitation.provider || 'Unknown'}
                    </dd>
                  </div>
                  {selectedCitation.doi && (
                    <div className="flex justify-between gap-3 border-b border-[#F0EFEA] pb-2">
                      <dt className="text-[#71839D]">DOI</dt>
                      <dd className="font-mono text-[#5578B8]">{selectedCitation.doi}</dd>
                    </div>
                  )}
                </dl>

                {selectedCitation.abstractSnippet && (
                  <div className="mt-4 rounded-xl bg-[#F5F3ED]/70 p-3.5 text-xs leading-relaxed text-[#4B586E]">
                    {selectedCitation.abstractSnippet}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {selectedCitation.linkedClaimIds.map((cid) => (
                    <Link
                      key={cid}
                      to={`/claims/${encodeURIComponent(cid)}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#101B2D] px-3.5 py-1.5 text-xs font-medium text-[#F5F3ED] no-underline"
                    >
                      <FileSearch size={12} />
                      <span>Inspect {cid}</span>
                    </Link>
                  ))}
                  {selectedCitation.sourceUrl && (
                    <a
                      href={selectedCitation.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-1.5 text-xs font-medium text-[#101B2D] no-underline hover:border-[#101B2D]"
                    >
                      <span>Open DOI</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6 text-xs text-[#71839D]">
                Select a citation node on the graph to view its details.
              </div>
            )}

            <div className="rounded-2xl border border-[#D9DDE3] bg-white p-5">
              <h3 className="text-xs font-semibold tracking-wider text-[#71839D] uppercase">
                All References ({citations.length})
              </h3>
              <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto text-xs">
                {citations.map((cit) => (
                  <li key={cit.citationId}>
                    <button
                      type="button"
                      onClick={() => setSelectedCitation(cit)}
                      className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition ${
                        selectedCitation?.citationId === cit.citationId
                          ? 'bg-[#101B2D] text-[#F5F3ED]'
                          : 'bg-[#F5F3ED]/60 text-[#101B2D] hover:bg-[#F5F3ED]'
                      }`}
                    >
                      <span className="truncate font-medium">
                        {cit.citationId} · {cit.title}
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] opacity-80">
                        {cit.resolved ? cit.provider : 'Unresolved'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
