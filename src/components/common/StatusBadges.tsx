import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  HelpCircle,
  Info,
  Loader2,
  XCircle,
} from 'lucide-react';
import {
  EVIDENCE_META,
  VERDICT_META,
  type AnalysisRunStatus,
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
  const meta = VERDICT_META[verdict] ?? VERDICT_META.INSUFFICIENT_EVIDENCE;
  const Icon =
    verdict === 'SUPPORTED'
      ? CheckCircle2
      : verdict === 'PARTIALLY_SUPPORTED'
        ? AlertCircle
        : verdict === 'UNSUPPORTED'
          ? AlertTriangle
          : verdict === 'CONTRADICTORY' || verdict === 'CONTRADICTED'
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
  const meta = EVIDENCE_META[availability] ?? EVIDENCE_META.NONE;
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

export type StatusBadgeValue =
  | AnalysisRunStatus
  | 'UPLOADED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'READY'
  | 'PARTIAL'
  | 'DRAFT';

export function StatusBadge({
  status,
  size = 'sm',
}: {
  status: StatusBadgeValue;
  size?: 'sm' | 'md';
}) {
  let color = '#64748B';
  let bg = 'rgba(100, 116, 139, 0.12)';
  let border = 'rgba(100, 116, 139, 0.30)';
  let label = status.replace(/_/g, ' ');
  let Icon = Clock;
  let animate = false;

  switch (status) {
    case 'COMPLETED':
    case 'READY':
      color = '#21875A';
      bg = 'rgba(33, 135, 90, 0.10)';
      border = 'rgba(33, 135, 90, 0.28)';
      Icon = CheckCircle2;
      label = status === 'READY' ? 'Ready' : 'Completed';
      break;

    case 'COMPLETED_WITH_WARNINGS':
    case 'PARTIAL':
      color = '#B17B26';
      bg = 'rgba(177, 123, 38, 0.10)';
      border = 'rgba(177, 123, 38, 0.28)';
      Icon = AlertTriangle;
      label = status === 'PARTIAL' ? 'Partial' : 'Completed with Warnings';
      break;

    case 'FAILED':
      color = '#C04444';
      bg = 'rgba(192, 68, 68, 0.10)';
      border = 'rgba(192, 68, 68, 0.28)';
      Icon = XCircle;
      label = 'Failed';
      break;

    case 'VALIDATING':
    case 'EXTRACTING':
    case 'EXTRACTING_CLAIMS':
    case 'RETRIEVING_EVIDENCE':
    case 'VERIFYING':
    case 'PROCESSING':
      color = '#2563EB';
      bg = 'rgba(37, 99, 235, 0.10)';
      border = 'rgba(37, 99, 235, 0.28)';
      Icon = Loader2;
      animate = true;
      if (status === 'PROCESSING') label = 'Processing';
      else if (status === 'VALIDATING') label = 'Validating';
      else if (status === 'EXTRACTING') label = 'Extracting Text';
      else if (status === 'EXTRACTING_CLAIMS') label = 'Extracting Claims';
      else if (status === 'RETRIEVING_EVIDENCE') label = 'Retrieving Evidence';
      else if (status === 'VERIFYING') label = 'Verifying Claims';
      break;

    case 'QUEUED':
      label = 'Queued';
      break;
    case 'UPLOADED':
      label = 'Uploaded';
      break;
    case 'DRAFT':
      label = 'Draft';
      break;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${
        size === 'md' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1 text-[11.5px]'
      }`}
      style={{
        color,
        backgroundColor: bg,
        border: `1px solid ${border}`,
      }}
    >
      <Icon
        size={size === 'md' ? 14 : 12}
        strokeWidth={2.1}
        className={animate ? 'animate-spin' : undefined}
        aria-hidden="true"
      />
      <span>{label}</span>
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
