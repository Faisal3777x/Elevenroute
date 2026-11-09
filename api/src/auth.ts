// Who is calling: verifies the Supabase access token sent as "Authorization: Bearer <token>".
// With SUPABASE_URL unset (local development), auth is off and every request acts as one local user.
import type { IncomingMessage } from 'node:http';

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

import type { AuthUser } from './store.ts';

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
export const authEnabled = Boolean(supabaseUrl);

/** Fixed identity used when auth is off. Never used when SUPABASE_URL is set. */
export const LOCAL_USER: AuthUser = { id: '00000000-0000-4000-8000-000000000000', email: 'local@elevenroute.dev' };

// Current Supabase projects sign tokens with asymmetric keys published as a JWKS (cached by jose).
// Projects still on the legacy shared secret can set SUPABASE_JWT_SECRET instead.
const jwks = supabaseUrl ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)) : null;
const secret = process.env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET) : null;

export class AuthError extends Error {}

export async function verifyToken(token: string): Promise<AuthUser> {
  const opts = { issuer: `${supabaseUrl}/auth/v1`, audience: 'authenticated' };
  let payload: JWTPayload;
  try {
    const { alg } = decodeProtectedHeader(token);
    if (alg?.startsWith('HS')) {
      if (!secret) throw new AuthError('This project signs tokens with a shared secret: set SUPABASE_JWT_SECRET on the API');
      ({ payload } = await jwtVerify(token, secret, opts));
    } else {
      ({ payload } = await jwtVerify(token, jwks!, opts));
    }
  } catch (err) {
    throw err instanceof AuthError ? err : new AuthError('Your session is invalid or has expired. Sign in again.');
  }
  if (!payload.sub) throw new AuthError('Token has no user');
  return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
}

/** The signed-in user for this request (throws AuthError when auth is on and the token is missing or bad). */
export async function userFromRequest(req: IncomingMessage): Promise<AuthUser> {
  if (!authEnabled) return LOCAL_USER;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (!m) throw new AuthError('Sign in required');
  return verifyToken(m[1].trim());
}

/**
 * DEMO_ONLY=1 locks the server to demo mode. `npm run share` sets it when sign-in is off: every visitor then
 * shares one workspace, so nobody may switch it to live mode and spend the server's API keys.
 */
export const demoOnly = process.env.DEMO_ONLY === '1';

/** Live mode spends the server's API keys, so only allow-listed users (LIVE_MODE_EMAILS) may turn it on. */
export function canUseLiveMode(user: AuthUser): boolean {
  if (demoOnly) return false;
  if (!authEnabled) return true;
  const allowed = (process.env.LIVE_MODE_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Boolean(user.email && allowed.includes(user.email.toLowerCase()));
}
