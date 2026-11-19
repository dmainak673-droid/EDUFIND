import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  FileText,
  FolderOpen,
  GitFork,
  HelpCircle,
  Home,
  LayoutDashboard,
  Menu,
  Settings,
  Upload,
  User,
  X,
} from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { DEMO_CLAIMS, DEMO_DOCUMENT_ID } from '../../data/demoData';

interface WorkspaceLayoutProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function WorkspaceLayout({
  title,
  subtitle,
  actions,
  children,
}: WorkspaceLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { demoMode, setDemoMode, activeDocumentId, backendHealth } = useWorkspace();
  const location = useLocation();

  const docId = activeDocumentId || DEMO_DOCUMENT_ID;
  const defaultClaimId = DEMO_CLAIMS[0].claimId;

  const workspaceItems = [
    { label: 'Overview', to: `/results/${docId}`, icon: LayoutDashboard },
    { label: 'New Verification', to: '/upload', icon: Upload },
    { label: 'Analysis Progress', to: `/analysis/${docId}`, icon: Activity },
    { label: 'Claim Analysis', to: `/claims/${defaultClaimId}`, icon: FileSearch },
    { label: 'Citation Explorer', to: `/citations/${docId}`, icon: GitFork },
    { label: 'Reports', to: '/reports', icon: FileText },
  ];

  const preferenceItems = [
    { label: 'Settings', to: '/settings', icon: Settings },
    { label: 'Help & Support', to: '/settings#support', icon: HelpCircle },
  ];

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex h-full flex-col bg-[#101B2D] text-[#F5F3ED]">
      {/* Brand header */}
      <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-[#F5F3ED] no-underline"
          onClick={() => setMobileOpen(false)}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F5F3ED] text-xs font-bold tracking-tight text-[#101B2D]">
            ED
          </span>
          {(!collapsed || isMobile) && (
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight text-[#F5F3ED]">
                EDUFIND AI
              </div>
              <div className="text-[10px] tracking-wider text-[#9FB0C8] uppercase">
                Verification Suite
              </div>
            </div>
          )}
        </Link>
        {!isMobile ? (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-white/12 text-[#9FB0C8] transition hover:bg-white/10 hover:text-white"
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation drawer"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-white/12 text-[#F5F3ED]"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {(!collapsed || isMobile) && (
          <div className="mb-2 px-2.5 text-[10.5px] font-semibold tracking-[0.12em] text-[#71839D] uppercase">
            Workspace
          </div>
        )}
        <nav className="space-y-1" aria-label="Workspace navigation">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium no-underline transition ${
                    isActive
                      ? 'bg-[#F5F3ED] text-[#101B2D]'
                      : 'text-[#C8D2E1] hover:bg-white/8 hover:text-white'
                  }`
                }
                title={collapsed && !isMobile ? item.label : undefined}
              >
                <Icon size={16} className="shrink-0" />
                {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="my-5 border-t border-white/10" />

        {(!collapsed || isMobile) && (
          <div className="mb-2 px-2.5 text-[10.5px] font-semibold tracking-[0.12em] text-[#71839D] uppercase">
            Preferences
          </div>
        )}
        <nav className="space-y-1" aria-label="Preferences navigation">
          {preferenceItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.to === '/settings'
                ? location.pathname === '/settings' && location.hash !== '#support'
                : location.pathname === '/settings' && location.hash === '#support';
            return (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium no-underline transition ${
                  isActive
                    ? 'bg-[#F5F3ED] text-[#101B2D]'
                    : 'text-[#C8D2E1] hover:bg-white/8 hover:text-white'
                }`}
                title={collapsed && !isMobile ? item.label : undefined}
              >
                <Icon size={16} className="shrink-0" />
                {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
          <Link
            to="/"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[#C8D2E1] no-underline transition hover:bg-white/8 hover:text-white"
            title={collapsed && !isMobile ? 'Public Landing' : undefined}
          >
            <Home size={16} className="shrink-0" />
            {(!collapsed || isMobile) && <span className="truncate">Landing Page</span>}
          </Link>
        </nav>
      </div>

      {/* Bottom mode & account footer */}
      <div className="border-t border-white/10 p-3">
        {(!collapsed || isMobile) && (
          <div className="mb-3 rounded-lg border border-white/10 bg-white/5 p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="font-medium text-[#C8D2E1]">Data Source</span>
              <span className="font-semibold text-[#F5F3ED]">
                {demoMode ? 'DEMO' : backendHealth?.online ? 'LIVE API' : 'API OFFLINE'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setDemoMode(true)}
                className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  demoMode
                    ? 'bg-[#F5F3ED] text-[#101B2D]'
                    : 'text-[#9FB0C8] hover:bg-white/10'
                }`}
              >
                Demo
              </button>
              <button
                type="button"
                onClick={() => setDemoMode(false)}
                className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  !demoMode
                    ? 'bg-[#F5F3ED] text-[#101B2D]'
                    : 'text-[#9FB0C8] hover:bg-white/10'
                }`}
              >
                Live API
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-[#F5F3ED]">
            <User size={15} />
          </div>
          {(!collapsed || isMobile) && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-[#F5F3ED]">
                Research Workspace
              </div>
              <div className="truncate text-[11px] text-[#9FB0C8]">
                Local Session
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#F5F3ED] text-[#111318]">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden shrink-0 border-r border-[#101B2D]/15 transition-[width] duration-200 lg:block ${
          collapsed ? 'w-[72px]' : 'w-[252px]'
        }`}
      >
        <div className="sticky top-0 h-screen">{renderSidebarContent(false)}</div>
      </aside>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-[#101B2D]/50 backdrop-blur-[2px] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[268px] shadow-2xl lg:hidden"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderSidebarContent(true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[#D9DDE3] bg-[#F5F3ED]/92 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[#D9DDE3] bg-white text-[#101B2D] lg:hidden"
              >
                <Menu size={17} />
              </button>
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-[#101B2D] sm:text-xl">
                  {title}
                </h1>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-[#71839D] sm:text-[13px]">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

// Re-export icons used for quick workspace links if needed
export { BarChart3, FolderOpen };
