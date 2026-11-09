import { ArrowLeft, KeyRound, Mail } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';

import { RouterConstellation } from '../components/Flow';
import { BrandOrb } from '../components/Orb';
import { Button, Field, Segmented } from '../components/ui';
import { useAuth } from '../lib/auth';
import { base } from '../lib/motion';
import { enabledProviders, supabase } from '../lib/supabase';

type View = 'password' | 'magic' | 'forgot';

/** Where Supabase sends people back to after email links and Google (must be listed in Supabase → Auth → URL Configuration). */
const redirectTo = () => window.location.origin;

const EXISTS = 'This email already has an account. Sign in with your password below.';
const GOOGLE_OFF ='Google sign-in isn’t set up for this project yet. Use email for now.';

/** Supabase error text is mostly readable; a few cases get plainer wording. */
function friendly(message: string): string {
  if (/provider is not enabled/i.test(message)) return GOOGLE_OFF;
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: open the link we sent you.';
  if (/rate limit/i.test(message)) {
    return 'Supabase’s email limit is used up for now (a few emails per hour). If you already have an account, sign in with your password: that needs no email. Otherwise try again in about an hour.';
  }
  if (/already registered|already been registered/i.test(message)) return EXISTS;
  return message;
}

export default function SignIn() {
  const { recovering } = useAuth();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex items-center gap-2.5">
            <BrandOrb size={30} live />
            <span className="h-display text-[24px]">ElevenRoute</span>
          </div>
          {recovering ? <NewPassword /> : <SignInForm />}
        </div>
      </main>
      <aside className="relative hidden flex-col justify-center gap-8 overflow-hidden border-l border-line bg-card px-14 lg:flex" aria-hidden="true">
        <RouterConstellation />
        <div className="max-w-md">
          <p className="h-display text-[30px] leading-tight">Every turn to the right model.</p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">Routing, failover and testing across OpenAI, Gemini and Anthropic. Your workspace keeps your models, rules and traffic private to you.</p>
        </div>
      </aside>
    </div>
  );
}

function SignInForm() {
  const [view, setView] = useState<View>('password');
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // null while unknown: the button stays usable and the click re-checks.
  const [googleOn, setGoogleOn] = useState<boolean | null>(null);
  useEffect(() => {
    enabledProviders().then((p) => p && setGoogleOn(Boolean(p.google)));
  }, []);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (err) {
      setError(friendly((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    const auth = supabase.auth;
    if (view === 'magic') {
      return run(async () => {
        const { error } = await auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
        if (error) throw error;
        return `We sent a sign-in link to ${email}. Open it on this device.`;
      });
    }
    if (view === 'forgot') {
      return run(async () => {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
        if (error) throw error;
        return `If ${email} has an account, a reset link is on its way.`;
      });
    }
    return run(async () => {
      if (creating) {
        const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
        if (error) throw error;
        // Supabase answers a sign-up for an existing email with a user that has no identities (and sends no email).
        if (data.user && data.user.identities?.length === 0) {
          setCreating(false);
          throw new Error(EXISTS);
        }
        return data.session ? null : `Almost there: confirm your email with the link we sent to ${email}, then sign in.`;
      }
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) throw error;
      return null;
    });
  };

  const google = () =>
    run(async () => {
      // Re-check right before leaving: Supabase shows a raw error page for a provider that's switched off.
      if ((await enabledProviders())?.google === false) {
        setGoogleOn(false);
        throw new Error(GOOGLE_OFF);
      }
      const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
      if (error) throw error;
      return null; // the browser now leaves for Google
    });

  const title = view === 'forgot' ? 'Reset your password' : creating && view === 'password' ? 'Create your account' : 'Sign in';

  return (
    <div>
      <h1 className="h-display text-[34px] leading-tight">{title}</h1>
      <p className="mt-2 text-[15px] text-ink-2">
        {view === 'forgot' ? 'We’ll email you a link to choose a new password.' : 'Each account gets its own private workspace.'}
      </p>

      {view !== 'forgot' && (
        <>
          <Button variant="secondary" className="mt-8 w-full" onClick={google} disabled={busy || googleOn === false}>
            <GoogleMark /> Continue with Google
          </Button>
          {googleOn === false ? <p className="mt-2 text-center text-[12.5px] text-ink-3">Google sign-in isn’t set up for this project yet. Use email below.</p> : null}
          <div className="my-6 flex items-center gap-3 text-[12px] text-ink-3">
            <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
          </div>
          <Segmented
            label="Sign-in method"
            size="sm"
            value={view}
            onChange={(v) => { setView(v as View); setError(null); setNotice(null); }}
            options={[{ value: 'password', label: 'Password' }, { value: 'magic', label: 'Email me a link' }]}
          />
        </>
      )}

      <form onSubmit={submit} className={`flex flex-col gap-4 ${view === 'forgot' ? 'mt-8' : 'mt-5'}`}>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        <AnimatePresence initial={false}>
          {view === 'password' && (
            <motion.div key="pw" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={base} className="overflow-hidden">
              <Field
                label="Password"
                type="password"
                autoComplete={creating ? 'new-password' : 'current-password'}
                required
                minLength={creating ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint={creating ? 'At least 8 characters.' : undefined}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div role="status" aria-live="polite" className="min-h-0">
          {error ? <p className="rounded-2xl border border-bad/25 bg-bad/[0.04] px-3.5 py-2.5 text-[13.5px] text-bad">{error}</p> : null}
          {notice ? <p className="rounded-2xl border border-ok/25 bg-ok/[0.05] px-3.5 py-2.5 text-[13.5px] text-ink">{notice}</p> : null}
        </div>

        <Button type="submit" loading={busy} icon={view === 'password' ? KeyRound : Mail} className="w-full">
          {view === 'magic' ? 'Email me a sign-in link' : view === 'forgot' ? 'Send reset link' : creating ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
        {view === 'forgot' ? (
          <button type="button" className="inline-flex items-center gap-1.5 font-medium text-ink-2 hover:text-ink" onClick={() => { setView('password'); setNotice(null); setError(null); }}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
          </button>
        ) : view === 'password' ? (
          <>
            <button type="button" className="font-medium text-ink-2 hover:text-ink" onClick={() => { setCreating(!creating); setError(null); setNotice(null); }}>
              {creating ? 'Have an account? Sign in' : 'New here? Create an account'}
            </button>
            {!creating && (
              <button type="button" className="text-ink-3 hover:text-ink" onClick={() => { setView('forgot'); setError(null); setNotice(null); }}>
                Forgot password?
              </button>
            )}
          </>
        ) : (
          <span className="text-ink-3">No password needed. New emails get an account automatically.</span>
        )}
      </div>
    </div>
  );
}

/** Shown after following a password-reset email. */
function NewPassword() {
  const { doneRecovering } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase!.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    doneRecovering();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="h-display text-[34px] leading-tight">Choose a new password</h1>
      <Field label="New password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters." />
      <div role="status" aria-live="polite">{error ? <p className="text-[13.5px] text-bad">{error}</p> : null}</div>
      <Button type="submit" loading={busy} icon={KeyRound} className="w-full">Save password</Button>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
