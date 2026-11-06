/** API base: VITE_API_URL, else the same host as the dashboard on port 8000. */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? `${location.protocol}//${location.hostname || 'localhost'}:8000`;

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body: unknown = {}, signal?: AbortSignal) => request<T>('POST', path, body, signal),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
