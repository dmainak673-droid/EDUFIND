import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { DemoDataBanner, StatusBadge } from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  fetchAnalysisStatus,
  retryAnalysis,
  startDocumentAnalysis,
} from '../api/verification';
import { normalizeApiError } from '../api/client';
import { DEMO_ANALYSIS_STATUS, DEMO_DOCUMENT_ID } from '../data/demoData';
import type {
  AnalysisRunResponse,
  AnalysisRunStatus,
  AnalysisStageResponse,
  AnalysisStatusResponse,
  BackendStageKey,
} from '../types/verification';

const CANONICAL_STAGES: { key: BackendStageKey; label: string; description: string }[] = [
  {
    key: 'VALIDATING',
    label: 'Document Validation & Integrity',
    description: 'Cryptographic hash check, PDF signature verification, and page count parsing.',
  },
  {
    key: 'EXTRACTING',
    label: 'Text & Layout Extraction',
    description: 'Structured text segmentation, layout coordinates, and metadata extraction.',
  },
  {
    key: 'EXTRACTING_CLAIMS',
    label: 'Scientific Claim Segmentation',
    description: 'Empirical assertion identification and factual hypothesis boundary extraction.',
  },
  {
    key: 'RETRIEVING_EVIDENCE',
    label: 'Evidence & Literature Retrieval',
    description: 'Resolving citations through Crossref & OpenAlex and retrieving peer-reviewed full texts.',
  },
  {
    key: 'VERIFYING',
    label: 'Claim Verification & Reasoning',
    description: 'Cross-verifying empirical claims against retrieved literature for evidentiary support.',
  },
];

// Module-level set to prevent duplicate background initiation across React StrictMode double-mounts
const activeInitiations = new Set<string>();

function isTerminalStatus(status?: string): boolean {
  return (
    status === 'COMPLETED' ||
    status === 'COMPLETED_WITH_WARNINGS' ||
    status === 'FAILED'
  );
}

function calculateProgress(
  status: AnalysisRunStatus | string,
  stages?: AnalysisStageResponse[] | { status?: string; state?: string }[],
): number {
  if (status === 'COMPLETED' || status === 'COMPLETED_WITH_WARNINGS') return 100;
  if (status === 'FAILED') return 100;
  if (!stages || stages.length === 0) return 10;

  let completed = 0;
  let running = 0;
  stages.forEach((s) => {
    const st =
      'status' in s
        ? s.status
        : 'state' in s
          ? s.state === 'completed'
            ? 'COMPLETED'
            : s.state === 'active'
              ? 'RUNNING'
              : ''
          : '';
    if (st === 'COMPLETED') completed++;
    else if (st === 'RUNNING') running++;
  });

  const total = Math.max(stages.length, 5);
  const pct = Math.round(((completed + (running > 0 ? 0.5 : 0.1)) / total) * 100);
  return Math.min(Math.max(pct, 5), 95);
}

