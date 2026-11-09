import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Supabase client for sign-in only; data goes through the ElevenRoute API, which checks the session token.
 * null when the dashboard is built without Supabase settings (local API with sign-in off).
 */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        // Implicit flow: confirmation and magic links work from any device or browser (PKCE links only
        // complete in the browser that started sign-up, which breaks when the email is opened on a phone).
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

/**
 * Which external sign-in providers are switched on for this project (public auth settings), so the UI
 * never sends people to a provider Supabase will reject. null if the settings can't be read.
 */
export async function enabledProviders(): Promise<Record<string, boolean> | null> {
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: key } });
    if (!res.ok) return null;
    return ((await res.json()) as { external?: Record<string, boolean> }).external ?? null;
  } catch {
    return null;
  }
}

/** Current access token (refreshed automatically by supabase-js), or null when signed out or auth is off. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
