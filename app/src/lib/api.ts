import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { accessToken, supabase } from './supabase';

/**
 * Finds the API. EXPO_PUBLIC_API_URL wins; otherwise use the same host as the
 * Expo dev server (your computer's LAN address) on port 8000.
 */
function resolveBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname || 'localhost'}:8000`;
  }
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:8000`;
}

export const API_BASE = resolveBase();

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(`Can't reach the API at ${API_BASE}. Is it running?`);
  }
  const data = await res.json().catch(() => ({}));
  // Session revoked or expired beyond refresh: sign out so the sign-in screen appears.
  if (res.status === 401 && supabase && token) void supabase.auth.signOut();
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
