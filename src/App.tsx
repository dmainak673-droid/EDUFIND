import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { WorkspaceProvider } from './context/WorkspaceContext';
import LandingPage from './pages/LandingPage';
import UploadPage from './pages/UploadPage';
import AnalysisPage from './pages/AnalysisPage';
import DashboardPage from './pages/DashboardPage';
import ClaimDetailsPage from './pages/ClaimDetailsPage';
import CitationExplorerPage from './pages/CitationExplorerPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <WorkspaceProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/analysis/:documentId" element={<AnalysisPage />} />
          <Route path="/results/:documentId" element={<DashboardPage />} />
          <Route path="/claims/:claimId" element={<ClaimDetailsPage />} />
          <Route path="/citations/:documentId" element={<CitationExplorerPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </WorkspaceProvider>
    </BrowserRouter>
  );
}
