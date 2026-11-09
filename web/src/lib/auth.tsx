import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { clearCache } from './query';
import { supabase } from './supabase';

interface AuthState {
  /** false until the stored session has been read (instant: it comes from local storage). */
  ready: boolean;
  /** True when the dashboard has Supabase settings, i.e. sign-in is required. */
  enabled: boolean;
  session: Session | null;
  user: User | null;
  /** Set after the user follows a password-reset email: show the "choose a new password" form. */
  recovering: boolean;
  doneRecovering: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  ready: true, enabled: false, session: null, user: null, recovering: false, doneRecovering: () => {}, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') clearCache();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    clearCache(); // never leave one user's cached data on a shared computer
    await supabase?.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ ready, enabled: Boolean(supabase), session, user: session?.user ?? null, recovering, doneRecovering: () => setRecovering(false), signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
