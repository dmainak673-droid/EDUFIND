import axios from 'axios';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
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
      return {
        code: 'BACKEND_OFFLINE',
        message: `Cannot reach FastAPI backend at ${API_BASE_URL}. Start the backend server or inspect Demo Mode.`,
      };
    }
    if (error.response.status === 404 || error.response.status === 405 || error.response.status === 501) {
      return {
        code: 'ENDPOINT_NOT_IMPLEMENTED',
        status: error.response.status,
        message: `Endpoint not yet implemented on the FastAPI backend (HTTP ${error.response.status}).`,
      };
    }
    const detail =
      typeof error.response.data === 'object' &&
      error.response.data !== null &&
      'detail' in error.response.data
        ? String((error.response.data as { detail: unknown }).detail)
        : error.message;
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
