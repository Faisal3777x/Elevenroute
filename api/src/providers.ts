import type { Language, ModelInfo, TurnType, UseCase, VendorState } from '../../shared/types.ts';
import { cannedReply, CONTENT, LANGUAGE_NAMES } from './content.ts';
import { keyEnv } from './store.ts';

export interface CallInput {
  model: ModelInfo;
  message: string;
  useCase: UseCase;
  language: Language;
  turnType: TurnType;
  budgetMs: number;
  vendorState: VendorState;
  /** Use the simulated provider even in live mode (synthetic traffic). */
  simulated: boolean;
  /** Don't actually wait: compute latency only (synthetic traffic, tests). */
  virtual: boolean;
}

export interface CallResult {
  reply: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export class ProviderError extends Error {
  latencyMs: number;
  constructor(message: string, latencyMs: number) {
    super(message);
    this.latencyMs = latencyMs;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number, spread = 0.3) => base * (1 - spread + Math.random() * spread * 2);

export function estimateTokens(text: string, language: Language): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * (language === 'es' ? 1.6 : 1.4)));
}

export function costOf(m: ModelInfo, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1000) * m.costIn + (tokensOut / 1000) * m.costOut;
}

const SYSTEM_TOKENS = 160;

export function systemPrompt(useCase: UseCase, language: Language): string {
  return `You are a friendly, efficient customer-service agent handling ${CONTENT[useCase].label.toLowerCase()} calls. Reply in ${LANGUAGE_NAMES[language]} in at most three sentences. Invent plausible specifics (dates, references) where needed.`;
}

/** Simulated outage / slowdown. Applies in demo and live mode so failover can be shown live. */
async function simulatedFault(state: VendorState, budgetMs: number, virtual: boolean): Promise<never | void> {
  if (state === 'down') {
    const latency = jitter(150, 0.2);
    if (!virtual) await sleep(latency);
    throw new ProviderError('HTTP 503 Service Unavailable (simulated outage)', latency);
  }
  if (state === 'slow') {
    if (!virtual) await sleep(budgetMs);
    throw new ProviderError(`timed out after ${budgetMs} ms (simulated slowdown)`, budgetMs);
  }
}

export async function callModel(input: CallInput, mode: 'demo' | 'live'): Promise<CallResult> {
  const { model, budgetMs, virtual } = input;
  await simulatedFault(input.vendorState, budgetMs, virtual);

  if (mode === 'live' && !input.simulated) {
    const started = performance.now();
    const res = await liveCall(model, systemPrompt(input.useCase, input.language), input.message, budgetMs).catch((err: Error) => {
      const elapsed = performance.now() - started;
      throw new ProviderError(err.name === 'TimeoutError' ? `timed out after ${budgetMs} ms` : err.message, elapsed);
    });
    return { ...res, latencyMs: performance.now() - started };
  }

  // Demo provider: configurable latency, error rate and canned replies.
  if (Math.random() < model.errorRate) {
    const latency = jitter(220);
    if (!virtual) await sleep(latency);
    throw new ProviderError('HTTP 500 Internal Server Error (simulated)', latency);
  }
  const latency = jitter(model.latencyMs);
  if (latency > budgetMs) {
    if (!virtual) await sleep(budgetMs);
    throw new ProviderError(`timed out after ${budgetMs} ms`, budgetMs);
  }
  if (!virtual) await sleep(latency);
  const reply = cannedReply(input.message, input.useCase, input.language, input.turnType);
  return {
    reply,
    tokensIn: SYSTEM_TOKENS + estimateTokens(input.message, input.language),
    tokensOut: estimateTokens(reply, input.language),
    latencyMs: latency,
  };
}

interface LiveResult {
  reply: string;
  tokensIn: number;
  tokensOut: number;
}

/** One real model call. Keys are read from the environment only. */
export async function liveCall(model: ModelInfo, system: string, user: string, timeoutMs: number): Promise<LiveResult> {
  const key = process.env[keyEnv[model.vendor]];
  if (!key) throw new Error(`${keyEnv[model.vendor]} is not set`);
  const signal = AbortSignal.timeout(timeoutMs);
  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${model.vendor}`);
    return (await res.json()) as any;
  };

  if (model.vendor === 'openai') {
    const j = await post('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${key}` }, {
      model: model.liveModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    return { reply: j.choices?.[0]?.message?.content ?? '', tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
  }
  if (model.vendor === 'google') {
    const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model.liveModel}:generateContent`, { 'x-goog-api-key': key }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
    });
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    return { reply: text, tokensIn: j.usageMetadata?.promptTokenCount ?? 0, tokensOut: j.usageMetadata?.candidatesTokenCount ?? 0 };
  }
  const j = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
    model: model.liveModel,
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = (j.content ?? []).map((b: { text?: string }) => b.text ?? '').join('');
  return { reply: text, tokensIn: j.usage?.input_tokens ?? 0, tokensOut: j.usage?.output_tokens ?? 0 };
}