export default function AnalysisPage() {
  const { documentId = DEMO_DOCUMENT_ID } = useParams();
  const { demoMode, setDemoMode } = useWorkspace();

  const [statusData, setStatusData] = useState<(AnalysisRunResponse & AnalysisStatusResponse) | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [pollingNotice, setPollingNotice] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);

  const inFlightPollRef = useRef<boolean>(false);
  const pollingTimerRef = useRef<number | null>(null);
  const pollCountRef = useRef<number>(0);
  const hasInitiatedRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const MAX_POLL_COUNT = 300; // 300 * 2s = 10 minutes max polling window

  const stopPolling = useCallback(() => {
    if (pollingTimerRef.current !== null) {
      window.clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  const armPolling = useCallback(() => {
    if (pollingTimerRef.current === null) {
      pollCountRef.current = 0;
      pollingTimerRef.current = window.setInterval(() => {
        pollCountRef.current += 1;
        if (pollCountRef.current > MAX_POLL_COUNT) {
          stopPolling();
          if (isMountedRef.current) {
            setPollingNotice('Polling paused after 10 minutes. Click "Refresh Status" to continue tracking.');
          }
          return;
        }
        // Poll status without triggering manual loading spinner
        fetchStatus(false);
      }, 2000);
    }
  }, [stopPolling]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dedicated conflict (HTTP 409) handler
  const handleConflictRecovery = useCallback(async (docId: string) => {
    try {
      const activeStatus = await fetchAnalysisStatus(docId);
      if (!isMountedRef.current) return;

      setStatusData(activeStatus);
      setInitialError(null);

      if (isTerminalStatus(activeStatus.status)) {
        stopPolling();
        setPollingNotice('An existing completed analysis was found for this document.');
      } else {
        armPolling();
        setPollingNotice('An active analysis is already in progress on the server. Monitoring live pipeline...');
      }
    } catch (statusErr) {
      if (!isMountedRef.current) return;
      const statusInfo = normalizeApiError(statusErr);

      if (statusInfo.status === 404) {
        // HTTP 409 occurred on analyze, but GET /analysis-status returns 404
        stopPolling();
        setInitialError(
          'A document operation lock is currently held on the backend, but no monitorable analysis run was found (HTTP 409). The lock may be held by a prior service or will expire automatically. Never looping automatically.',
        );
        setPollingNotice(null);
      } else {
        setPollingNotice(`Conflict check error: ${statusInfo.message}`);
      }
    }
  }, [armPolling, stopPolling]);

  // Non-blocking analysis initiation: triggers POST /analyze in background and immediately starts polling
  const initiateAnalysisNonBlocking = useCallback(
    (docId: string) => {
      if (hasInitiatedRef.current || activeInitiations.has(docId)) {
        return;
      }
      hasInitiatedRef.current = true;
      activeInitiations.add(docId);
      setIsStarting(true);
      setInitialError(null);
      setPollingNotice('Initializing analysis pipeline on backend...');

      // Immediately arm 2s status polling without waiting for the synchronous analyze request to finish
      armPolling();

      // Dispatch the analyze call independently
      startDocumentAnalysis(docId)
        .then((runResult) => {
          activeInitiations.delete(docId);
          if (!isMountedRef.current) return;
          setIsStarting(false);
          setPollingNotice(null);
          setStatusData((prev) => ({
            ...(prev || {}),
            ...runResult,
          } as AnalysisRunResponse & AnalysisStatusResponse));

          if (isTerminalStatus(runResult.status)) {
            stopPolling();
          }
        })
        .catch(async (err) => {
          activeInitiations.delete(docId);
          if (!isMountedRef.current) return;
          setIsStarting(false);
          const info = normalizeApiError(err);

          if (info.status === 409) {
            // Correction 3: Handle HTTP 409 conflict
            await handleConflictRecovery(docId);
          } else {
            // Real failure initiating analysis
            setStatusData((prev) => {
              // If polling already picked up terminal status, keep it
              if (prev && isTerminalStatus(prev.status)) return prev;
              setInitialError(`Analysis initiation failed: ${info.message}`);
              stopPolling();
              return null;
            });
          }
        });
    },
    [armPolling, handleConflictRecovery, stopPolling],
  );

  // Status fetcher
  const fetchStatus = useCallback(
    async (isManualRefresh = false) => {
      if (demoMode && documentId === DEMO_DOCUMENT_ID) {
        setStatusData(DEMO_ANALYSIS_STATUS as unknown as AnalysisRunResponse & AnalysisStatusResponse);
        setLoading(false);
        setInitialError(null);
        return;
      }

      if (inFlightPollRef.current) return;
      inFlightPollRef.current = true;
      if (isManualRefresh) setLoading(true);

      try {
        const data = await fetchAnalysisStatus(documentId);
        if (!isMountedRef.current) return;

        setStatusData(data);
        setInitialError(null);
        setPollingNotice(null);

        if (isTerminalStatus(data.status)) {
          stopPolling();
        } else {
          armPolling();
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        const info = normalizeApiError(err);

        if (info.status === 404) {
          // No analysis exists yet for this document!
          if (!hasInitiatedRef.current && !activeInitiations.has(documentId)) {
            // Correction 1: Automatically initiate non-blocking analysis and start polling!
            initiateAnalysisNonBlocking(documentId);
          } else {
            // Initiation already fired or was attempted
            if (!statusData) {
              setInitialError('No active or historical analysis found for this document.');
              stopPolling();
            }
          }
        } else if (info.status === 409) {
          await handleConflictRecovery(documentId);
        } else {
          // Non-destructive network error during polling: preserve existing view
          if (statusData) {
            setPollingNotice(`Temporary network issue: ${info.message}. Polling will continue in 2s...`);
          } else {
            setInitialError(info.message);
            stopPolling();
          }
        }
      } finally {
        inFlightPollRef.current = false;
        if (isMountedRef.current && isManualRefresh) setLoading(false);
      }
    },
    [
      armPolling,
      demoMode,
      documentId,
      handleConflictRecovery,
      initiateAnalysisNonBlocking,
      statusData,
      stopPolling,
    ],
  );

  // Main lifecycle effect
  useEffect(() => {
    isMountedRef.current = true;
    hasInitiatedRef.current = false;
    setLoading(true);

    // Initial status probe on page entry
    fetchStatus(true).then(() => {
      if (isMountedRef.current) setLoading(false);
    });

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, [documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual retry for FAILED analyses
  const handleRetry = async () => {
    if (!statusData?.id || isRetrying) return;
    setIsRetrying(true);
    setPollingNotice('Triggering analysis retry on backend...');
    try {
      await retryAnalysis(statusData.id);
      hasInitiatedRef.current = true;
      armPolling();
      await fetchStatus(true);
    } catch (err) {
      const info = normalizeApiError(err);
      if (info.status === 409) {
        await handleConflictRecovery(documentId);
      } else {
        setPollingNotice(`Retry request failed: ${info.message}`);
      }
    } finally {
      if (isMountedRef.current) setIsRetrying(false);
    }
  };

  // Manual initiation for 404 recovery
  const handleManualStart = () => {
    hasInitiatedRef.current = false;
    activeInitiations.delete(documentId);
    initiateAnalysisNonBlocking(documentId);
  };

  // Map 5 canonical backend stages
  const resolvedStages = CANONICAL_STAGES.map((canonical, idx) => {
    const found = statusData?.stages?.find(
      (s) => ('key' in s && s.key === canonical.key) || ('id' in s && s.id === canonical.key),
    );

    let stageStatus: 'COMPLETED' | 'RUNNING' | 'FAILED' | 'SKIPPED' | 'PENDING' = 'PENDING';
    let detail: string | undefined = undefined;
    let errorMessage: string | null = null;

    if (found) {
      if ('status' in found && found.status) {
        stageStatus = found.status as typeof stageStatus;
      } else if ('state' in found) {
        stageStatus =
          found.state === 'completed'
            ? 'COMPLETED'
            : found.state === 'active'
              ? 'RUNNING'
              : found.state === 'error'
                ? 'FAILED'
                : 'PENDING';
      }
      detail = 'detail' in found ? found.detail : undefined;
      errorMessage = found.error_message || null;
    } else if (
      statusData?.status === 'COMPLETED' ||
      statusData?.status === 'COMPLETED_WITH_WARNINGS'
    ) {
      stageStatus = 'COMPLETED';
    }

    return {
      index: idx + 1,
      key: canonical.key,
      name: found?.display_name || ('label' in found! && found.label) || canonical.label,
      description: ('description' in found! && found.description) || canonical.description,
      status: stageStatus,
      detail,
      errorMessage,
    };
  });

  const currentStatus = statusData?.status || (isStarting ? 'QUEUED' : 'QUEUED');
  const progressPercent = calculateProgress(currentStatus, statusData?.stages);
  const isComplete = currentStatus === 'COMPLETED' || currentStatus === 'COMPLETED_WITH_WARNINGS';
  const isFailed = currentStatus === 'FAILED';
  const isAnalyzing = !isComplete && !isFailed && Boolean(statusData || isStarting);

  return (
    <WorkspaceLayout
      title="Verification Pipeline Progress"
      subtitle={`Document ID: ${documentId}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fetchStatus(true)}
            disabled={loading}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-2 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D] disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading || inFlightPollRef.current ? 'animate-spin' : ''} />
            <span>Refresh Status</span>
          </button>
          {isComplete && (
            <Link
              to={`/results/${encodeURIComponent(documentId)}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED] no-underline transition hover:bg-[#1b2c47]"
            >
              <span>View Results</span>
              <ArrowRight size={14} />
            </Link>
          )}
          {isFailed && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#C04444] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#a33838] disabled:opacity-50"
            >
              <RotateCcw size={13} className={isRetrying ? 'animate-spin' : ''} />
              <span>Retry Analysis</span>
            </button>
          )}
        </div>
      }
    >
      {(demoMode || statusData?.isDemo) && (
        <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />
      )}

      {pollingNotice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#B17B26]/30 bg-[#B17B26]/10 px-4 py-2.5 text-xs text-[#825615]">
          <div className="flex items-center gap-2">
            <Clock size={14} className="shrink-0" />
            <span>{pollingNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setPollingNotice(null)}
            className="text-[11px] font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && !statusData ? (
        <div className="flex items-center justify-center rounded-2xl border border-[#D9DDE3] bg-white py-20 text-sm text-[#71839D]">
          <Loader2 size={18} className="mr-2.5 animate-spin text-[#101B2D]" />
          Connecting to live backend verification pipeline...
        </div>
      ) : initialError && !statusData ? (
        <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <h2 className="text-base font-semibold text-[#101B2D]">
                Pipeline Status Unavailable
              </h2>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[#4B586E]">
                {initialError}
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={handleManualStart}
                  disabled={isStarting}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED] disabled:opacity-50"
                >
                  {isStarting && <Loader2 size={13} className="animate-spin" />}
                  <span>Start Verification Analysis</span>
                </button>
                <button
                  type="button"
                  onClick={() => fetchStatus(true)}
                  className="cursor-pointer rounded-full border border-[#D9DDE3] bg-white px-4 py-2 text-xs font-semibold text-[#101B2D]"
                >
                  Retry Status Check
                </button>
                <Link
                  to={`/analysis/${DEMO_DOCUMENT_ID}`}
                  onClick={() => setDemoMode(true)}
                  className="rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-4 py-2 text-xs font-medium text-[#101B2D] no-underline"
                >
                  View Completed Demo Pipeline
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Main 5-Stage Pipeline Progress */}
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6 lg:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0EFEA] pb-4">
              <div>
                <h2 className="text-base font-semibold text-[#101B2D]">
                  {statusData?.documentTitle || `Document ${documentId.slice(0, 8)}`}
                </h2>
                <p className="mt-0.5 text-xs text-[#71839D]">
                  Pipeline status:{' '}
                  <span className="font-medium text-[#101B2D]">
                    {currentStatus.replace(/_/g, ' ')}
                  </span>
                  {isAnalyzing && ' (Live polling active every 2s)'}
                </p>
              </div>
              <StatusBadge status={currentStatus} size="md" />
            </div>

            {/* Overall Progress Bar */}
            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-xs font-medium text-[#4B586E]">
                <div className="flex items-center gap-1.5">
                  <span>Verification Pipeline Progress</span>
                  {isAnalyzing && (
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#2563EB]" />
                  )}
                </div>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#F5F3ED]">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    isFailed ? 'bg-[#C04444]' : 'bg-[#101B2D]'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Five Real Backend Stages */}
            <ol className="mt-6 space-y-3">
              {resolvedStages.map((stage) => {
                const isStageActive = stage.status === 'RUNNING';
                const isStageComplete = stage.status === 'COMPLETED';
                const isStageFailed = stage.status === 'FAILED';

                return (
                  <li
                    key={stage.key}
                    className={`flex items-start gap-3.5 rounded-xl border p-4 transition ${
                      isStageActive
                        ? 'border-[#2563EB]/40 bg-[#2563EB]/5 shadow-[0_1px_4px_rgba(37,99,235,0.08)]'
                        : isStageFailed
                          ? 'border-[#C04444]/35 bg-[#C04444]/6'
                          : isStageComplete
                            ? 'border-[#21875A]/25 bg-[#21875A]/4'
                            : 'border-[#D9DDE3]/75 bg-[#F5F3ED]/35'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isStageComplete ? (
                        <CheckCircle2 size={18} className="text-[#21875A]" />
                      ) : isStageActive ? (
                        <Loader2 size={18} className="animate-spin text-[#2563EB]" />
                      ) : isStageFailed ? (
                        <AlertCircle size={18} className="text-[#C04444]" />
                      ) : (
                        <Circle size={18} className="text-[#D9DDE3]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#101B2D]">
                          {stage.index}. {stage.name}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10.5px] font-medium tracking-wide uppercase ${
                            isStageComplete
                              ? 'bg-[#21875A]/12 text-[#21875A]'
                              : isStageActive
                                ? 'bg-[#2563EB]/12 text-[#2563EB]'
                                : isStageFailed
                                  ? 'bg-[#C04444]/12 text-[#C04444]'
                                  : 'bg-[#D9DDE3]/60 text-[#71839D]'
                          }`}
                        >
                          {stage.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#4B586E]">{stage.description}</p>
                      {stage.errorMessage && (
                        <p className="mt-1.5 text-xs text-[#C04444]">{stage.errorMessage}</p>
                      )}
                      {stage.detail && (
                        <p className="mt-1 text-[11px] text-[#71839D]">{stage.detail}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Right Summary Telemetry Panel */}
          <div className="space-y-6 lg:col-span-4">
            <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
              <h3 className="text-sm font-semibold text-[#101B2D]">Pipeline Telemetry</h3>
              <dl className="mt-4 space-y-3 text-xs">
                <div className="flex justify-between border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Document ID</dt>
                  <dd className="font-mono text-[11px] text-[#101B2D]" title={documentId}>
                    {documentId.slice(0, 12)}...
                  </dd>
                </div>
                {statusData?.id && (
                  <div className="flex justify-between border-b border-[#F0EFEA] pb-2.5">
                    <dt className="text-[#71839D]">Analysis ID</dt>
                    <dd className="font-mono text-[11px] text-[#101B2D]" title={statusData.id}>
                      {statusData.id.slice(0, 12)}...
                    </dd>
                  </div>
                )}
                <div className="flex justify-between border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Claims Detected</dt>
                  <dd className="font-semibold text-[#101B2D]">
                    {statusData?.total_claims_detected ?? statusData?.claimsDetected ?? '0'}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Claims Verified</dt>
                  <dd className="font-semibold text-[#101B2D]">
                    {statusData?.claims_verified ?? 0}
                  </dd>
                </div>
                <div className="pt-0.5">
                  <dt className="text-[#71839D]">Execution State</dt>
                  <dd className="mt-1 font-medium text-[#101B2D]">
                    {isComplete
                      ? 'Analysis concluded successfully'
                      : isFailed
                        ? 'Analysis halted on error'
                        : isAnalyzing
                          ? 'Processing pipeline stages (polling active)'
                          : 'Awaiting pipeline dispatch'}
                  </dd>
                </div>
              </dl>

              {isComplete && (
                <div className="mt-5 border-t border-[#F0EFEA] pt-4">
                  <Link
                    to={`/results/${encodeURIComponent(documentId)}`}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-[#101B2D] py-2.5 text-xs font-semibold text-[#F5F3ED] no-underline transition hover:bg-[#1b2c47]"
                  >
                    <span>Inspect Results & Evidence</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              )}

              {isFailed && (
                <div className="mt-5 border-t border-[#F0EFEA] pt-4">
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={isRetrying}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#C04444] py-2.5 text-xs font-semibold text-white transition hover:bg-[#a33838] disabled:opacity-50"
                  >
                    <RotateCcw size={14} className={isRetrying ? 'animate-spin' : ''} />
                    <span>Retry Failed Analysis</span>
                  </button>
                </div>
              )}
            </div>

            {/* Error Banner */}
            {(statusData?.error_message || (statusData?.errors && statusData.errors.length > 0)) && (
              <div className="rounded-2xl border border-[#C04444]/30 bg-[#C04444]/8 p-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#C04444]">
                  <AlertCircle size={15} />
                  <span>Pipeline Execution Error</span>
                </div>
                <p className="mt-2 text-xs text-[#8C2D2D]">
                  {statusData.error_message || statusData.errors?.join('; ')}
                </p>
              </div>
            )}

            {/* Warnings Banner */}
            {statusData?.warnings && statusData.warnings.length > 0 && (
              <div className="rounded-2xl border border-[#B17B26]/30 bg-[#B17B26]/8 p-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#B17B26]">
                  <AlertTriangle size={15} />
                  <span>Pipeline Warnings ({statusData.warnings.length})</span>
                </div>
                <ul className="mt-2.5 space-y-1.5 text-xs text-[#5E4212]">
                  {statusData.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
