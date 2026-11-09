import { animate, createTimeline, stagger, svg, utils } from 'animejs';
import {
  ArrowRight, ArrowUpRight, Calculator, FlaskConical, Gauge, Globe2, Languages, LayoutDashboard, MessagesSquare, Pause, Play, ServerCrash, Server, ShieldCheck, SkipForward, SlidersHorizontal, Wallet, type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import type { AppConfig, ModelInfo, Overview, PreviewResponse, Savings, TestCase, TestRun } from '../../../shared/types';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { BrandOrb, Orb } from '../components/Orb';
import { TurnBadge } from '../components/ui';
import { api } from '../lib/api';
import { useOnScreen } from '../lib/anime';
import { useAuth } from '../lib/auth';
import { count, LANGS, USE_CASES } from '../lib/format';
import { EASE } from '../lib/motion';
import { sortModels, VENDOR_NAMES, VENDOR_ORDER, VENDOR_SHORT } from '../lib/theme';
import { useApi } from '../lib/useApi';

/** One message every STEP_MS: it travels into the router, then out to the model the router picked. */
const STEP_MS = 3800;
const HUB = 112;

const PAGES: { to: string; title: string; body: string; icon: LucideIcon }[] = [
  { to: '/overview', title: 'Overview', body: 'Spend, savings against each customer’s best allowed model, and traffic by model.', icon: LayoutDashboard },
  { to: '/playground', title: 'Playground', body: 'Send a message and watch every routing step, failover included.', icon: MessagesSquare },
  { to: '/rules', title: 'Routing rules', body: 'Edit the classifier, quality floors, the strategy and your customer policy.', icon: SlidersHorizontal },
  { to: '/providers', title: 'Providers', body: 'Models, prices and health per vendor, with outage switches for testing.', icon: Server },
  { to: '/tests', title: 'Test results', body: 'Scores per language and turn type from the shared test conversations.', icon: FlaskConical },
  { to: '/whatif', title: 'What-if', body: 'Re-price logged traffic under another choice before you change a rule.', icon: Calculator },
];

const STEPS = [
  { title: 'Read the turn', body: 'Weighted rules you can edit score each message. A score of 2 or more counts as complex.' },
  { title: 'Pick the model', body: 'Simple turns go to the cheapest model that clears your quality floor; complex turns to the strongest. Policy and language filter first.' },
  { title: 'Fail over', body: 'An error, an open breaker or a slow answer moves the turn to the next model, preferring another vendor.' },
  { title: 'Keep it honest', body: 'The same test conversations run against every model. Models that fall below the floor drop out on their own.' },
];

const CONTROLS: { title: string; body: string; icon: LucideIcon }[] = [
  { title: 'Quality floors', body: 'Set the minimum test score a model needs before it may answer simple turns, globally or per language.', icon: Gauge },
  { title: 'Customer policy', body: 'Choose which vendors and data regions are allowed, so data only goes where your contracts say it can.', icon: ShieldCheck },
  { title: 'Language preferences', body: 'Give each language its own floor and the vendor order to break ties.', icon: Languages },
  { title: 'Your own rules', body: 'Decide what “complex” means: words, phrases and weights are yours to edit, with a live preview.', icon: SlidersHorizontal },
];

/** Static film grain (SVG turbulence), tiled. */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

/**
 * Size factor for very large screens. Must match the html.landing-dark font sizes in index.css: the page's rem-based
 * layout grows with them, and this scales what is drawn in pixels (orbs, the logo) by the same amount.
 */
const scaleFor = (w: number) => (w >= 3400 ? 34 / 16 : w >= 2560 ? 26 / 16 : w >= 1920 ? 20 / 16 : 1);
function useScale(): number {
  const [k, setK] = useState(() => scaleFor(window.innerWidth));
  useEffect(() => {
    const on = () => setK(scaleFor(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return k;
}

/** Blended price per 1k tokens, the same weighting the router uses (about 3 input tokens per output token). */
const blended = (m: ModelInfo) => (3 * m.costIn + m.costOut) / 4;

export default function Landing() {
  const { enabled, session } = useAuth();
  // With sign-in on, the API needs a session; the landing page then shows without live data.
  const canFetch = !enabled || Boolean(session);
  const config = useApi<AppConfig>(canFetch ? '/config' : null);

  // Black theme for this page only: the page behind it (overscroll, body) goes black while it is open.
  useEffect(() => {
    document.title = 'ElevenRoute · The right AI model for every customer message';
    document.documentElement.classList.add('landing-dark');
    return () => document.documentElement.classList.remove('landing-dark');
  }, []);

  const openAccess = !enabled && config.data?.liveAllowed === false;
  const k = useScale();

  return (
    <div className="theme-dark relative min-h-dvh overflow-x-clip">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] opacity-[0.045] mix-blend-soft-light" style={{ backgroundImage: GRAIN, backgroundSize: '220px 220px' }} />
      <TopBar />

      <main id="main">
        <Hero />
        <Problem canFetch={canFetch} />

        <section id="live" aria-label="Live routing" className="mx-auto mt-28 max-w-[77.5rem] scroll-mt-20 px-4 sm:px-8 lg:mt-36">
          <Reveal as="div">
            <SectionTitle eyebrow="The fix">ElevenRoute sits between your assistant and the models, and decides every turn.</SectionTitle>
            <motion.p variants={item} className="mt-4 max-w-[62ch] text-[1rem] leading-relaxed text-pretty text-ink-2">
              Below, the real router behind this page is reading sample customer messages, checking them against policy and quality floors, and choosing a model for each. These are dry runs: decisions only, no model is called.
            </motion.p>
          </Reveal>
          <div className="mt-10">
            <Stage canFetch={canFetch} demo={config.data?.mode !== 'live'} />
          </div>
        </section>

        <Reveal id="how" className="mx-auto mt-28 max-w-[77.5rem] px-4 sm:px-8 lg:mt-36">
          <SectionTitle eyebrow="How a turn is routed">Four decisions, made before any model is called.</SectionTitle>
          <ol className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <motion.li key={s.title} variants={item} className="border-t border-ink/15 pt-5">
                <span className="font-mono text-[0.75rem] tracking-[0.08em] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-3 text-[1.1875rem] font-medium tracking-[-0.01em] text-ink">{s.title}</h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-pretty text-ink-2">{s.body}</p>
              </motion.li>
            ))}
          </ol>
        </Reveal>

        <Proof canFetch={canFetch} />

        <Reveal id="control" className="mx-auto mt-28 max-w-[77.5rem] px-4 sm:px-8 lg:mt-36">
          <SectionTitle eyebrow="You stay in control">Cheaper where it’s safe. Never below the bar you set.</SectionTitle>
          <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {CONTROLS.map((c) => (
              <motion.li key={c.title} variants={item}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/[0.06] text-ink ring-1 ring-ink/10">
                  <c.icon size="1.125rem" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[1.0625rem] font-medium text-ink">{c.title}</h3>
                <p className="mt-1.5 text-[0.9063rem] leading-relaxed text-pretty text-ink-2">{c.body}</p>
              </motion.li>
            ))}
          </ul>
        </Reveal>

        <Reveal id="inside" className="mx-auto mt-28 max-w-[77.5rem] px-4 sm:px-8 lg:mt-36">
          <SectionTitle eyebrow="Inside the dashboard">Everything the router does, in the open.</SectionTitle>
          <ul className="mt-10 grid border-t border-line md:grid-cols-2 md:gap-x-12">
            {PAGES.map((p) => (
              <motion.li key={p.to} variants={item} className="border-b border-line">
                <Link to={p.to} className="group flex items-center gap-4 rounded-2xl py-5 transition-colors hover:bg-card/70 sm:px-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-ink transition-colors group-hover:bg-ink group-hover:text-canvas">
                    <p.icon size="1.125rem" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[1rem] font-medium text-ink">{p.title}</span>
                    <span className="mt-0.5 block text-[0.875rem] leading-snug text-ink-2">{p.body}</span>
                  </span>
                  <ArrowUpRight size="1.125rem" aria-hidden="true" className="shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
                </Link>
              </motion.li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="mx-auto mt-28 max-w-[77.5rem] px-4 pb-10 sm:px-8 lg:mt-36">
          <motion.div variants={item} className="relative overflow-hidden rounded-[1.75rem] border border-line px-6 py-14 sm:px-12 lg:py-20">
            <Glow className="-top-40 -right-24 h-[28.75rem] w-[28.75rem]" />
            <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="h-display max-w-[16ch] text-[clamp(2.25rem,5vw,4rem)] leading-[1.02] text-balance">Send a message. Watch where it goes.</h2>
                <p className="mt-4 max-w-[48ch] text-[1rem] leading-relaxed text-ink-2">Type anything a customer might write in the Playground and see the decision, the model, the cost and every step behind it.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <CtaLink to="/playground">Open the Playground</CtaLink>
                <CtaLink to="/overview" variant="secondary">See the Overview</CtaLink>
              </div>
            </div>
          </motion.div>
        </Reveal>
      </main>

      <footer className="mx-auto flex max-w-[77.5rem] flex-col gap-3 px-4 pt-6 pb-12 text-[0.8125rem] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span className="flex items-center gap-2">
          <BrandOrb size={Math.round(20 * k)} outline />
          ElevenRoute
        </span>
        {openAccess ? <span>Open access: everyone with this link shares one demo workspace, so live mode is locked and nothing here calls a paid model.</span> : null}
      </footer>
    </div>
  );
}

// ---------- page chrome ----------
function TopBar() {
  const k = useScale();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`sticky top-0 z-40 border-b backdrop-blur transition-colors duration-300 ${scrolled ? 'border-line bg-canvas/80' : 'border-transparent bg-canvas/0'}`}>
      <div className="mx-auto flex h-16 max-w-[77.5rem] items-center justify-between gap-4 px-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5 rounded-xl" aria-label="ElevenRoute home">
          <BrandOrb size={Math.round(30 * k)} live beat outline />
          <span className="h-display text-[1.375rem]">ElevenRoute</span>
        </Link>
        <nav aria-label="Landing" className="flex items-center gap-1 sm:gap-2">
          <a href="#problem" className="hidden rounded-full px-3 py-2 text-[0.875rem] text-ink-2 hover:text-ink md:inline-block">Why</a>
          <a href="#live" className="hidden rounded-full px-3 py-2 text-[0.875rem] text-ink-2 hover:text-ink md:inline-block">See it live</a>
          <a href="#how" className="hidden rounded-full px-3 py-2 text-[0.875rem] text-ink-2 hover:text-ink sm:inline-block">How it works</a>
          <CtaLink to="/overview" size="sm">Open dashboard</CtaLink>
        </nav>
      </div>
    </header>
  );
}

/** Soft, static brand-coloured light (decorative; never animated, so it costs nothing to render). */
function Glow({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{ background: 'radial-gradient(closest-side, rgb(122 92 255 / 0.22), rgb(63 193 180 / 0.10) 55%, transparent)' }}
    />
  );
}

const HEADLINE = 'Use the big model only when the message needs it.';

function Hero() {
  const k = useScale();
  const words = HEADLINE.split(' ');
  return (
    <section className="relative mx-auto max-w-[77.5rem] px-4 pt-12 pb-10 sm:px-8 lg:pt-20">
      <Glow className="-top-32 right-[-7.5rem] h-[38.75rem] w-[38.75rem]" />
      {/* The brand mark, large and alive: its three provider lights circle the black sphere. */}
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0, scale: 0.86 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.1, delay: 0.2, ease: EASE }}
        className="pointer-events-none absolute top-24 right-10 hidden rounded-full shadow-[0_40px_120px_-20px_rgb(122_92_255/0.35)] xl:block">
        <BrandOrb size={Math.round(320 * k)} live beat outline ping />
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="relative inline-flex items-center gap-2 rounded-full border border-line bg-card/60 px-3 py-1.5 text-[0.8125rem] text-ink-2">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inset-0 animate-ping rounded-full bg-ok/50" />
          <span className="relative h-2 w-2 rounded-full bg-ok" />
        </span>
        LLM routing for customer service
      </motion.p>

      <h1 className="h-display relative mt-7 max-w-[14ch] text-[clamp(2.625rem,6.8vw,6rem)] leading-[0.98] text-balance">
        {words.map((w, i) => (
          <span key={i} className="-mb-[0.1em] inline-block overflow-hidden pb-[0.18em] align-bottom">
            <motion.span className="-mb-[0.1em] inline-block pb-[0.1em] bg-gradient-to-b from-[#ffffff] via-[#f4f1ed] to-[#a9a29b] bg-clip-text text-transparent" initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 0.8, delay: 0.08 + i * 0.055, ease: EASE }}>
              {w}
              {i < words.length - 1 ? ' ' : ''}
            </motion.span>
          </span>
        ))}
      </h1>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.55, ease: EASE }}
        className="relative mt-9 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[54ch]">
          <p className="text-[1.0625rem] leading-relaxed text-pretty text-ink-2 sm:text-[1.125rem]">
            ElevenRoute sits between your customer-service assistant and the AI providers. It reads every message, sends the simple ones to a fast, low-cost model and the hard ones to a strong one, and moves to another provider the moment one fails.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 text-[0.875rem] text-ink-2">
            <span className="text-ink-3">Routes across</span>
            {VENDOR_ORDER.map((v) => (
              <span key={v} className="inline-flex items-center gap-2">
                <Orb model={{ vendor: v, tier: 'flagship' }} size={Math.round(20 * k)} live />
                {VENDOR_NAMES[v]}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <CtaLink to="/overview">Open the dashboard</CtaLink>
          <CtaLink href="#live" variant="secondary">Watch it route</CtaLink>
        </div>
      </motion.div>
    </section>
  );
}

// ---------- the pitch: problem and proof ----------
function Problem({ canFetch }: { canFetch: boolean }) {
  const providers = useApi<ModelInfo[]>(canFetch ? '/providers' : null);
  // Price gap from the live catalogue, never a made-up figure.
  const ratio = useMemo(() => {
    const prices = (providers.data ?? []).filter((m) => m.enabled).map(blended).filter((p) => p > 0);
    return prices.length > 1 ? Math.max(...prices) / Math.min(...prices) : null;
  }, [providers.data]);
  const points: { icon: LucideIcon; title: string; body: ReactNode }[] = [
    {
      icon: Wallet,
      title: 'Paying flagship prices for “thanks”',
      body: (
        <>
          “Yes, that works.” “Where’s order 48213?” Many support turns are this simple, yet a one-model setup sends every one of them to the same model.
          {ratio ? <> In this demo’s price list the priciest model costs <strong className="font-medium text-ink">{Math.round(ratio)}×</strong> the cheapest per token.</> : null}
        </>
      ),
    },
    {
      icon: ServerCrash,
      title: 'One provider, one outage from silence',
      body: 'When your only provider errors or slows down, every customer in the queue waits with it.',
    },
    {
      icon: Globe2,
      title: 'Switching models is a blind bet',
      body: 'Without the same tests on every model, nobody can say where quality drops, so teams never dare to move off the expensive one.',
    },
  ];
  return (
    <Reveal id="problem" className="mx-auto mt-24 max-w-[77.5rem] px-4 sm:px-8 lg:mt-32">
      <SectionTitle eyebrow="The problem">Most support messages don’t need your most expensive model.</SectionTitle>
      <ul className="mt-12 grid gap-10 md:grid-cols-3">
        {points.map((p) => (
          <motion.li key={p.title} variants={item} className="border-t border-ink/15 pt-6">
            <p.icon size="1.25rem" className="text-ember" aria-hidden="true" />
            <h3 className="mt-4 text-[1.1875rem] font-medium tracking-[-0.01em] text-ink">{p.title}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-pretty text-ink-2">{p.body}</p>
          </motion.li>
        ))}
      </ul>
    </Reveal>
  );
}

/** Real numbers from this demo's logged (simulated) traffic and test runs, labelled as such. */
function Proof({ canFetch }: { canFetch: boolean }) {
  const savings = useApi<Savings>(canFetch ? '/stats/savings?days=14' : null);
  const overview = useApi<Overview>(canFetch ? '/stats/overview?days=14' : null);
  const runs = useApi<TestRun[]>(canFetch ? '/tests/runs' : null);
  const providers = useApi<ModelInfo[]>(canFetch ? '/providers' : null);
  const cases = useApi<TestCase[]>(canFetch ? '/tests/cases' : null);
  const s = savings.data;
  const o = overview.data;
  if (!s || !o) return null;

  const tested = (providers.data ?? []).filter((m) => m.testScore !== null).length;
  const rescued = Math.max(0, o.failovers - (s.unansweredTurns ?? 0));
  const cheaper = s.savings >= 0;

  return (
    <Reveal id="proof" className="mx-auto mt-28 max-w-[77.5rem] px-4 sm:px-8 lg:mt-36">
      <SectionTitle eyebrow="In this demo">What routing changed on the demo’s traffic.</SectionTitle>
      {s.turns === 0 ? (
        <motion.p variants={item} className="mt-8 max-w-[60ch] text-[1rem] leading-relaxed text-ink-2">
          No traffic has been logged yet. Generate some on the <Link to="/overview" className="font-medium text-ink underline underline-offset-4">Overview</Link> and this section fills in with real numbers from it.
        </motion.p>
      ) : (
        <>
          <div className="mt-12 grid gap-px overflow-hidden rounded-[1.5rem] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <Figure value={Math.abs(s.savingsPct)} format={(n) => `${n.toFixed(1)}%`} label={cheaper ? 'lower model spend than sending every turn to the best allowed model' : 'higher spend than the best-model baseline'} tone={cheaper ? 'ok' : 'warn'} />
            <Figure value={s.turns} format={count} label="turns routed in the last 14 days" />
            <Figure value={rescued} format={count} label={rescued === 1 ? 'turn answered by another provider after a failure' : 'turns answered by another provider after a failure'} />
            <Figure value={tested} format={count} label={tested ? `models scored on the same ${cases.data?.length ?? 24} test conversations${runs.data?.length ? ` (${runs.data.length} ${runs.data.length === 1 ? 'run' : 'runs'})` : ''}` : 'models tested so far: run the tests to score them'} />
          </div>
          <motion.p variants={item} className="mt-4 text-[0.7813rem] leading-relaxed text-ink-3">
            Measured on this demo’s logged traffic, which comes from simulated providers at illustrative prices. Your own traffic and prices give your own numbers.
          </motion.p>
        </>
      )}
    </Reveal>
  );
}

function Figure({ value, format, label, tone }: { value: number; format: (n: number) => string; label: string; tone?: 'ok' | 'warn' }) {
  return (
    <motion.div variants={item} className="bg-canvas p-6 sm:p-8">
      <AnimatedNumber value={value} format={format} className={`h-display block text-[2.75rem] leading-none sm:text-[3.25rem] ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-ember' : ''}`} />
      <p className="mt-3 text-[0.875rem] leading-snug text-ink-2">{label}</p>
    </motion.div>
  );
}

// ---------- the live stage ----------
type Pt = { x: number; y: number };
type Geo = { w: number; h: number; inP: Pt; hubL: Pt; hubR: Pt; models: Record<string, Pt> };

const curve = (a: Pt, b: Pt) => {
  const dx = (b.x - a.x) * 0.5;
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
};

/** Alternate simple and complex turns (and languages) so the loop shows both routes. */
function interleave(cases: TestCase[]): TestCase[] {
  const simple = cases.filter((c) => c.turnType === 'simple');
  const complex = cases.filter((c) => c.turnType === 'complex');
  const out: TestCase[] = [];
  for (let i = 0; i < Math.max(simple.length, complex.length); i++) {
    if (simple[i]) out.push(simple[i]);
    if (complex[(i + 3) % complex.length]) out.push(complex[(i + 3) % complex.length]);
  }
  return out;
}

function useWide() {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function Stage({ canFetch, demo }: { canFetch: boolean; demo: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const wide = useWide();
  const k = useScale();
  const hub = Math.round((wide ? HUB : 72) * k);
  const cases = useApi<TestCase[]>(canFetch ? '/tests/cases' : null);
  const providers = useApi<ModelInfo[]>(canFetch ? '/providers' : null);
  const models = useMemo(() => sortModels((providers.data ?? []).filter((m) => m.enabled)), [providers.data]);
  const queue = useMemo(() => interleave(cases.data ?? []), [cases.data]);
  const n = queue.length;

  // Real decisions: a /route/preview dry run per message (no model is called, nothing is logged).
  const [previews, setPreviews] = useState<Record<string, PreviewResponse>>({});
  useEffect(() => {
    if (!canFetch || !queue.length) return;
    const c = new AbortController();
    for (const tc of queue) {
      api
        .post<PreviewResponse>('/route/preview', { message: tc.message, language: tc.language, use_case: tc.useCase, customer_id: 'default' }, c.signal)
        .then((res) => setPreviews((p) => ({ ...p, [tc.id]: res })))
        .catch(() => {});
    }
    return () => c.abort();
  }, [queue, canFetch]);

  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(-1);
  const [playing, setPlaying] = useState(!reduce);
  // Off-screen the demo holds its place instead of stepping (and re-rendering) where nobody can see it.
  const [screenRef, onScreen] = useOnScreen<HTMLDivElement>();
  const current = n ? queue[step % n] : undefined;
  const ready = Boolean(current && previews[current.id]);

  useEffect(() => {
    if (!playing || !ready || !onScreen) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, ready, step, onScreen]);

  // Geometry for the connecting curves (wide screens only), measured relative to the stage.
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dotRef = useRef<SVGGElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const measure = useCallback(() => {
    const st = stageRef.current;
    if (!st || !wide) return setGeo(null);
    const b = st.getBoundingClientRect();
    const at = (el: Element | null, side: 'l' | 'r'): Pt | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (side === 'l' ? r.left : r.right) - b.left, y: r.top + r.height / 2 - b.top };
    };
    const hub = st.querySelector('[data-anchor="hub"]');
    const inP = at(st.querySelector('[data-anchor="in"]'), 'r');
    const hubL = at(hub, 'l');
    const hubR = at(hub, 'r');
    if (!inP || !hubL || !hubR) return setGeo(null);
    const ms: Record<string, Pt> = {};
    st.querySelectorAll<HTMLElement>('[data-anchor-model]').forEach((el) => {
      ms[el.dataset.anchorModel!] = at(el, 'l')!;
    });
    setGeo({ w: b.width, h: b.height, inP: { x: inP.x + 6, y: inP.y }, hubL: { x: hubL.x - 6, y: hubL.y }, hubR: { x: hubR.x + 6, y: hubR.y }, models: ms });
  }, [wide]);

  useEffect(() => {
    measure();
    const st = stageRef.current;
    if (!st) return;
    const ro = new ResizeObserver(measure);
    ro.observe(st);
    return () => ro.disconnect();
  }, [measure, models.length]);

  const chosenId = current ? previews[current.id]?.ranked[0] : undefined;
  const animated = Boolean(geo && !reduce && ready && onScreen);

  // Fan of faint lines from the router to every model draws in once.
  useEffect(() => {
    const root = svgRef.current;
    if (!root || !geo) return;
    const fans = root.querySelectorAll<SVGPathElement>('[data-fan]');
    const lines = fans.length ? svg.createDrawable(fans) : [];
    if (reduce) {
      lines.forEach((l) => l.setAttribute('draw', '0 1'));
      return;
    }
    const a = animate(lines, { draw: ['0 0', '0 1'], duration: 900, delay: stagger(70, { start: 200 }), ease: 'inOutSine' });
    return () => {
      a.pause();
      lines.forEach((l) => l.setAttribute('draw', '0 1'));
    };
    // Only when the set of models or the layout changes, not on every step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo?.w, geo?.h, models.length, reduce]);

  // Each step: the message travels into the router, the router pulses, then it goes out to the chosen model.
  useEffect(() => {
    if (!ready) return;
    if (!animated) {
      setShown(step);
      return;
    }
    const root = svgRef.current!;
    const dot = dotRef.current!;
    const inEl = root.querySelector<SVGPathElement>(`[data-in="${step}"]`);
    const outEl = root.querySelector<SVGPathElement>(`[data-out="${step}"]`);
    const lightEl = root.querySelector<SVGPathElement>(`[data-light="${step}"]`);
    const hub = stageRef.current!.querySelector('[data-hub-pulse]');
    if (!inEl || !outEl || !lightEl || !hub) {
      setShown(step);
      return;
    }
    const [inLine] = svg.createDrawable(inEl);
    const [outLine] = svg.createDrawable(outEl);
    const [light] = svg.createDrawable(lightEl);
    inLine.setAttribute('draw', '0 0');
    outLine.setAttribute('draw', '0 0');
    light.setAttribute('draw', '0 0');
    utils.set(dot, { opacity: 0 });

    const p1 = svg.createMotionPath(inEl);
    const p2 = svg.createMotionPath(outEl);
    const tl = createTimeline()
      .add(inLine, { draw: ['0 0', '0 1'], duration: 560, ease: 'inOutSine' }, 300)
      .add(dot, { translateX: p1.translateX, translateY: p1.translateY, duration: 640, ease: 'inOutSine' }, 300)
      .add(dot, { opacity: [0, 1], duration: 140, ease: 'linear' }, 300)
      .add(hub, { scale: [1, 1.07, 1], duration: 560, ease: 'outQuad' }, 900)
      .call(() => setShown(step), 940)
      .add(outLine, { draw: ['0 0', '0 1'], duration: 560, ease: 'inOutSine' }, 1000)
      .add(dot, { translateX: p2.translateX, translateY: p2.translateY, duration: 640, ease: 'inOutSine' }, 1000)
      .add(dot, { opacity: [1, 0], duration: 180, ease: 'linear' }, 1500)
      .add(inLine, { draw: ['0 1', '1 1'], duration: 520, ease: 'inOutSine' }, 1300);
    const flow = animate(light, { draw: ['0 0', '0 0.18', '0.82 1', '1 1'], duration: 1400, delay: 1700, loop: true, loopDelay: 250, ease: 'inOutSine' });
    return () => {
      tl.pause();
      flow.pause();
      utils.set(dot, { opacity: 0 });
    };
  }, [step, animated, ready]);

  const shownCase = shown >= 0 && n ? queue[shown % n] : undefined;
  const decision = shownCase ? previews[shownCase.id] : undefined;
  const pickedId = decision?.ranked[0];
  const incoming = n ? [0, 1, 2].filter((k) => step - k >= 0).map((k) => ({ key: step - k, tc: queue[(step - k) % n] })) : [];
  const outD = geo && chosenId && geo.models[chosenId] ? curve(geo.hubR, geo.models[chosenId]) : null;

  return (
    <div ref={screenRef} className="relative rounded-[1.75rem] bg-card p-4 ring-1 ring-line sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {playing && !reduce ? <span className="absolute inset-0 animate-ping rounded-full bg-ember/60" /> : null}
            <span className="relative h-2 w-2 rounded-full bg-ember" />
          </span>
          <span><strong className="font-medium text-ink">Real router decisions</strong> · dry runs, no model is called</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={!playing}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 text-[0.8125rem] font-medium text-ink hover:border-ink/20">
            {playing ? <Pause size="0.875rem" aria-hidden="true" /> : <Play size="0.875rem" aria-hidden="true" />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!ready}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 text-[0.8125rem] font-medium text-ink hover:border-ink/20 disabled:opacity-50">
            <SkipForward size="0.875rem" aria-hidden="true" />
            Next
          </button>
        </div>
      </div>

      <div ref={stageRef} className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-20">
        {geo ? (
          <svg ref={svgRef} width={geo.w} height={geo.h} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
            {models.map((m) => (geo.models[m.id] ? <path key={m.id} data-fan d={curve(geo.hubR, geo.models[m.id])} fill="none" style={{ stroke: 'color-mix(in srgb, var(--color-ink) 20%, transparent)' }} strokeWidth={1.25} /> : null))}
            <AnimatePresence>
              <motion.path key={`in${step}`} data-in={step} d={curve(geo.inP, geo.hubL)} fill="none" style={{ stroke: 'var(--color-ink)' }} strokeOpacity={0.35} strokeWidth={1.5} strokeLinecap="round" exit={{ opacity: 0, transition: { duration: 0.3 } }} />
              {outD ? <motion.path key={`out${step}`} data-out={step} d={outD} fill="none" style={{ stroke: 'var(--color-ink)' }} strokeWidth={2} strokeLinecap="round" exit={{ opacity: 0, transition: { duration: 0.35 } }} /> : null}
              {outD ? <motion.path key={`light${step}`} data-light={step} d={outD} fill="none" style={{ stroke: 'var(--color-canvas)' }} strokeWidth={2} strokeLinecap="round" exit={{ opacity: 0, transition: { duration: 0.2 } }} /> : null}
            </AnimatePresence>
            <g ref={dotRef} style={{ opacity: 0 }}>
              <circle r={7} style={{ fill: 'var(--color-ink)' }} />
              <circle r={2.6} style={{ fill: 'var(--color-canvas)' }} />
            </g>
          </svg>
        ) : null}

        {/* Incoming messages */}
        <div className="relative">
          <div className="label mb-3">Incoming</div>
          <div className="relative h-[5.75rem] overflow-hidden lg:h-[18.75rem]">
            <span data-anchor="in" className="absolute top-[2.75rem] right-0 h-0 w-0" aria-hidden="true" />
            <AnimatePresence initial={false} mode="popLayout">
              {incoming.map(({ key, tc }, i) => (
                <motion.div
                  key={key}
                  layout
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: i === 0 ? 1 : 0.45 - i * 0.12, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: EASE }}
                  className={`mb-3 rounded-2xl bg-canvas px-4 py-3 ring-1 ring-line ${i > 0 ? 'hidden lg:block' : ''}`}>
                  <div className="mb-1 flex items-center gap-2 text-[0.7188rem] font-medium tracking-[0.04em] text-ink-3 uppercase">
                    <span>{LANGS.find((l) => l.value === tc.language)?.label ?? tc.language}</span>
                    <span aria-hidden="true">·</span>
                    <span>{USE_CASES.find((u) => u.value === tc.useCase)?.label ?? tc.useCase}</span>
                  </div>
                  <p className="line-clamp-2 text-[0.875rem] leading-snug text-ink">{tc.message}</p>
                </motion.div>
              ))}
            </AnimatePresence>
            {!n ? <div className="skeleton h-[5.25rem]" /> : null}
          </div>
        </div>

        {/* The router */}
        <div className="flex items-center gap-5 lg:flex-col lg:gap-4">
          <div data-anchor="hub" className="relative ml-3 shrink-0 lg:ml-0" style={{ width: hub, height: hub }}>
            <div data-hub-pulse className="h-full w-full">
              <BrandOrb size={hub} live ping drift={false} />
            </div>
          </div>
          <div className="min-h-[4.75rem] lg:w-[12.5rem] lg:text-center" aria-live="polite">
            <div className="text-[0.8125rem] font-medium text-ink">ElevenRoute</div>
            <AnimatePresence mode="wait" initial={false}>
              {decision ? (
                <motion.div key={shown} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }} className="mt-2">
                  <TurnBadge turnType={decision.turn_type} score={decision.trace.classification.score} />
                  <p className="mt-2 line-clamp-2 text-[0.7813rem] leading-snug text-ink-2">{decision.route_reason}</p>
                </motion.div>
              ) : (
                <p className="mt-2 text-[0.7813rem] text-ink-3">Reading the first message…</p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Models */}
        <div>
          <div className="label mb-3">Models</div>
          <ul className="flex flex-col gap-1.5">
            {models.map((m) => {
              const on = m.id === pickedId;
              return (
                <li
                  key={m.id}
                  data-anchor-model={m.id}
                  className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-[background-color,box-shadow] duration-300 ${on ? 'bg-canvas shadow-[var(--shadow-card)] ring-1 ring-ink/10' : 'ring-1 ring-transparent'}`}>
                  <Orb model={m} size={Math.round(24 * k)} live />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[0.875rem] font-medium transition-colors ${on ? 'text-ink' : 'text-ink-2'}`}>{m.name}</span>
                    <span className="block text-[0.75rem] text-ink-3">{VENDOR_SHORT[m.vendor]} · {m.tier === 'flagship' ? 'Flagship' : 'Fast'}</span>
                  </span>
                  <AnimatePresence>
                    {on ? (
                      <motion.span initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.25, ease: EASE }} className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[0.7188rem] font-medium text-canvas">
                        Chosen
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </li>
              );
            })}
            {!models.length ? Array.from({ length: 6 }, (_, i) => <li key={i} className="skeleton h-[3.25rem]" />) : null}
          </ul>
        </div>
      </div>

      {demo ? <p className="mt-6 text-[0.75rem] text-ink-3">Demo mode: model quality scores, latencies and errors are simulated settings, not live measurements.</p> : null}
    </div>
  );
}

