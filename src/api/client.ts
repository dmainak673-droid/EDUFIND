import axios from 'axios';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://127.0.0.1:8000');

const DEFAULT_TIMEOUT_MS = 60_000;
const envTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS);
export const API_TIMEOUT_MS =
  Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  headers: {
    Accept: 'application/json',
  },
});

export interface ApiErrorInfo {
  code: 'BACKEND_OFFLINE' | 'ENDPOINT_NOT_IMPLEMENTED' | 'REQUEST_FAILED';
  status?: number;
  message: string;
}

export function normalizeApiError(error: unknown): ApiErrorInfo {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      if (
        error.code === 'ECONNABORTED' ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))
      ) {
        return {
          code: 'REQUEST_FAILED',
          status: 408,
          message: 'The request timed out. The operation may still be processing on the server. Please inspect analysis status.',
        };
      }
      return {
        code: 'BACKEND_OFFLINE',
        message: `Cannot reach FastAPI backend at ${API_BASE_URL}. Start the backend server or inspect Demo Mode.`,
      };
    }
    if (
      error.response.status === 404 ||
      error.response.status === 405 ||
      error.response.status === 501
    ) {
      return {
        code: 'ENDPOINT_NOT_IMPLEMENTED',
        status: error.response.status,
        message: `Endpoint not yet implemented on the FastAPI backend (HTTP ${error.response.status}).`,
      };
    }

    let detail = error.message;
    if (typeof error.response.data === 'object' && error.response.data !== null) {
      const data = error.response.data as { detail?: unknown; message?: unknown };
      if (typeof data.detail === 'string') {
        detail = data.detail;
      } else if (Array.isArray(data.detail)) {
        detail = data.detail
          .map((d: { loc?: unknown[]; msg?: string }) =>
            d && d.msg ? `${Array.isArray(d.loc) ? d.loc.join('.') : ''}: ${d.msg}` : JSON.stringify(d),
          )
          .join('; ');
      } else if (typeof data.message === 'string') {
        detail = data.message;
      }
    }

    return {
      code: 'REQUEST_FAILED',
      status: error.response.status,
      message: detail || `Request failed with HTTP ${error.response.status}.`,
    };
  }
  return {
    code: 'REQUEST_FAILED',
    message: error instanceof Error ? error.message : 'Unexpected network error.',
  };
}
