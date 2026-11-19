import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { DemoDataBanner } from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import { fetchAnalysisStatus } from '../api/verification';
import { normalizeApiError } from '../api/client';
import { DEMO_ANALYSIS_STATUS, DEMO_DOCUMENT_ID } from '../data/demoData';
import type { AnalysisStatusResponse } from '../types/verification';

export default function AnalysisPage() {
  const { documentId = DEMO_DOCUMENT_ID } = useParams();
  const { demoMode, setDemoMode } = useWorkspace();

  const [statusData, setStatusData] = useState<AnalysisStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (demoMode && documentId === DEMO_DOCUMENT_ID) {
      setStatusData(DEMO_ANALYSIS_STATUS);
      setLoading(false);
      return;
    }

    try {
      const data = await fetchAnalysisStatus(documentId);
      setStatusData(data);
    } catch (err) {
      const info = normalizeApiError(err);
      setError(info.message);
      setStatusData(null);
    } finally {
      setLoading(false);
    }
  }, [demoMode, documentId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return (
    <WorkspaceLayout
      title="Verification Pipeline Progress"
      subtitle={`Document ID: ${documentId}`}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadStatus}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-white px-3.5 py-2 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D]"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Status</span>
          </button>
          {statusData?.status === 'COMPLETED' && (
            <Link
              to={`/results/${encodeURIComponent(documentId)}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED] no-underline"
            >
              <span>View Results</span>
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      }
    >
      {statusData?.isDemo && <DemoDataBanner onSwitchToLive={() => setDemoMode(false)} />}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-[#D9DDE3] bg-white py-20 text-sm text-[#71839D]">
          <Loader2 size={18} className="mr-2 animate-spin text-[#101B2D]" />
          Checking genuine backend analysis status...
        </div>
      ) : error || !statusData ? (
        <div className="rounded-2xl border border-[#D9DDE3] bg-white p-8">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-[#C04444]" />
            <div>
              <h2 className="text-base font-semibold text-[#101B2D]">
                Live analysis status unavailable
              </h2>
              <p className="mt-1.5 max-w-xl text-sm text-[#4B586E]">
                {error ||
                  'The FastAPI backend did not return a processing status for this document. EDUFIND AI does not fabricate processing progress.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={loadStatus}
                  className="cursor-pointer rounded-full bg-[#101B2D] px-4 py-2 text-xs font-semibold text-[#F5F3ED]"
                >
                  Retry Endpoint
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
          {/* 7-Stage Pipeline */}
          <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6 lg:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0EFEA] pb-4">
              <div>
                <h2 className="text-base font-semibold text-[#101B2D]">
                  {statusData.documentTitle}
                </h2>
                <p className="mt-0.5 text-xs text-[#71839D]">
                  Current stage: {statusData.currentStage.replace(/_/g, ' ')}
                </p>
              </div>
              <span className="rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-3 py-1 text-xs font-semibold text-[#101B2D]">
                {statusData.status}
              </span>
            </div>

            {statusData.progressPercent !== null && (
              <div className="mt-5">
                <div className="mb-1.5 flex justify-between text-xs font-medium text-[#4B586E]">
                  <span>Pipeline Completion</span>
                  <span>{statusData.progressPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#F5F3ED]">
                  <div
                    className="h-full rounded-full bg-[#101B2D] transition-[width] duration-300"
                    style={{ width: `${statusData.progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            <ol className="mt-6 space-y-3">
              {statusData.stages.map((stage, idx) => (
                <li
                  key={stage.id}
                  className={`flex items-start gap-3.5 rounded-xl border p-4 transition ${
                    stage.state === 'active'
                      ? 'border-[#5578B8] bg-[#5578B8]/6'
                      : stage.state === 'error'
                        ? 'border-[#C04444]/35 bg-[#C04444]/6'
                        : 'border-[#D9DDE3]/75 bg-[#F5F3ED]/35'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {stage.state === 'completed' ? (
                      <CheckCircle2 size={18} className="text-[#21875A]" />
                    ) : stage.state === 'active' ? (
                      <Loader2 size={18} className="animate-spin text-[#5578B8]" />
                    ) : stage.state === 'error' ? (
                      <AlertCircle size={18} className="text-[#C04444]" />
                    ) : (
                      <Circle size={18} className="text-[#D9DDE3]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#101B2D]">
                        {idx + 1}. {stage.label}
                      </span>
                      {stage.detail && (
                        <span className="text-xs font-medium text-[#71839D]">
                          {stage.detail}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-[#4B586E]">{stage.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Right Summary Telemetry */}
          <div className="space-y-6 lg:col-span-4">
            <div className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
              <h3 className="text-sm font-semibold text-[#101B2D]">Extraction Summary</h3>
              <dl className="mt-4 space-y-3 text-xs">
                <div className="flex justify-between border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Claims Detected</dt>
                  <dd className="font-semibold text-[#101B2D]">
                    {statusData.claimsDetected ?? 'Pending'}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-[#F0EFEA] pb-2.5">
                  <dt className="text-[#71839D]">Citations Identified</dt>
                  <dd className="font-semibold text-[#101B2D]">
                    {statusData.citationsIdentified ?? 'Pending'}
                  </dd>
                </div>
                <div className="pt-0.5">
                  <dt className="text-[#71839D]">Evidence Retrieval Status</dt>
                  <dd className="mt-1 font-medium text-[#101B2D]">
                    {statusData.evidenceRetrievalStatus}
                  </dd>
                </div>
              </dl>
            </div>

            {statusData.warnings.length > 0 && (
              <div className="rounded-2xl border border-[#B17B26]/30 bg-[#B17B26]/8 p-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#B17B26]">
                  <AlertTriangle size={15} />
                  <span>Verification Warnings ({statusData.warnings.length})</span>
                </div>
                <ul className="mt-2.5 space-y-2 text-xs text-[#5E4212]">
                  {statusData.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {statusData.errors.length > 0 && (
              <div className="rounded-2xl border border-[#C04444]/30 bg-[#C04444]/8 p-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#C04444]">
                  <AlertCircle size={15} />
                  <span>Pipeline Errors</span>
                </div>
                <ul className="mt-2.5 space-y-2 text-xs text-[#8C2D2D]">
                  {statusData.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
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
