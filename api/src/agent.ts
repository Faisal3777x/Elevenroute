// ElevenAgent: a stateful, goal-driven agent that sits above the router.
//
// The agent owns the conversation state (what it knows, what it has done, what it is waiting for). Each customer
// turn runs one loop: read the turn into the state -> call the business systems the state now allows -> decide what
// to say -> hand the turn to ElevenRoute (runTurn), which picks the model. Because the state lives here and not in a
// model, the router can change model or vendor between turns, or fail over, without the conversation losing its place.
//
// Demo scope, labelled as such in the dashboard: the Salesforce and SAP connectors are simulated (fixed records, no
// network call), and the agent always uses the simulated providers with a reply chosen by the state machine, so it
// never spends API credit. Routing, failover, cost and latency are the real router's, as on every other page.
import type {
  AgentScenario, AgentScenarioId, AgentSession, AgentToolCall, AgentTurnRequest, AgentTurnResponse, Language,
} from '../../shared/types.ts';
import { Breaker } from './breaker.ts';
import { runTurn } from './chat.ts';
import { CONTENT } from './content.ts';
import { costOf, estimateTokens } from './providers.ts';
import { bestAllowedModel } from './router.ts';
import type { Workspace } from './store.ts';

type Vals = Record<string, string | undefined>;
type Say = (v: Vals) => string;

interface ScenarioDef extends AgentScenario {
  /** Reads a slot value out of a (lower-cased) customer turn. */
  find: Record<string, (text: string) => string | null>;
  /** The simulated connector behind each tool. */
  run: Record<string, (v: Vals) => Record<string, string>>;
  /** What the agent says while a slot is still missing. */
  ask: Record<string, Say>;
  done: Say;
  declined: Say;
}

// ---- reading a turn ----
const word = (alternatives: string) => new RegExp(`(^|[^\\p{L}\\p{N}])(${alternatives})($|[^\\p{L}\\p{N}])`, 'u');
const NO = word("no|nope|don'?t|do not|not now|cancel that");
const YES = word('yes|yeah|yep|sure|ok|okay|go ahead|please do|that works|sounds good|confirm|book it|renew it');
const WANTS_PERSON = word('human|real person|representative|supervisor|speak to someone|talk to someone');

