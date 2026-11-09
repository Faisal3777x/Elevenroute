import { queryClient } from './query';
import { accessToken, supabase } from './supabase';

/**
 * API base: VITE_API_URL if set. Otherwise the dev server (npm run dev) talks to the API on port 8000,
 * and the built dashboard is served by the API itself (npm run share), so it calls /api on the same origin.
 */
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ??
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname || 'localhost'}:8000` : `${location.origin}/api`);

export class ApiError extends Error {}

const READ_ONLY_POSTS = new Set(['/route/preview', '/whatif/simulate']);

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = await accessToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method, signal, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(`Can't reach the ElevenRoute API at ${API_BASE}. Start it with "npm run api".`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    // A request cancelled mid-body must stay cancelled, never resolve with an empty object.
    if (signal?.aborted) throw err;
    if (res.ok) throw new ApiError(`Invalid response from ${path}`);
    data = {};
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // The session was revoked or can't be refreshed: sign out so the sign-in screen appears.
  if (res.status === 401 && supabase && token) void supabase.auth.signOut();
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`);
  // A change on one page can affect numbers on others: mark cached reads stale (active ones refetch).
  // Read-only POSTs (dry runs that fire while typing, simulations) don't change anything.
  if (method !== 'GET' && !READ_ONLY_POSTS.has(path)) void queryClient.invalidateQueries();
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body: unknown = {}, signal?: AbortSignal) => request<T>('POST', path, body, signal),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