// ---------- small pieces ----------
const item = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } };
const revealVariants = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

function Reveal({ children, className = '', id, as = 'section' }: { children: ReactNode; className?: string; id?: string; as?: 'section' | 'div' }) {
  const props = { id, className: `scroll-mt-20 ${className}`, initial: 'hidden', whileInView: 'show', viewport: { once: true, margin: '0px 0px -12% 0px' }, variants: revealVariants } as const;
  return as === 'div' ? <motion.div {...props}>{children}</motion.div> : <motion.section {...props}>{children}</motion.section>;
}

function SectionTitle({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <motion.div variants={item}>
      <p className="text-[0.8125rem] font-medium tracking-[0.06em] text-ink-3 uppercase">{eyebrow}</p>
      <h2 className="h-display mt-3 max-w-[24ch] text-[clamp(1.875rem,3.6vw,2.875rem)] leading-[1.05] text-balance">{children}</h2>
    </motion.div>
  );
}

/** Pill link styled as a button: a route (to) or an anchor on this page (href). Colours follow the theme. */
function CtaLink({ to, href, children, variant = 'primary', size = 'md' }: { to?: string; href?: string; children: ReactNode; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md' }) {
  const look = variant === 'primary' ? 'bg-ink text-canvas hover:bg-ink/90' : 'border border-line bg-canvas text-ink hover:border-ink/30 hover:bg-card';
  const sizing = size === 'sm' ? 'h-9 px-4 text-[0.8125rem] gap-1.5' : 'h-12 px-6 text-[0.9375rem] gap-2';
  const cls = `group inline-flex items-center rounded-full font-medium transition-colors active:scale-[0.98] ${look} ${sizing}`;
  const inner = (
    <>
      {children}
      <ArrowRight size={size === 'sm' ? '0.875rem' : '1rem'} aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5" />
    </>
  );
  return href ? <a href={href} className={cls}>{inner}</a> : <Link to={to ?? '/'} className={cls}>{inner}</Link>;
}
