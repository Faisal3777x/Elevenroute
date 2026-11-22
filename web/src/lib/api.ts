import { queryClient } from './query';
import { accessToken, supabase } from './supabase';

/**
 * API base: VITE_API_URL if set. Otherwise the dev server talks to the API on the same host the page came from, on
 * VITE_API_PORT (npm run dev:local: 8001) or 8000, so a phone opening the dev site over Wi-Fi reaches it too; and the
 * built dashboard is served by the API itself (npm run share), so it calls /api on the same origin.
 */
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  (import.meta.env.DEV
    ? `${location.protocol}//${location.hostname || 'localhost'}:${(import.meta.env.VITE_API_PORT as string | undefined) || 8000}`
    : `${location.origin}/api`);

export class ApiError extends Error {}

// Mirrored in api/src/server.ts: these run against the shared demo without giving the visitor a sandbox.
const READ_ONLY_POSTS = new Set(['/route/preview', '/whatif/simulate', '/agent/preview']);

/**
 * A random id this browser keeps (localStorage). On the open public site the API gives each visitor id a private
 * sandbox, so one visitor's edits and resets never touch what others see. Made from getRandomValues, which also works
 * on plain-HTTP LAN links where crypto.randomUUID is unavailable.
 */
function newVisitorId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
let visitor: string | null = null;
function visitorId(): string {
  if (visitor) return visitor;
  try {
    const saved = localStorage.getItem('er-visitor');
    if (saved && /^[0-9a-f-]{36}$/.test(saved)) return (visitor = saved);
    visitor = newVisitorId();
    localStorage.setItem('er-visitor', visitor);
  } catch {
    visitor ??= newVisitorId();
  }
  return visitor;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = await accessToken();
  const headers: Record<string, string> = { 'x-visitor-id': visitorId() };
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
