import axios from 'axios';
import type { ApiEnvelope, ApiErrorPayload, AuthUser, LoginPayload, PagedResponse } from './types';

const normalizeBaseUrl = (value?: string) => value?.trim().replace(/\/+$/, '');

// 🔥 SOLO usa la variable de entorno (SIN localhost)
const configuredApiUrl = normalizeBaseUrl(import.meta.env.VITE_API_URL);

// ❌ Eliminamos localhost completamente
const fallbackApiUrls = [
  configuredApiUrl,
].filter((value): value is string => Boolean(value));

let activeApiUrl = fallbackApiUrls[0]!;

export class ApiError extends Error {
  details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.details = details;
  }
}

const http = axios.create({
  headers: {
    'Content-Type': 'application/json',
  },
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPascalCaseKey(key: string) {
  if (!key) return key;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function normalizeApiShape<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeApiShape(item)) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce<Record<string, unknown>>((accumulator, [key, item]) => {
    accumulator[toPascalCaseKey(key)] = normalizeApiShape(item);
    return accumulator;
  }, {}) as T;
}

export function setAuthToken(token: string | null) {
  if (token) {
    http.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete http.defaults.headers.common.Authorization;
  }
}

function parseError(error: unknown): ApiError {
  if (axios.isAxiosError<ApiErrorPayload>(error)) {
    if (!error.response) {
      return new ApiError('No fue posible conectarse con la API.');
    }

    const payload = error.response?.data;
    const details = payload?.details ?? payload?.errors ?? [];
    const message = payload?.message ?? payload?.error ?? error.message ?? 'No fue posible completar la solicitud.';
    return new ApiError(message, details);
  }

  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError(error.message);

  return new ApiError('No fue posible completar la solicitud.');
}

function isNetworkError(error: unknown) {
  return axios.isAxiosError(error) && !error.response;
}

async function executeWithFallback<T>(operation: (baseUrl: string) => Promise<T>) {
  const baseUrls = [activeApiUrl];

  let lastError: unknown;

  for (const baseUrl of baseUrls) {
    try {
      const result = await operation(baseUrl);
      activeApiUrl = baseUrl;
      return result;
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error)) {
        throw parseError(error);
      }
    }
  }

  throw parseError(lastError);
}

export function getApiErrorMessage(error: unknown) {
  return parseError(error).message;
}

export function getApiErrorDetails(error: unknown) {
  return parseError(error).details;
}

export async function login(payload: LoginPayload): Promise<AuthUser> {
  try {
    const response = await executeWithFallback((baseUrl) =>
      http.post<ApiEnvelope<Record<string, unknown>>>('/api/v1/internal/auth/login', payload, { baseURL: baseUrl }),
    );

    const raw = response.data.data;

    return {
      usuarioGuid: String(raw.usuario_guid ?? ''),
      username: String(raw.username ?? ''),
      correo: String(raw.correo ?? ''),
      nombres: String(raw.nombres ?? ''),
      accessToken: String(raw.access_token ?? ''),
      refreshToken: String(raw.refresh_token ?? ''),
      expiresIn: Number(raw.expires_in ?? 0),
      roles: Array.isArray(raw.roles)
        ? raw.roles.map((value) => String(value).toLowerCase()) as AuthUser['roles']
        : [],
    };
  } catch (error) {
    throw parseError(error);
  }
}

export async function fetchPaged<TRecord>(path: string, page: number, limit: number) {
  try {
    const response = await executeWithFallback((baseUrl) =>
      http.get<PagedResponse<TRecord>>(path, {
        baseURL: baseUrl,
        params: { pagina: page, limite: limit },
      }),
    );

    return {
      ...response.data,
      data: normalizeApiShape(response.data.data),
    };
  } catch (error) {
    throw parseError(error);
  }
}

export async function createRecord<TRecord>(path: string, payload: Record<string, unknown>) {
  try {
    const response = await executeWithFallback((baseUrl) =>
      http.post<ApiEnvelope<TRecord>>(path, payload, { baseURL: baseUrl }),
    );
    return normalizeApiShape(response.data.data);
  } catch (error) {
    throw parseError(error);
  }
}

export async function updateRecord<TRecord>(path: string, id: string | number, payload: Record<string, unknown>) {
  try {
    const response = await executeWithFallback((baseUrl) =>
      http.put<ApiEnvelope<TRecord>>(`${path}/${id}`, payload, { baseURL: baseUrl }),
    );
    return normalizeApiShape(response.data.data);
  } catch (error) {
    throw parseError(error);
  }
}

export async function deleteRecord(path: string, id: string | number) {
  try {
    await executeWithFallback((baseUrl) =>
      http.delete(`${path}/${id}`, { baseURL: baseUrl }),
    );
  } catch (error) {
    throw parseError(error);
  }
}

export async function runAction<TResponse = unknown>(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  payload?: Record<string, unknown>,
) {
  try {
    if (method === 'get') {
      const response = await executeWithFallback((baseUrl) =>
        http.get<TResponse>(path, { baseURL: baseUrl }),
      );
      return normalizeApiShape(response.data);
    }

    if (method === 'delete') {
      const response = await executeWithFallback((baseUrl) =>
        http.delete<TResponse>(path, { baseURL: baseUrl, data: payload }),
      );
      return normalizeApiShape(response.data);
    }

    if (method === 'patch') {
      const response = await executeWithFallback((baseUrl) =>
        http.patch<TResponse>(path, payload, { baseURL: baseUrl }),
      );
      return normalizeApiShape(response.data);
    }

    const response = await executeWithFallback((baseUrl) =>
      http.post<TResponse>(path, payload, { baseURL: baseUrl }),
    );
    return normalizeApiShape(response.data);
  } catch (error) {
    throw parseError(error);
  }
}

export const API_URL = activeApiUrl;
