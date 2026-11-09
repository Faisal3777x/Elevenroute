import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, F, S } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

import { Orb } from './orb';
import { Body, Field, H2, Muted, Pill } from './ui';

/** Shows the sign-in screen until there is a Supabase session. With no Supabase settings, renders the app as-is. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) return <>{children}</>;
  if (!ready) return <View style={{ flex: 1, backgroundColor: C.canvas }} />;
  return session ? <>{children}</> : <SignIn />;
}

export function signOut() {
  return supabase?.auth.signOut();
}

function SignIn() {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (creating) {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) setNotice(`Confirm your email with the link we sent to ${email.trim()}, then sign in here.`);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (err) {
      const m = (err as Error).message;
      setError(/invalid login credentials/i.test(m) ? 'That email and password don’t match an account.' : /email not confirmed/i.test(m) ? 'Confirm your email first: open the link we sent you.' : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.canvas }}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Orb model={{ vendor: 'google', tier: 'flagship' }} size={30} />
          <Text style={styles.brandText}>ElevenRoute</Text>
        </View>
        <H2>{creating ? 'Create your account' : 'Sign in'}</H2>
        <Muted>Each account gets its own private workspace. Use the same account as on the web dashboard.</Muted>

        <View style={{ gap: S.md, marginTop: S.xl }}>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@company.com" />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={creating ? 'new-password' : 'current-password'}
            textContentType={creating ? 'newPassword' : 'password'}
            onSubmitEditing={submit}
          />
          <View accessibilityLiveRegion="polite">
            {error ? <Body style={{ color: C.bad }}>{error}</Body> : null}
            {notice ? <Body>{notice}</Body> : null}
          </View>
          <Pill label={creating ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} disabled={!email.trim() || password.length < (creating ? 8 : 1)} />
        </View>

        <Pressable onPress={() => { setCreating(!creating); setError(null); setNotice(null); }} accessibilityRole="button" style={{ marginTop: S.lg, alignSelf: 'flex-start' }}>
          <Text style={styles.link}>{creating ? 'Have an account? Sign in' : 'New here? Create an account'}</Text>
        </Pressable>
        <Muted style={{ marginTop: S.xl }}>Magic links and Google sign-in are on the web dashboard. Forgot your password? Reset it there.</Muted>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: S.xl, gap: S.sm, maxWidth: 440, width: '100%', alignSelf: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.xxl },
  brandText: { fontFamily: F.regular, fontSize: 24, color: C.ink },
  link: { fontFamily: F.medium, fontSize: 14, color: C.ink2 },
});
