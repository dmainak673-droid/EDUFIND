import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  CheckCircle2,
  Database,
  HelpCircle,
  RefreshCw,
  Server,
  ShieldCheck,
  Sliders,
  User,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { EvidenceBadge, VerdictBadge } from '../components/common/StatusBadges';
import { useWorkspace } from '../context/WorkspaceContext';
import { API_BASE_URL } from '../api/client';
import {
  EVIDENCE_META,
  VERDICT_META,
  VERDICT_ORDER,
  type EvidenceAvailability,
} from '../types/verification';

interface LocalPreferences {
  showConfidenceScores: boolean;
  highlightAbstractOnlyWarnings: boolean;
  compactClaimsTable: boolean;
  defaultExportFormat: 'json' | 'print_pdf';
}

const PREFS_STORAGE_KEY = 'edufind_workspace_prefs_v1';

const DEFAULT_PREFS: LocalPreferences = {
  showConfidenceScores: true,
  highlightAbstractOnlyWarnings: true,
  compactClaimsTable: false,
  defaultExportFormat: 'print_pdf',
};

function loadPreferences(): LocalPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<LocalPreferences>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function SettingsPage() {
  const { demoMode, setDemoMode, backendHealth, checkingHealth, refreshHealth } = useWorkspace();
  const location = useLocation();
  const [prefs, setPrefs] = useState<LocalPreferences>(() => loadPreferences());
  const [savedNotice, setSavedNotice] = useState<boolean>(false);

  useEffect(() => {
    if (location.hash === '#support') {
      const el = document.getElementById('support');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [location.hash]);

  const updatePref = <K extends keyof LocalPreferences>(key: K, value: LocalPreferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  };

  const evidenceOrder: EvidenceAvailability[] = ['FULL_TEXT', 'ABSTRACT', 'NONE'];

  return (
    <WorkspaceLayout
      title="Settings & Support"
      subtitle="Manage FastAPI backend connectivity, workspace display preferences, and verification methodology documentation."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Backend + Preferences */}
        <div className="space-y-6 lg:col-span-7">
          {/* FastAPI Backend Connection */}
          <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#101B2D] text-[#F5F3ED]">
                  <Server size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#101B2D]">
                    FastAPI Backend Connection
                  </h2>
                  <p className="mt-0.5 text-xs text-[#71839D]">
                    Configured via <code className="font-mono">VITE_API_BASE_URL</code> in your environment.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={refreshHealth}
                disabled={checkingHealth}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D9DDE3] bg-[#F5F3ED] px-3.5 py-1.5 text-xs font-medium text-[#101B2D] transition hover:border-[#101B2D] disabled:opacity-60"
              >
                <RefreshCw size={13} className={checkingHealth ? 'animate-spin' : ''} />
                {checkingHealth ? 'Checking...' : 'Test Connection'}
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/60 p-4 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-medium text-[#71839D]">API Base URL</div>
                <div className="mt-1 font-mono text-xs font-semibold text-[#101B2D]">
                  {API_BASE_URL}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-[#71839D]">Health Status</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
                  {backendHealth?.online ? (
                    <>
                      <Wifi size={14} className="text-[#21875A]" />
                      <span className="text-[#21875A]">
                        Connected ({backendHealth.status ?? 'ok'})
                      </span>
                    </>
                  ) : (
                    <>
                      <WifiOff size={14} className="text-[#C47A35]" />
                      <span className="text-[#C47A35]">Offline / Unreachable</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {backendHealth && !backendHealth.online && backendHealth.error && (
              <p className="mt-3 text-xs text-[#71839D]">{backendHealth.error.message}</p>
            )}

            {/* Data Source Mode Switcher */}
            <div className="mt-5 border-t border-[#D9DDE3] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#101B2D]">
                    <Database size={14} className="text-[#5578B8]" />
                    Workspace Data Source
                  </div>
                  <p className="mt-0.5 text-xs text-[#71839D]">
                    Demo Mode displays clearly labeled sample neuroscience data and never mixes with live FastAPI uploads.
                  </p>
                </div>
                <div className="inline-flex rounded-full border border-[#D9DDE3] bg-[#F5F3ED] p-1">
                  <button
                    type="button"
                    onClick={() => setDemoMode(true)}
                    className={`cursor-pointer rounded-full px-3.5 py-1 text-xs font-medium transition ${
                      demoMode
                        ? 'bg-[#101B2D] text-[#F5F3ED]'
                        : 'text-[#71839D] hover:text-[#101B2D]'
                    }`}
                  >
                    Demo Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoMode(false)}
                    className={`cursor-pointer rounded-full px-3.5 py-1 text-xs font-medium transition ${
                      !demoMode
                        ? 'bg-[#101B2D] text-[#F5F3ED]'
                        : 'text-[#71839D] hover:text-[#101B2D]'
                    }`}
                  >
                    Live API
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Display & Verification Preferences */}
          <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F5F3ED] text-[#101B2D]">
                  <Sliders size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#101B2D]">
                    Workspace Preferences
                  </h2>
                  <p className="text-xs text-[#71839D]">
                    Saved locally in your browser session.
                  </p>
                </div>
              </div>
              {savedNotice && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#21875A]/10 px-2.5 py-1 text-[11px] font-medium text-[#21875A]">
                  <CheckCircle2 size={12} />
                  Saved
                </span>
              )}
            </div>

            <div className="mt-5 divide-y divide-[#D9DDE3]">
              <label className="flex cursor-pointer items-center justify-between gap-4 py-3.5">
                <div>
                  <div className="text-xs font-semibold text-[#101B2D]">
                    Display model confidence scores
                  </div>
                  <div className="text-[11.5px] text-[#71839D]">
                    Show numeric confidence values when returned by the verification backend.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.showConfidenceScores}
                  onChange={(e) => updatePref('showConfidenceScores', e.target.checked)}
                  className="h-4 w-4 accent-[#101B2D]"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between gap-4 py-3.5">
                <div>
                  <div className="text-xs font-semibold text-[#101B2D]">
                    Highlight abstract-only verification notices
                  </div>
                  <div className="text-[11.5px] text-[#71839D]">
                    Prominently flag claims evaluated solely from bibliographic abstracts.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.highlightAbstractOnlyWarnings}
                  onChange={(e) => updatePref('highlightAbstractOnlyWarnings', e.target.checked)}
                  className="h-4 w-4 accent-[#101B2D]"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between gap-4 py-3.5">
                <div>
                  <div className="text-xs font-semibold text-[#101B2D]">
                    Compact claims table density
                  </div>
                  <div className="text-[11.5px] text-[#71839D]">
                    Show more rows per viewport in the Verification Dashboard.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.compactClaimsTable}
                  onChange={(e) => updatePref('compactClaimsTable', e.target.checked)}
                  className="h-4 w-4 accent-[#101B2D]"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                <div>
                  <div className="text-xs font-semibold text-[#101B2D]">
                    Preferred report export format
                  </div>
                  <div className="text-[11.5px] text-[#71839D]">
                    Default format for exporting academic verification reports.
                  </div>
                </div>
                <select
                  value={prefs.defaultExportFormat}
                  onChange={(e) =>
                    updatePref('defaultExportFormat', e.target.value as 'json' | 'print_pdf')
                  }
                  className="rounded-lg border border-[#D9DDE3] bg-[#F5F3ED] px-3 py-1.5 text-xs font-medium text-[#101B2D] focus:border-[#101B2D] focus:outline-none"
                >
                  <option value="print_pdf">Printable PDF Report</option>
                  <option value="json">Structured JSON</option>
                </select>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Session / Account Transparency */}
        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F5F3ED] text-[#101B2D]">
                <User size={18} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#101B2D]">
                  Account &amp; Authentication
                </h2>
                <p className="text-xs text-[#71839D]">Local Researcher Session</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/60 p-4 text-xs leading-relaxed text-[#4B586E]">
              <div className="flex items-center gap-2 font-semibold text-[#101B2D]">
                <ShieldCheck size={15} className="text-[#5578B8]" />
                No fake authentication active
              </div>
              <p className="mt-1.5">
                Authentication is not yet configured on the FastAPI backend. EDUFIND AI runs in open local researcher mode without simulated user accounts or exposed API keys.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-[#D9DDE3] bg-white p-6">
            <h2 className="text-sm font-semibold text-[#101B2D]">
              Integrated Research Sources
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[#71839D]">
              Citation resolution and metadata enrichment rely on open scholarly registries when enabled on the backend:
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/50 p-3.5">
                <div className="text-xs font-semibold text-[#101B2D]">Crossref REST API</div>
                <div className="mt-0.5 text-[11.5px] text-[#71839D]">
                  DOI resolution, bibliographic verification, journal metadata, and publisher records.
                </div>
              </div>
              <div className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/50 p-3.5">
                <div className="text-xs font-semibold text-[#101B2D]">OpenAlex Scholarly Graph</div>
                <div className="mt-0.5 text-[11.5px] text-[#71839D]">
                  Open-access full-text links, abstracts, author disambiguation, and citation graphs.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Help & Support / Verification Methodology Reference */}
      <section
        id="support"
        className="mt-8 rounded-2xl border border-[#D9DDE3] bg-white p-6 sm:p-8"
      >
        <div className="flex items-center gap-2.5">
          <HelpCircle size={18} className="text-[#5578B8]" />
          <h2 className="text-base font-semibold text-[#101B2D]">
            Help &amp; Verification Methodology Reference
          </h2>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[#71839D]">
          EDUFIND AI assigns standardized verification verdicts and explicitly discloses evidence availability so reviewers can distinguish full-text verification from abstract-only or unresolved citations.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Verdict Definitions */}
          <div>
            <h3 className="text-xs font-semibold tracking-wider text-[#71839D] uppercase">
              Verification Verdicts
            </h3>
            <div className="mt-3 space-y-2.5">
              {VERDICT_ORDER.map((v) => (
                <div
                  key={v}
                  className="flex flex-col gap-1.5 rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/40 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <VerdictBadge verdict={v} />
                  <span className="text-xs text-[#4B586E] sm:max-w-[65%] sm:text-right">
                    {VERDICT_META[v].description}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence Availability Definitions */}
          <div>
            <h3 className="text-xs font-semibold tracking-wider text-[#71839D] uppercase">
              Evidence Availability Tiers
            </h3>
            <div className="mt-3 space-y-2.5">
              {evidenceOrder.map((ev) => (
                <div
                  key={ev}
                  className="rounded-xl border border-[#D9DDE3] bg-[#F5F3ED]/40 p-4"
                >
                  <EvidenceBadge availability={ev} />
                  <p className="mt-2 text-xs leading-relaxed text-[#4B586E]">
                    {EVIDENCE_META[ev].description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </WorkspaceLayout>
  );
}
