import { type ComponentRef, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Orb } from '@/components/orb';
import { ReasonText, Trace } from '@/components/trace';
import { ApiErrorNote, Body, Card, Chip, Label, Mono, Muted, Pill, Row, Segmented, Status, useWide } from '@/components/ui';
import { VendorSwitches } from '@/components/vendor-switches';
import { C, F, MAX_WIDTH, RADIUS, S } from '@/constants/theme';
import { api } from '@/lib/api';
import { LANGS, USE_CASES, modelName, money, ms } from '@/lib/format';
import { useApi } from '@/lib/use-api';

import type { ChatResponse, Language, ModelInfo, RoutingConfig, TestCase, UseCase } from '../../../shared/types';

type Msg = { role: 'user'; text: string; language: Language } | { role: 'agent'; res: ChatResponse; language: Language };

const newId = () => `play-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export default function PlaygroundScreen() {
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const routing = useApi<RoutingConfig>('/routing');
  const models = useApi<ModelInfo[]>('/providers');
  const cases = useApi<TestCase[]>('/tests/cases');
  const [customer, setCustomer] = useState('default');
  const [language, setLanguage] = useState<Language>('en');
  const [useCase, setUseCase] = useState<UseCase>('refund');
  const [conversationId, setConversationId] = useState(newId);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || sending) return;
    setInput('');
    setError(null);
    setSending(true);
    setMessages((m) => [...m, { role: 'user', text: message, language }]);
    try {
      const res = await api.post<ChatResponse>('/chat', { conversation_id: conversationId, message, language, use_case: useCase, customer_id: customer });
      setMessages((m) => [...m, { role: 'agent', res, language }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setConversationId(newId());
  };

  const suggestions = (cases.data ?? []).filter((c) => c.language === language && c.useCase === useCase);

  const settings = (
    <Card>
      <View style={{ gap: S.md }}>
        <View style={{ gap: 6 }}>
          <Label>Customer</Label>
          <Segmented small value={customer} onChange={setCustomer} options={(routing.data?.policies ?? [{ id: 'default', name: 'Default' }]).map((p) => ({ value: p.id, label: p.name }))} />
        </View>
        <View style={{ gap: 6 }}>
          <Label>Language</Label>
          <Segmented small value={language} onChange={setLanguage} options={LANGS} />
        </View>
        <View style={{ gap: 6 }}>
          <Label>Call type</Label>
          <Row wrap gap={6}>
            {USE_CASES.map((u) => <Chip key={u.value} label={u.label} active={u.value === useCase} onPress={() => setUseCase(u.value)} />)}
          </Row>
        </View>
        <View style={{ gap: 6 }}>
          <Label>Simulate outage</Label>
          <VendorSwitches compact />
        </View>
      </View>
    </Card>
  );

  const chat = (
    <View style={{ gap: S.md }}>
      {messages.length === 0 ? (
        <Card>
          <Body style={{ fontFamily: F.medium }}>Send a message to see how it&apos;s routed</Body>
          <Muted style={{ marginTop: 4 }}>
            Each reply shows the model, cost, latency, routing time and the reason it was chosen. Switch a vendor to Down or Slow to watch failover.
          </Muted>
        </Card>
      ) : null}
      {messages.map((m, i) =>
        m.role === 'user' ? (
          <View key={i} style={styles.userBubble}>
            <Text style={styles.userText}>{m.text}</Text>
          </View>
        ) : (
          <AgentReply key={i} res={m.res} language={m.language} models={models.data} />
        ),
      )}
      {sending ? <Muted>Routing…</Muted> : null}
      {error ? <ApiErrorNote error={error} /> : null}
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.canvas }}>
      <ScrollView
        ref={scroll}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: Platform.OS === 'web' ? S.xxl : insets.top + S.lg, paddingHorizontal: wide ? S.xxl : S.lg, paddingBottom: S.lg }}>
        <View style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: S.lg }}>
          <Row wrap style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View style={{ gap: 4, flex: 1, minWidth: 200 }}>
              <Text style={styles.h1}>Playground</Text>
              <Muted style={{ fontSize: 15, color: C.ink2 }}>Chat with the router and inspect every decision.</Muted>
            </View>
            <Pill label="New conversation" icon="refresh" variant="secondary" small onPress={reset} />
          </Row>
          {wide ? (
            <Row style={{ alignItems: 'flex-start' }} gap={S.lg}>
              <View style={{ flex: 1.6 }}>{chat}</View>
              <View style={{ flex: 1, minWidth: 320 }}>{settings}</View>
            </Row>
          ) : (
            <>
              {settings}
              {chat}
            </>
          )}
        </View>
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Platform.OS === 'web' && !wide ? 84 : Platform.OS === 'ios' ? S.md : S.md, paddingHorizontal: wide ? S.xxl : S.lg }]}>
        <View style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: S.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {suggestions.map((c) => <Chip key={c.id} label={`${c.turnType === 'simple' ? 'Simple' : 'Complex'}: ${c.message.slice(0, 38)}${c.message.length > 38 ? '…' : ''}`} onPress={() => send(c.message)} />)}
          </ScrollView>
          <Row gap={S.sm}>
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => send()}
              placeholder={language === 'es' ? 'Escribe un mensaje…' : 'Type a customer message…'}
              placeholderTextColor={C.ink3}
              returnKeyType="send"
              style={styles.input}
              accessibilityLabel="Customer message"
            />
            <Pill label="Send" icon="send" onPress={() => send()} loading={sending} disabled={!input.trim()} />
          </Row>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function AgentReply({ res, language, models }: { res: ChatResponse; language: Language; models?: ModelInfo[] }) {
  const model = models?.find((m) => m.id === res.model_used);
  return (
    <View style={styles.agent}>
      <Row wrap gap={S.sm}>
        <Orb model={model} size={22} />
        <Body style={{ fontFamily: F.medium }}>{modelName(models, res.model_used)}</Body>
        <Chip label={res.turn_type === 'simple' ? 'Simple turn' : 'Complex turn'} />
        {res.failover_used ? <Status kind="slow" label="Failover" /> : null}
        {!res.model_used ? <Status kind="fail" label="All providers failed" /> : null}
      </Row>
      <Text style={styles.reply} selectable>{res.reply}</Text>
      <Row wrap gap={S.md}>
        <Mono>{money(res.cost_usd)} cost</Mono>
        <Mono>{ms(res.latency_ms)} latency</Mono>
        <Mono>{ms(res.trace.overheadMs)} routing</Mono>
      </Row>
      <ReasonText text={res.route_reason} />
      <Trace trace={res.trace} />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontFamily: F.light, fontSize: 36, letterSpacing: -0.72, color: C.ink, lineHeight: 42 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: C.ink, borderRadius: RADIUS, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  userText: { fontFamily: F.regular, fontSize: 15, color: C.white, lineHeight: 21 },
  agent: { backgroundColor: C.card, borderRadius: RADIUS, padding: S.lg, gap: S.sm, maxWidth: 720 },
  reply: { fontFamily: F.regular, fontSize: 16, lineHeight: 23, color: C.ink },
  composer: { borderTopWidth: 1, borderColor: C.line, backgroundColor: C.canvas, paddingTop: S.sm },
  input: {
    flex: 1, fontFamily: F.regular, fontSize: 15, color: C.ink, backgroundColor: C.card, borderRadius: 999,
    paddingHorizontal: 18, paddingVertical: 11, minHeight: 44,
  },
});
