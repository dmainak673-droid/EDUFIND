import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import {
  DemoDataBanner,
  EvidenceBadge,
  VerdictBadge,
} from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import { fetchClaimDetail } from '../api/verification';
import { normalizeApiError } from '../api/client';
import { DEMO_CLAIMS, DEMO_DOCUMENT_ID } from '../data/demoData';
import {
  EVIDENCE_META,
  VERDICT_META,
  type ClaimRecord,
} from '../types/verification';

function HighlightedText({
  text,
  highlight,
  tone,
}: {
  text: string;
  highlight?: string;
  tone: 'neutral' | 'match' | 'conflict';
}) {
  if (!highlight) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (idx === -1) return <>{text}</>;

  const before = text.slice(0, idx);
  const matched = text.slice(idx, idx + highlight.length);
  const after = text.slice(idx + highlight.length);

  const cls =
    tone === 'conflict'
      ? 'rounded bg-[#C04444]/14 px-1 py-0.5 text-[#8C2D2D] font-medium'
      : tone === 'match'
        ? 'rounded bg-[#21875A]/14 px-1 py-0.5 text-[#14583A] font-medium'
        : 'rounded bg-[#5578B8]/14 px-1 py-0.5 text-[#101B2D] font-medium';

  return (
    <>
      {before}
      <mark className={cls}>{matched}</mark>
      {after}
    </>
  );
}

