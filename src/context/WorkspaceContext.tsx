import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { checkBackendHealth, type HealthCheckResult } from '../api/verification';
import { DEMO_DOCUMENT_ID } from '../data/demoData';
import type { DocumentRecord } from '../types/verification';

interface WorkspaceContextValue {
  demoMode: boolean;
  setDemoMode: (val: boolean) => void;
  backendHealth: HealthCheckResult | null;
  checkingHealth: boolean;
  refreshHealth: () => Promise<void>;
  liveDocuments: DocumentRecord[];
  addLiveDocument: (doc: DocumentRecord) => void;
  activeDocumentId: string;
  setActiveDocumentId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [demoMode, setDemoMode] = useState<boolean>(true);
  const [backendHealth, setBackendHealth] = useState<HealthCheckResult | null>(null);
  const [checkingHealth, setCheckingHealth] = useState<boolean>(false);
  const [liveDocuments, setLiveDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string>(DEMO_DOCUMENT_ID);

  const refreshHealth = useCallback(async () => {
    setCheckingHealth(true);
    const result = await checkBackendHealth();
    setBackendHealth(result);
    setCheckingHealth(false);
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const addLiveDocument = useCallback((doc: DocumentRecord) => {
    setLiveDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
    setActiveDocumentId(doc.id);
    setDemoMode(false);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        demoMode,
        setDemoMode,
        backendHealth,
        checkingHealth,
        refreshHealth,
        liveDocuments,
        addLiveDocument,
        activeDocumentId,
        setActiveDocumentId,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return ctx;
}