const reference = (text: string) => /(^|\D)(\d{4,8})(\D|$)/.exec(text)?.[2] ?? null;
/** "No problem, go ahead" is a yes: the polite "no problem" is dropped before looking for a refusal. */
const confirmation = (text: string) => {
  const t = text.replace(/no problem/g, ' ');
  return NO.test(t) ? 'No' : YES.test(t) ? 'Yes' : null;
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

const CONFIRM_SLOT = { id: 'confirm', label: 'Customer confirmation' };

// ---- scenarios ----
const CHANGES: { key: string; test: RegExp; phrase: string }[] = [
  { key: 'new car', test: /new car|another car|different car/, phrase: 'the new car' },
  { key: 'new city', test: /moved|new address|different city|new city/, phrase: 'your new city' },
  { key: 'second driver', test: /second driver|another driver|named driver|add my (partner|wife|husband|son|daughter)/, phrase: 'a second driver' },
];
const NO_CHANGES = /no changes|nothing (has )?changed|same as (before|last year)|all the same/;
const BASE_PREMIUM = 84;

const SLOT_PHRASE: Record<string, string> = {
  'Tuesday 10:00 am': 'on Tuesday at 10:00 am',
  'Wednesday 8:30 am': 'on Wednesday at 8:30 am',
  'Thursday 2:00 pm': 'on Thursday at 2:00 pm',
  'Thursday 5:30 pm': 'on Thursday at 5:30 pm',
};
const slotPhrase = (slot: string | undefined) => SLOT_PHRASE[slot ?? ''] ?? slot ?? '';
const WHEN = /after work|evenings?|mornings?|afternoons?|monday|tuesday|wednesday|thursday|friday|tomorrow|\d{1,2}(:\d{2})?\s?(am|pm)/;

const SCENARIOS: Record<AgentScenarioId, ScenarioDef> = {
  refund: {
    id: 'refund',
    useCase: 'refund',
    title: 'Duplicate-charge refund',
    goal: 'Refund the duplicate payment and log it on the customer’s case.',
    slots: [{ id: 'order', label: 'Order number' }, { id: 'issue', label: 'What went wrong' }, CONFIRM_SLOT],
    tools: [
      { id: 'sf.case.lookup', system: 'salesforce', operation: 'Case: look up by order', write: false, needs: ['order'] },
      { id: 'sap.payments.list', system: 'sap', operation: 'Billing: list payments', write: false, needs: ['order'] },
      { id: 'sap.refund.post', system: 'sap', operation: 'Billing: post refund', write: true, needs: ['order', 'issue', 'confirm'] },
      { id: 'sf.case.close', system: 'salesforce', operation: 'Case: log refund and close', write: true, needs: ['order', 'issue', 'confirm'] },
    ],
    script: { en: [CONTENT.refund.langs.en.complex, CONTENT.refund.langs.en.simple, 'Yes, go ahead, thanks.'] },
    scriptFills: ['issue', 'order', 'confirm'],
    find: {
      order: reference,
      issue: (t) => (/charged twice|double charge|duplicate|twice/.test(t) ? 'Duplicate charge' : null),
      confirm: confirmation,
    },
    run: {
      'sf.case.lookup': () => ({ customer: 'Verified', 'open cases': 'None' }),
      'sap.payments.list': () => ({ payments: '2 on the same day', amount: '$64.90' }),
      'sap.refund.post': (v) => ({ refund: `RF-${v.order}`, to: 'Original card' }),
      'sf.case.close': (v) => ({ case: `CS-${v.order}`, status: 'Closed' }),
    },
    ask: {
      order: (v) => `${v.issue ? "I'm sorry about the double charge. I can sort that out now." : 'I can help with that.'} What's the order number?`,
      issue: (v) => `Thanks, I found order ${v.order}. What went wrong with it?`,
      confirm: (v) => `I can see two payments of ${v.amount} on order ${v.order}, taken on the same day, so one is a duplicate. I can refund ${v.amount} to your original card now. Shall I go ahead?`,
    },
    done: (v) => `Done. Refund ${v.refund} for ${v.amount} is on its way and should reach your card in 3–5 business days. I've logged it on case ${v.case}.`,
    declined: () => "No problem, I haven't changed anything. Both payments are as they were, and you can come back to this any time.",
  },

  insurance: {
    id: 'insurance',
    useCase: 'insurance',
    title: 'Insurance renewal',
    goal: 'Renew the policy at the right premium and update the customer record.',
    slots: [{ id: 'policy', label: 'Policy number' }, { id: 'changes', label: 'Changes since last year' }, CONFIRM_SLOT],
    tools: [
      { id: 'sf.policy.lookup', system: 'salesforce', operation: 'Account: look up policy', write: false, needs: ['policy'] },
      { id: 'sap.quote.price', system: 'sap', operation: 'Contract: price the renewal', write: false, needs: ['policy', 'changes'] },
      { id: 'sap.contract.renew', system: 'sap', operation: 'Contract: renew for 12 months', write: true, needs: ['policy', 'changes', 'confirm'] },
      { id: 'sf.account.update', system: 'salesforce', operation: 'Account: update record', write: true, needs: ['policy', 'changes', 'confirm'] },
    ],
    script: { en: [CONTENT.insurance.langs.en.complex, "It's policy 77310.", CONTENT.insurance.langs.en.simple] },
    scriptFills: ['changes', 'policy', 'confirm'],
    find: {
      policy: reference,
      changes: (t) => {
        const found = CHANGES.filter((c) => c.test.test(t)).map((c) => c.key);
        return found.length ? capital(found.join(', ')) : NO_CHANGES.test(t) ? 'No changes' : null;
      },
      confirm: confirmation,
    },
    run: {
      'sf.policy.lookup': () => ({ holder: 'Verified', renewal: 'Next month', current: `$${BASE_PREMIUM}` }),
      'sap.quote.price': (v) => {
        const changed = (v.changes ?? '').toLowerCase();
        const premium = BASE_PREMIUM + (/car|city/.test(changed) ? 7 : 0) + (changed.includes('driver') ? 12 : 0);
        return { premium: `$${premium}`, change: premium === BASE_PREMIUM ? 'None' : `+$${premium - BASE_PREMIUM}` };
      },
      'sap.contract.renew': (v) => ({ contract: `RN-${v.policy}`, term: '12 months' }),
      'sf.account.update': () => ({ record: 'Updated' }),
    },
    ask: {
      policy: (v) => `${v.changes ? 'I can update all of that with the renewal.' : 'I can help with your renewal.'} What's your policy number?`,
      changes: (v) => `Thanks, I found policy ${v.policy}. It renews next month at ${v.current} a month. Has anything changed since last year: your car, your address or who drives?`,
      confirm: (v) => {
        const changed = (v.changes ?? '').toLowerCase();
        const parts = CHANGES.filter((c) => changed.includes(c.key)).map((c) => c.phrase);
        const lead = parts.length ? `With ${list(parts)}, your premium goes from ${v.current} to ${v.premium} a month.` : `Nothing has changed, so your premium stays at ${v.current} a month.`;
        return `${lead} Shall I renew the policy on those terms?`;
      },
    },
    done: (v) => `Done. Policy ${v.policy} is renewed for 12 months at ${v.premium} a month (contract ${v.contract}), and your record is updated.`,
    declined: () => "No problem, I haven't renewed anything. Your policy stays as it is until its renewal date.",
  },

  appointment: {
    id: 'appointment',
    useCase: 'appointment',
    title: 'Appointment change',
    goal: 'Move the visit to a time that suits the customer and release the old slot.',
    slots: [{ id: 'booking', label: 'Booking reference' }, { id: 'when', label: 'Preferred time' }, CONFIRM_SLOT],
    tools: [
      { id: 'sf.contact.lookup', system: 'salesforce', operation: 'Contact: look up booking', write: false, needs: ['booking'] },
      { id: 'sap.slots.find', system: 'sap', operation: 'Service order: find open slots', write: false, needs: ['booking', 'when'] },
      { id: 'sap.order.move', system: 'sap', operation: 'Service order: move the visit', write: true, needs: ['booking', 'when', 'confirm'] },
      { id: 'sf.contact.update', system: 'salesforce', operation: 'Contact: set reminder', write: true, needs: ['booking', 'when', 'confirm'] },
    ],
    script: {
      en: [
        'I need to move my appointment. I can only come after work on weekdays and the online page keeps showing me mornings. Which doctor is free, and can you sort it out for me?',
        'My booking reference is 30417.',
        'Yes, that works.',
      ],
    },
    scriptFills: ['when', 'booking', 'confirm'],
    find: {
      booking: reference,
      when: (t) => {
        const m = WHEN.exec(t);
        return m ? capital(m[0]) : null;
      },
      confirm: confirmation,
    },
    run: {
      'sf.contact.lookup': () => ({ patient: 'Verified', current: 'Tuesday 10:00 am' }),
      'sap.slots.find': (v) => {
        const when = (v.when ?? '').toLowerCase();
        const slot = /after work|evening|[5-9](:\d{2})?\s?pm/.test(when) ? 'Thursday 5:30 pm' : /morning|am$/.test(when) ? 'Wednesday 8:30 am' : 'Thursday 2:00 pm';
        return { slot, doctor: 'Dr. Patel' };
      },
      'sap.order.move': (v) => ({ confirmation: `BK-${v.booking}`, released: v.current ?? '' }),
      'sf.contact.update': () => ({ reminder: 'Text, 1 hour before' }),
    },
    ask: {
      booking: () => "I can move that for you. What's your booking reference?",
      when: (v) => `Thanks, I found booking ${v.booking}, currently ${slotPhrase(v.current)}. When would suit you better?`,
      confirm: (v) => `${v.doctor} is free ${slotPhrase(v.slot)}. I can move booking ${v.booking} there and release your current slot. Shall I book it?`,
    },
    done: (v) => `Done. You're booked with ${v.doctor} ${slotPhrase(v.slot)} (${v.confirmation}). Your old slot is released and you'll get a text reminder an hour before.`,
    declined: () => "No problem, I haven't moved anything. Your appointment stays where it was.",
  },
};

export const AGENT_SCENARIO_IDS = Object.keys(SCENARIOS) as AgentScenarioId[];

const HANDOFF = "Of course. I'm passing you to a member of our team now, with everything we've covered so you won't have to repeat it.";
const REASK = "Sorry, I didn't catch that. ";

/** What the dashboard needs to describe each scenario (no functions). */
export function agentScenarios(): AgentScenario[] {
  return AGENT_SCENARIO_IDS.map((id) => {
    const { useCase, title, goal, slots, tools, script, scriptFills } = SCENARIOS[id];
    return { id, useCase, title, goal, slots, tools, script, scriptFills };
  });
}

// Bounded so memory stays flat on a shared server.
const MAX_SESSIONS = 500;

function open(ws: Workspace, req: AgentTurnRequest): AgentSession {
  const existing = ws.agentSessions.get(req.session_id);
  if (existing) return existing;
  if (ws.agentSessions.size >= MAX_SESSIONS) ws.agentSessions.delete(ws.agentSessions.keys().next().value as string);
  const session: AgentSession = {
    id: req.session_id,
    scenario: req.scenario,
    language: req.language,
    customerId: req.customer_id,
    status: 'active',
    turns: 0,
    awaiting: null,
    slots: SCENARIOS[req.scenario].slots.map((s) => ({ ...s, value: null, turn: null })),
    calls: [],
    models: [],
    costUsd: 0,
    baselineUsd: 0,
    latencyMs: 0,
    transcriptTokens: 0,
  };
  ws.agentSessions.set(session.id, session);
  return session;
}

/** Everything the agent knows: slot values plus what the tools returned. */
function known(s: AgentSession): Vals {
  const v: Vals = {};
  for (const slot of s.slots) if (slot.value !== null) v[slot.id] = slot.value;
  for (const call of s.calls) Object.assign(v, call.result);
  return v;
}

/** Tokens sent as context with the next turn: the conversation so far plus the state the agent carries. */
function contextTokens(s: AgentSession): number {
  const state = [
    ...s.slots.filter((x) => x.value !== null).map((x) => `${x.label}: ${x.value}`),
    ...s.calls.map((c) => `${c.operation}: ${Object.entries(c.result).map(([k, val]) => `${k} ${val}`).join(', ')}`),
  ].join('; ');
  return s.transcriptTokens + (state ? estimateTokens(state) : 0);
}

/**
 * One customer turn. The caller checks that the session is still active and belongs to this scenario.
 * `dry` is a run for show (the landing page): the same loop and the same router, but nothing is logged, nothing
 * waits, and provider failures don't count against the workspace's circuit breaker.
 */
export async function agentTurn(ws: Workspace, req: AgentTurnRequest, { dry = false }: { dry?: boolean } = {}): Promise<AgentTurnResponse> {
  const def = SCENARIOS[req.scenario];
  const s = open(ws, req);
  const lang = s.language;
  const message = req.message.trim();
  const text = message.toLowerCase();
  const turn = s.turns + 1;
  const context = contextTokens(s);
  const filled: string[] = [];
  const calls: AgentToolCall[] = [];
  let status = s.status;
  let awaiting: string | null = null;
  let reply: string;

  if (WANTS_PERSON.test(text)) {
    status = 'handoff';
    reply = HANDOFF;
  } else {
    // 1. Read the turn into the state. A "yes" only counts once the agent has put a proposal to the customer.
    for (const slot of s.slots) {
      if (slot.value !== null || (slot.id === 'confirm' && s.awaiting !== 'confirm')) continue;
      const value = def.find[slot.id](text);
      if (value === null) continue;
      slot.value = value;
      slot.turn = turn;
      filled.push(slot.id);
    }
    // 2. Call every tool the state now allows. Writes wait for the customer's yes.
    const v = known(s);
    for (const tool of def.tools) {
      if (s.calls.some((c) => c.id === tool.id) || !tool.needs.every((n) => v[n] !== undefined)) continue;
      if (tool.write && v.confirm !== 'Yes') continue;
      const call: AgentToolCall = { ...tool, turn, result: def.run[tool.id](v) };
      Object.assign(v, call.result);
      s.calls.push(call);
      calls.push(call);
    }
    // 3. Decide what to say: ask for the first thing still missing, or close.
    const missing = def.slots.find((slot) => v[slot.id] === undefined);
    if (v.confirm === 'No') {
      status = 'declined';
      reply = def.declined(v);
    } else if (missing) {
      awaiting = missing.id;
      reply = (filled.length === 0 && s.awaiting === missing.id ? REASK : '') + def.ask[missing.id](v);
    } else {
      status = 'done';
      reply = def.done(v);
    }
  }

  // 4. ElevenRoute picks the model for this turn. Simulated providers only, so the agent never spends API credit.
  const route = await runTurn(
    ws,
    { conversation_id: s.id, message, language: lang, use_case: def.useCase, customer_id: s.customerId },
    { simulated: true, script: { reply, contextTokens: context }, ...(dry ? { log: false, virtual: true, breaker: new Breaker(() => ws.strategy) } : {}) },
  );
  if (!route.model_used) {
    // No model could answer: a person takes over, with the state intact.
    status = 'handoff';
    awaiting = null;
    reply = route.reply;
  }

  // The one-model baseline for this turn: the same tokens on the best model this customer may use (as in savings).
  const best = route.model_used ? bestAllowedModel(ws, s.customerId, lang, route.turn_type) : undefined;
  const baseline = best ? { modelId: best.id, costUsd: costOf(best, route.tokens_in, route.tokens_out) } : null;

  s.turns = turn;
  s.status = status;
  s.awaiting = awaiting;
  s.models.push(route.model_used);
  s.costUsd += route.cost_usd;
  s.baselineUsd += baseline?.costUsd ?? route.cost_usd;
  s.latencyMs += route.latency_ms;
  s.transcriptTokens += estimateTokens(message) + estimateTokens(reply);

  const session = structuredClone(s);
  // A finished dry run is never continued, so it doesn't take up a place.
  if (dry && status !== 'active') ws.agentSessions.delete(s.id);
  return { reply, session, filled, calls, contextTokens: context, baseline, route };
}
