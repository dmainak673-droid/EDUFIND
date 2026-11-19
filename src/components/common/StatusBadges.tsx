import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  HelpCircle,
  Info,
  XCircle,
} from 'lucide-react';
import {
  EVIDENCE_META,
  VERDICT_META,
  type EvidenceAvailability,
  type VerificationVerdict,
} from '../../types/verification';

export function VerdictBadge({
  verdict,
  size = 'sm',
}: {
  verdict: VerificationVerdict;
  size?: 'sm' | 'md';
}) {
  const meta = VERDICT_META[verdict];
  const Icon =
    verdict === 'SUPPORTED'
      ? CheckCircle2
      : verdict === 'PARTIALLY_SUPPORTED'
        ? AlertCircle
        : verdict === 'UNSUPPORTED'
          ? AlertTriangle
          : verdict === 'CONTRADICTORY'
            ? XCircle
            : verdict === 'POTENTIALLY_OUTDATED'
              ? Clock
              : HelpCircle;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${
        size === 'md' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1 text-[11.5px]'
      }`}
      style={{
        color: meta.color,
        backgroundColor: meta.bg,
        border: `1px solid ${meta.border}`,
      }}
    >
      <Icon size={size === 'md' ? 14 : 12} strokeWidth={2.1} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

export function EvidenceBadge({
  availability,
}: {
  availability: EvidenceAvailability;
}) {
  const meta = EVIDENCE_META[availability];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase whitespace-nowrap"
      style={{
        color: meta.color,
        backgroundColor: 'rgba(16, 27, 45, 0.04)',
        border: '1px solid #D9DDE3',
      }}
      title={meta.description}
    >
      <FileText size={11} aria-hidden="true" />
      <span>{availability.replace('_', ' ')}</span>
    </span>
  );
}

export function DemoDataBanner({
  onSwitchToLive,
}: {
  onSwitchToLive?: () => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D9DDE3] bg-[#FFFFFF] px-4 py-3 text-xs text-[#101B2D] shadow-[0_1px_2px_rgba(16,27,45,0.04)]">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-[#101B2D] px-2 py-0.5 text-[10.5px] font-semibold tracking-wider text-[#F5F3ED] uppercase">
          <Info size={11} aria-hidden="true" />
          DEMO DATA
        </span>
        <span className="text-[#4B586E]">
          Viewing clearly separated sample research verification data. Demo records are never mixed with live FastAPI uploads.
        </span>
      </div>
      {onSwitchToLive && (
        <button
          type="button"
          onClick={onSwitchToLive}
          className="cursor-pointer rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-3 py-1 text-[11.5px] font-medium text-[#101B2D] transition hover:border-[#101B2D]"
        >
          Switch to Live Backend
        </button>
      )}
    </div>
  );
}