export default function ClaimDetailsPage() {
  const { claimId = DEMO_CLAIMS[0].claimId } = useParams();
  const navigate = useNavigate();
  const { demoMode, setDemoMode, activeDocumentId } = useWorkspace();

  const [claim, setClaim] = useState<ClaimRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadClaim = useCallback(async () => {
    setLoading(true);
    setError(null);

    const demoMatch = DEMO_CLAIMS.find((c) => c.claimId === claimId);
    if (demoMode && demoMatch) {
      setClaim(demoMatch);
      setLoading(false);
      return;
    }

    try {
      const data = await fetchClaimDetail(claimId);
      setClaim(data);
    } catch (err) {
      const info = normalizeApiError(err);
      setError(info.message);
      setClaim(null);
    } finally {
      setLoading(false);
    }
  }, [claimId, demoMode]);

  useEffect(() => {
    loadClaim();
  }, [loadClaim]);

  const demoIdx = DEMO_CLAIMS.findIndex((c) => c.claimId === claimId);
  const prevDemoClaim = demoIdx > 0 ? DEMO_CLAIMS[demoIdx - 1] : null;
  const nextDemoClaim =
    demoIdx >= 0 && demoIdx < DEMO_CLAIMS.length - 1 ? DEMO_CLAIMS[demoIdx + 1] : null;

  const isConflictVerdict =
    claim?.verificationVerdict === 'CONTRADICTORY' ||
    claim?.verificationVerdict === 'UNSUPPORTED' ||
    claim?.verificationVerdict === 'CONTRADICTED';

  const returnDocId = claim?.documentId || (activeDocumentId !== DEMO_DOCUMENT_ID ? activeDocumentId : '') || DEMO_DOCUMENT_ID;

  return (
    <WorkspaceLayout
      title={`Claim Investigation · ${claimId}`}
      subtitle="Traceable side-by-side scientific evidence inspection"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/results/${encodeURIComponent(returnDocId)}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-2 text-xs font-medium text-[#101B2D] no-underline transition hover:border-[#101B2D]"
          >
            <ArrowLeft size={13} />
            <span>Back to Overview</span>
          </Link>
          {demoMode && prevDemoClaim && (
            <Link
              to={`/claims/${prevDemoClaim.claimId}`}
              className="rounded-full border border-[#D9DDE3] bg-white px-3 py-2 text-xs font-medium text-[#101B2D] no-underline hover:border-[#101B2D]"
            >
              Prev ({prevDemoClaim.claimId})
            </Link>
          )}
          {demoMode && nextDemoClaim && (
            <Link
              to={`/claims/${nextDemoClaim.claimId}`}
              className="inline-flex items-center gap-1 rounded-full bg-[#101B2D] px-3.5 py-2 text-xs font-semibold text-[#F5F3ED] no-underline"
            >
              <span>Next ({nextDemoClaim.claimId})</span>
              <ArrowRight size={13} />
            </Link>
          )}
        </div>
      }
    >
      {demoMode && <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-[#D9DDE3] bg-white py-20 text-sm text-[#71839D]">
          <Loader2 size={18} className="mr-2 animate-spin text-[#101B2D]" />
          Loading claim evidence dossier...
        </div>
      ) : error || !claim ? (
        <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <h2 className="text-base font-semibold text-[#101B2D]">
                Claim Verification Unavailable
              </h2>
              <p className="mt-1 text-sm text-[#4B586E]">
                {error || `Verification assessment has not been recorded for claim ID '${claimId}'. The document analysis may still be processing, or verification failed.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={loadClaim}
                  className="cursor-pointer rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED]"
                >
                  Retry
                </button>
                <Link
                  to={`/results/${encodeURIComponent(returnDocId)}`}
                  className="rounded-full border border-[#D9DDE3] bg-white px-4 py-2 text-xs font-medium text-[#101B2D] no-underline"
                >
                  Return to Overview
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setDemoMode(true);
                    navigate(`/claims/${DEMO_CLAIMS[0].claimId}`);
                  }}
                  className="cursor-pointer rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-4 py-2 text-xs font-medium text-[#101B2D]"
                >
                  Inspect Demo Claim
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section A & B: Original Claim + Verification Verdict */}
          <div className="grid gap-6 lg:grid-cols-12">
            <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6 lg:col-span-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-[#71839D]">
                  SECTION A · ORIGINAL EXTRACTED CLAIM · {claim.claimId}
                </span>
                {typeof claim.pageNumber === 'number' && (
                  <span className="rounded-md bg-[#F5F3ED] px-2.5 py-1 text-[11px] font-medium text-[#101B2D]">
                    Page {claim.pageNumber}
                  </span>
                )}
              </div>
              <blockquote className="mt-4 border-l-2 border-[#101B2D] pl-4 text-base font-medium leading-relaxed text-[#101B2D] sm:text-lg">
                &ldquo;{claim.claimText}&rdquo;
              </blockquote>
              {claim.surroundingContext && (
                <div className="mt-4 rounded-xl bg-[#F5F3ED]/70 p-4 text-xs leading-relaxed text-[#4B586E]">
                  <div className="mb-1 text-[10.5px] font-semibold tracking-wider text-[#71839D] uppercase">
                    Surrounding Manuscript Context
                  </div>
                  {claim.surroundingContext}
                </div>
              )}
            </section>

            <section className="flex flex-col justify-between rounded-2xl border border-[#D9DDE3] bg-white p-6 lg:col-span-4">
              <div>
                <div className="font-mono text-xs font-semibold text-[#71839D]">
                  SECTION B · VERIFICATION VERDICT
                </div>
                <div className="mt-4">
                  <VerdictBadge verdict={claim.verificationVerdict} size="md" />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-[#4B586E]">
                  {VERDICT_META[claim.verificationVerdict].description}
                </p>
              </div>

              <div className="mt-6 space-y-3 border-t border-[#ECEFF3] pt-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#71839D]">Evidence Availability</span>
                  <EvidenceBadge availability={claim.evidenceAvailability} />
                </div>
                {typeof claim.confidenceScore === 'number' && (
                  <div className="flex items-center justify-between">
                    <span className="text-[#71839D]">Model Confidence</span>
                    <span className="font-mono font-semibold text-[#101B2D]">
                      {Math.round(claim.confidenceScore * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Section D: Two-Column Evidence Comparison */}
          <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
            <div className="mb-4 font-mono text-xs font-semibold text-[#71839D]">
              SECTION D · SIDE-BY-SIDE EVIDENCE COMPARISON
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/55 p-5">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#101B2D]">
                  <FileText size={14} />
                  <span>Original Scientific Claim</span>
                </div>
                <p className="text-sm leading-relaxed text-[#111318]">
                  <HighlightedText
                    text={claim.claimText}
                    highlight={claim.highlightedClaimPhrase}
                    tone={isConflictVerdict ? 'conflict' : 'match'}
                  />
                </p>
              </div>

              <div className="rounded-xl border border-[#D9DDE3] bg-white p-5">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-[#101B2D]">
                  <span className="inline-flex items-center gap-2">
                    <BookOpen size={14} />
                    <span>Retrieved Research Evidence</span>
                  </span>
                  <EvidenceBadge availability={claim.evidenceAvailability} />
                </div>
                {claim.evidencePassage ? (
                  <p className="text-sm leading-relaxed text-[#111318]">
                    <HighlightedText
                      text={claim.evidencePassage}
                      highlight={claim.highlightedEvidencePhrase}
                      tone={isConflictVerdict ? 'conflict' : 'match'}
                    />
                  </p>
                ) : (
                  <div className="rounded-lg border border-dashed border-[#D9DDE3] bg-[#F5F3ED]/50 p-4 text-xs text-[#71839D]">
                    No evidence passage could be retrieved for this citation. Verification is constrained by missing source text.
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section E: AI Explanation */}
          <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
            <div className="font-mono text-xs font-semibold text-[#71839D]">
              SECTION E · VERIFICATION EXPLANATION &amp; REASONING
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#111318]">
              {claim.explanation}
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-[#21875A]/25 bg-[#21875A]/6 p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#21875A]">
                  <CheckCircle2 size={14} />
                  <span>Supporting Arguments</span>
                </div>
                {claim.supportingArguments && claim.supportingArguments.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-xs text-[#1B4332]">
                    {claim.supportingArguments.map((arg, i) => (
                      <li key={i}>• {arg}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-[#71839D]">None identified.</p>
                )}
              </div>

              <div className="rounded-xl border border-[#C04444]/25 bg-[#C04444]/6 p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#C04444]">
                  <ShieldAlert size={14} />
                  <span>Conflicting Evidence</span>
                </div>
                {claim.conflictingEvidence && claim.conflictingEvidence.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-xs text-[#7A2323]">
                    {claim.conflictingEvidence.map((item, i) => (
                      <li key={i}>• {item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-[#71839D]">No direct conflicts detected.</p>
                )}
              </div>

              <div className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/60 p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#4B586E]">
                  <AlertTriangle size={14} />
                  <span>Limitations</span>
                </div>
                {claim.limitations && claim.limitations.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-xs text-[#4B586E]">
                    {claim.limitations.map((lim, i) => (
                      <li key={i}>• {lim}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-[#71839D]">No additional limitations reported.</p>
                )}
              </div>
            </div>
          </section>

          {/* Section C, F & G: Citation Information, Evidence Availability & Source Traceability */}
          <div className="grid gap-6 lg:grid-cols-12">
            <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6 lg:col-span-7">
              <div className="font-mono text-xs font-semibold text-[#71839D]">
                SECTION C &amp; G · CITATION INFORMATION &amp; SOURCE TRACEABILITY
              </div>
              <dl className="mt-4 space-y-3 text-xs">
                <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Referenced Title</dt>
                  <dd className="text-right font-semibold text-[#101B2D]">
                    {claim.referencedPaper || 'Not supplied'}
                  </dd>
                </div>
                {claim.authors && claim.authors.length > 0 && (
                  <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                    <dt className="text-[#71839D]">Authors</dt>
                    <dd className="text-right text-[#111318]">{claim.authors.join(', ')}</dd>
                  </div>
                )}
                {claim.publicationYear && (
                  <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                    <dt className="text-[#71839D]">Publication Year</dt>
                    <dd className="font-mono text-[#111318]">{claim.publicationYear}</dd>
                  </div>
                )}
                {claim.journal && (
                  <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                    <dt className="text-[#71839D]">Journal</dt>
                    <dd className="text-right text-[#111318]">{claim.journal}</dd>
                  </div>
                )}
                {claim.doi && (
                  <div className="flex justify-between gap-4 border-b border-[#F0EFEA] pb-2.5">
                    <dt className="text-[#71839D]">DOI</dt>
                    <dd className="font-mono text-[#5578B8]">{claim.doi}</dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 pt-1">
                  <dt className="text-[#71839D]">Original Source Link</dt>
                  <dd>
                    {claim.evidenceUrl ? (
                      <a
                        href={claim.evidenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#101B2D] px-3.5 py-1.5 text-[11.5px] font-medium text-[#F5F3ED] no-underline hover:bg-[#1b2c47]"
                      >
                        <span>Inspect Primary Source</span>
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="text-[#71839D]">No external URL resolved</span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6 lg:col-span-5">
              <div className="font-mono text-xs font-semibold text-[#71839D]">
                SECTION F · EVIDENCE AVAILABILITY
              </div>
              <div className="mt-4 flex items-center gap-2.5">
                <EvidenceBadge availability={claim.evidenceAvailability} />
                {claim.sourceProvider && (
                  <span className="rounded-md bg-[#F5F3ED] px-2 py-0.5 text-[11px] font-medium text-[#101B2D]">
                    via {claim.sourceProvider}
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[#4B586E]">
                {EVIDENCE_META[claim.evidenceAvailability].description}
              </p>
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-[#F5F3ED]/70 p-3.5 text-[11.5px] text-[#4B586E]">
                <Info size={14} className="mt-0.5 shrink-0 text-[#5578B8]" />
                <span>
                  EDUFIND AI strictly separates verification verdicts from source text availability so abstract-only limits are never hidden.
                </span>
              </div>
            </section>
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
