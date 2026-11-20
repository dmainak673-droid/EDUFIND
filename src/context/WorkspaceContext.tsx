import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  checkBackendHealth,
  deleteDocument,
  fetchDocuments,
  type HealthCheckResult,
} from '../api/verification';
import { normalizeApiError } from '../api/client';
import { DEMO_DOCUMENT_ID } from '../data/demoData';
import {
  adaptDocumentResponseToRecord,
  type DocumentRecord,
} from '../types/verification';

const PENDING_UPLOAD_KEY = 'edufind_pending_upload_doc';

interface WorkspaceContextValue {
  demoMode: boolean;
  setDemoMode: (val: boolean) => void;
  backendHealth: HealthCheckResult | null;
  checkingHealth: boolean;
  refreshHealth: () => Promise<void>;
  liveDocuments: DocumentRecord[];
  loadingDocuments: boolean;
  documentsError: string | null;
  refreshDocuments: () => Promise<void>;
  addLiveDocument: (doc: DocumentRecord) => void;
  removeLiveDocument: (documentId: string) => Promise<void>;
  activeDocumentId: string;
  setActiveDocumentId: (id: string) => void;
  pendingUploadDoc: DocumentRecord | null;
  setPendingUploadDoc: (doc: DocumentRecord | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function getInitialPendingDoc(): DocumentRecord | null {
  try {
    const raw = sessionStorage.getItem(PENDING_UPLOAD_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DocumentRecord;
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [demoMode, setDemoMode] = useState<boolean>(true);
  const [backendHealth, setBackendHealth] = useState<HealthCheckResult | null>(null);
  const [checkingHealth, setCheckingHealth] = useState<boolean>(false);
  const [liveDocuments, setLiveDocuments] = useState<DocumentRecord[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState<boolean>(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState<string>(DEMO_DOCUMENT_ID);
  const [pendingUploadDoc, setPendingUploadDocState] = useState<DocumentRecord | null>(getInitialPendingDoc);

  // Stale request counter to avoid race conditions
  const requestSeqRef = useRef<number>(0);

  const setPendingUploadDoc = useCallback((doc: DocumentRecord | null) => {
    setPendingUploadDocState(doc);
    try {
      if (doc) {
        sessionStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify(doc));
      } else {
        sessionStorage.removeItem(PENDING_UPLOAD_KEY);
      }
    } catch {
      // Ignore sessionStorage errors
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    setCheckingHealth(true);
    const result = await checkBackendHealth();
    setBackendHealth(result);
    setCheckingHealth(false);
  }, []);

  const refreshDocuments = useCallback(async () => {
    const currentSeq = ++requestSeqRef.current;
    setLoadingDocuments(true);
    setDocumentsError(null);

    try {
      const response = await fetchDocuments(1, 50);
      // Discard if a newer request was dispatched
      if (currentSeq !== requestSeqRef.current) return;

      const records = (response.documents || []).map(adaptDocumentResponseToRecord);
      setLiveDocuments(records);
    } catch (err) {
      if (currentSeq !== requestSeqRef.current) return;
      const info = normalizeApiError(err);
      setDocumentsError(info.message);
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setLoadingDocuments(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  // Load documents when health check succeeds
  useEffect(() => {
    if (backendHealth?.online) {
      refreshDocuments();
    }
  }, [backendHealth?.online, refreshDocuments]);

  const addLiveDocument = useCallback((doc: DocumentRecord) => {
    setLiveDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
    setActiveDocumentId(doc.id);
    setDemoMode(false);
  }, []);

  const removeLiveDocument = useCallback(async (documentId: string) => {
    try {
      await deleteDocument(documentId);
      setLiveDocuments((prev) => prev.filter((d) => d.id !== documentId));
      if (activeDocumentId === documentId) {
        setActiveDocumentId(DEMO_DOCUMENT_ID);
      }
      if (pendingUploadDoc?.id === documentId) {
        setPendingUploadDoc(null);
      }
    } catch (err) {
      const info = normalizeApiError(err);
      setDocumentsError(info.message);
      throw err;
    }
  }, [activeDocumentId, pendingUploadDoc?.id, setPendingUploadDoc]);

  return (
    <WorkspaceContext.Provider
      value={{
        demoMode,
        setDemoMode,
        backendHealth,
        checkingHealth,
        refreshHealth,
        liveDocuments,
        loadingDocuments,
        documentsError,
        refreshDocuments,
        addLiveDocument,
        removeLiveDocument,
        activeDocumentId,
        setActiveDocumentId,
        pendingUploadDoc,
        setPendingUploadDoc,
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
