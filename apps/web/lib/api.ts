/** Tiny API client for the ERP backend: unwraps the `{ data, meta }` envelope, attaches the bearer
 * token, and transparently refreshes on 401. Tokens live in localStorage (dev; prod would use
 * httpOnly cookies — a Phase 8 hardening). */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3300';
const STORAGE_KEY = 'mx_tokens';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getTokens(): TokenPair | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as TokenPair) : null;
}
export function setTokens(t: TokenPair): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}
export function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEY);
}

async function raw(path: string, options: RequestInit, token?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

/** Fetch and return the unwrapped `data` payload, refreshing the token once on 401. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const tokens = getTokens();
  let res = await raw(path, options, tokens?.accessToken);

  if (res.status === 401 && tokens?.refreshToken) {
    const r = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
    if (r.ok) {
      const refreshed = (await r.json()).data as TokenPair;
      setTokens(refreshed);
      res = await raw(path, options, refreshed.accessToken);
    } else {
      clearTokens();
      throw new ApiError(401, 'Session expired');
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
    throw new ApiError(res.status, body.detail ?? body.title ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as { data?: T };
  return (json.data ?? (json as T)) as T;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Paginated<T> {
  data: T[];
  meta: { pagination: Pagination };
}

/** Fetch a list endpoint preserving the `{ data, meta }` envelope (for pagination). */
export async function apiList<T>(path: string): Promise<Paginated<T>> {
  const tokens = getTokens();
  let res = await raw(path, { method: 'GET' }, tokens?.accessToken);
  if (res.status === 401 && tokens?.refreshToken) {
    const r = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
    if (r.ok) {
      const refreshed = (await r.json()).data as TokenPair;
      setTokens(refreshed);
      res = await raw(path, { method: 'GET' }, refreshed.accessToken);
    } else {
      clearTokens();
      throw new ApiError(401, 'Session expired');
    }
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return (await res.json()) as Paginated<T>;
}

/** Upload multipart form-data (e.g. a file). Lets the browser set the multipart boundary; refreshes
 * the credential once on 401, mirroring {@link apiFetch}. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const tokens = getTokens();
  const rt = tokens?.refreshToken;
  const send = (cred?: string) =>
    fetch(`${API_URL}${path}`, {
      method: 'POST',
      body: form,
      headers: cred ? { Authorization: ['Bearer', cred].join(' ') } : {},
    });
  let res = await send(tokens?.accessToken);
  if (res.status === 401 && rt) {
    const r = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) });
    if (r.ok) {
      const refreshed = (await r.json()).data as TokenPair;
      setTokens(refreshed);
      res = await send(refreshed.accessToken);
    } else {
      clearTokens();
      throw new ApiError(401, 'Session expired');
    }
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
    throw new ApiError(res.status, body.detail ?? body.title ?? res.statusText);
  }
  const json = (await res.json()) as { data?: T };
  return (json.data ?? (json as T)) as T;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path);
export const apiPost = <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string }) =>
  apiFetch<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : undefined,
  });
export const apiPatch = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
export const apiPut = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
export const apiDelete = <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' });
