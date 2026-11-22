import { animate, createTimeline, stagger, svg, utils } from 'animejs';
import { ArrowUpRight, Bot, MessagesSquare, Pause, Play, ServerCrash, SkipForward, Split, Wallet, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type Variants } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router';

import type { AppConfig, ModelInfo, Overview, PreviewResponse, Savings, TestCase } from '../../../shared/types';
import { AgentStage } from '../components/AgentStage';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { BrandOrb, Orb } from '../components/Orb';
import { PromoSlot } from '../components/PromoSlot';
import { CtaLink, Glow, Reveal, SectionTitle, SitePage, useDarkPage, useMedia, useScale } from '../components/Site';
import { TurnBadge } from '../components/ui';
import { api } from '../lib/api';
import { useOnScreen } from '../lib/anime';
import { useAuth } from '../lib/auth';
import { count, USE_CASES } from '../lib/format';
import { useIndicator } from '../lib/indicator';
import { EASE } from '../lib/motion';
import { PROMO } from '../lib/promo';
import { sortModels, VENDOR_NAMES, VENDOR_ORDER, VENDOR_SHORT } from '../lib/theme';
import { useApi } from '../lib/useApi';

// The landing page is the hook: one idea, a live demo, three reasons, proof, one next step. Detail lives in the
// dashboard pages it links to (how a turn is routed: Routing rules; how the agent works: ElevenAgent).

/** One message every STEP_MS: it travels into the router, then out to the model the router picked. */
const STEP_MS = 3800;
const HUB = 112;

/** Blended price per 1k tokens, the same weighting the router uses (about 3 input tokens per output token). */
const blended = (m: ModelInfo) => (3 * m.costIn + m.costOut) / 4;

export default function Landing() {
  const { enabled, session } = useAuth();
  // With sign-in on, the API needs a session; the landing page then shows without live data.
  const canFetch = !enabled || Boolean(session);
  const config = useApi<AppConfig>(canFetch ? '/config' : null);

  useDarkPage('ElevenRoute · Smart where it matters. Cheap where it doesn’t.');
  // Arriving from another page by a link to one of this page's sections (/#live): go straight to it.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, []);

  const k = useScale();

  return (
    <SitePage home>
      <main id="main">
        <Hero />

        {/* The ad slot exists only once an ad is configured in lib/promo.ts. */}
        {PROMO ? (
          <Reveal id="film" className="mx-auto mt-16 max-w-[77.5rem] px-4 sm:px-8 lg:mt-20">
            {/* Never taller than the screen: on a short screen the frame narrows so the whole ad is in view at once. */}
            <div className="mx-auto w-full max-w-[calc((100svh-9rem)*16/9)]">
              <PromoSlot promo={PROMO} />
            </div>
          </Reveal>
        ) : null}

        <Live canFetch={canFetch} sample={config.data?.mode !== 'live'} k={k} />
        <Why canFetch={canFetch} />
        <Proof canFetch={canFetch} />

        {/* The closing ask repeats the hero's first action: play a call. */}
        <Reveal className="mx-auto mt-28 max-w-[77.5rem] px-4 pb-10 sm:px-8 lg:mt-36">
          <div className="relative overflow-hidden rounded-[1.75rem] border border-line px-6 py-14 sm:px-12 lg:py-20">
            <Glow className="-top-40 -right-24 h-[28.75rem] w-[28.75rem]" period={26} delay={9} />
            <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h2 className="h-display max-w-[18ch] text-[clamp(2.25rem,5vw,4rem)] leading-[1.02] tracking-[-0.032em] text-balance">See a whole call, start to finish.</h2>
                <p className="mt-4 max-w-[46ch] text-[1rem] leading-relaxed text-ink-2">Play a refund, a renewal or a booking with ElevenAgent, or type your own message in the Playground and see the model, the cost and every step behind the answer.</p>
              </div>
              {/* The text gives way, not the buttons: they stay side by side on one row. */}
              <div className="flex flex-wrap gap-3 lg:shrink-0 lg:flex-nowrap">
                <CtaLink to="/agent">Play a live call</CtaLink>
                <CtaLink to="/playground" variant="secondary">Open the Playground</CtaLink>
              </div>
            </div>
          </div>
        </Reveal>
      </main>
    </SitePage>
  );
}

/** The line to remember, one sentence per line. */
const HEADLINE = ['Smart where it matters.', 'Cheap where it doesn’t.'];

// ---------- the caller behind "Play a live call" ----------
// The person on the line, previewed by the orb: one soft ripple leaves its outer ring, like the first movement of a
// voice, and the caller's opening line fades in, word by word. Silent, and it never delays the link.
// - Wide screens with a mouse: the big hero orb speaks while "Play a live call" is hovered or keyboard-focused.
// - Everywhere else (phones, tablets, touch screens): a small orb by the buttons (or the big one, on a wide touch
//   screen) speaks once as the hero finishes arriving, and the line stays; hovering or focusing the button sends
//   another ripple. A tap goes straight to the call.
// - Reduced motion: the line is simply there, with no ripple.

/** The refund call's opening complaint, in the customer's own words. */
const CALLER_LINE = '“I’ve been charged twice.”';
/** The big orb shows from xl (HeroOrb); below that the small one in CallerRow. */
const BIG_ORB = '(min-width: 80rem)';
const MOUSE = '(hover: hover) and (pointer: fine)';
/** The caller speaks once the hero's entrance has landed (about 0.8 s). */
const INTRO_MS = 950;

function useCaller(reduce: boolean) {
  const big = useMedia(BIG_ORB);
  const mouse = useMedia(MOUSE);
  const onHover = big && mouse && !reduce;
  const input = useRef({ hover: false, focus: false });
  const on = useRef(false);
  const [hovering, setHovering] = useState(false);
  const [intro, setIntro] = useState(false);
  const [pulse, setPulse] = useState(0);

  // Where the line doesn't wait for the pointer, the caller speaks once, after the hero has arrived.
  useEffect(() => {
    if (reduce || onHover || intro) return;
    const t = setTimeout(() => {
      setIntro(true);
      setPulse((p) => p + 1);
    }, INTRO_MS);
    return () => clearTimeout(t);
  }, [reduce, onHover, intro]);

  const sync = () => {
    const now = input.current.hover || input.current.focus;
    if (now === on.current) return;
    on.current = now;
    setHovering(now);
    if (now && !reduce) setPulse((p) => p + 1);
  };
  const handlers = {
    onPointerEnter: (e: ReactPointerEvent<HTMLAnchorElement>) => {
      if (e.pointerType !== 'mouse') return; // a tap goes straight to the call
      input.current.hover = true;
      sync();
    },
    onPointerLeave: () => {
      input.current.hover = false;
      sync();
    },
    // Keyboard focus only: a mouse press also focuses the link, but that click is already navigating.
    onFocus: (e: FocusEvent<HTMLAnchorElement>) => {
      input.current.focus = e.currentTarget.matches(':focus-visible');
      sync();
    },
    onBlur: () => {
      input.current.focus = false;
      sync();
    },
  };
  // Under reduced motion the line is always there; otherwise it shows while hovered (big orb and a mouse) or from
  // the intro on.
  const speaking = reduce || (onHover ? hovering : intro);
  return { speaking, pulse, handlers };
}

/** Each word of the caption arrives a beat after the last, the way speech does; it leaves all at once. */
const WORD: Variants = {
  hide: { opacity: 0, y: 4, transition: { duration: 0.2, ease: EASE } },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
};

/**
 * The caller's line. Its space is always kept (empty while silent), so nothing moves when it fills: one centred line
 * under the big orb, or a label over the words beside the small one.
 */
function CallerWords({ speaking, id, stacked = false }: { speaking: boolean; id?: string; stacked?: boolean }) {
  const words = CALLER_LINE.split(' ');
  return (
    <motion.p
      id={id}
      initial={false}
      animate={speaking ? 'show' : 'hide'}
      // The words start as the ripple passes the ring.
      variants={{ show: { transition: { delayChildren: 0.14, staggerChildren: 0.07 } }, hide: {} }}
      className={stacked ? 'flex min-w-0 flex-col items-start' : 'mt-7 flex h-7 items-center justify-center gap-2.5 whitespace-nowrap'}>
      <motion.span variants={WORD} className="text-[0.6875rem] font-medium tracking-[0.08em] text-ink-3 uppercase">Caller</motion.span>
      <span className={stacked ? 'mt-0.5 text-[1.0625rem] leading-snug text-ink' : 'text-[1.125rem] text-ink'}>
        {words.map((w, i) => (
          <motion.span key={i} variants={WORD} className="inline-block whitespace-pre">
            {w}{i < words.length - 1 ? ' ' : ''}
          </motion.span>
        ))}
      </span>
    </motion.p>
  );
}

/** One ripple per "start speaking": keyed by its count, so each one plays the keyframes once. */
function Ripple({ pulse, to }: { pulse: number; to?: number }) {
  if (!pulse) return null;
  return <span key={pulse} aria-hidden="true" className="voice-ring caller-ripple pointer-events-none absolute inset-0 rounded-full" style={to ? ({ '--ripple-to': to } as CSSProperties) : undefined} />;
}

/**
 * Phones, tablets and small laptops have no room for the big orb, so a small one sits under the buttons with the
 * caller's line beside it, like an incoming call.
 */
function CallerRow({ k, speaking, pulse }: { k: number; speaking: boolean; pulse: number }) {
  const size = Math.round(52 * k);
  return (
    <div className="mt-6 flex items-center gap-4 xl:hidden">
      <span aria-hidden="true" className="relative shrink-0" style={{ width: size, height: size }}>
        <BrandOrb size={size} live beat outline />
        {/* On a small orb the ripple travels further, so it reads at the same size as the big one's. */}
        <Ripple pulse={pulse} to={1.9} />
      </span>
      <CallerWords id="caller-line" speaking={speaking} stacked />
    </div>
  );
}

/**
 * The brand mark, large and alive: its three provider lights circle the black sphere. It leans a little towards the
 * pointer (a soft spring, mouse only) and drifts up and dims as the page scrolls past it, so the hero has depth.
 * Transforms and opacity only; with reduced motion it simply sits still. While the caller is about to speak (see
 * useCallerPreview) one ripple leaves its outer ring, a warm light gathers behind it, and their line shows below.
 */
function HeroOrb({ k, speaking, pulse }: { k: number; speaking: boolean; pulse: number }) {
  const reduce = useReducedMotion() ?? false;
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 50, damping: 16, mass: 0.8 });
  const sy = useSpring(py, { stiffness: 50, damping: 16, mass: 0.8 });
  const x = useTransform(sx, (v) => v * 22);
  const y = useTransform(sy, (v) => v * 16);
  const glowX = useTransform(sx, (v) => v * -14);
  const glowY = useTransform(sy, (v) => v * -10);

  useEffect(() => {
    if (reduce) return;
    const on = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      px.set(e.clientX / window.innerWidth - 0.5);
      py.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, [reduce, px, py]);

  const size = Math.round(320 * k);
  return (
    <div aria-hidden="true" className="hero-orb-scroll pointer-events-none absolute top-24 right-10 hidden xl:block">
      <div className="relative" style={{ width: size, height: size }}>
        {/* The halo moves against the orb, which reads as depth. */}
        <motion.div className="absolute -inset-16 rounded-full" style={{ ...(reduce ? {} : { x: glowX, y: glowY }), background: 'radial-gradient(closest-side, rgb(122 92 255 / 0.26), rgb(63 193 180 / 0.08) 60%, transparent)' }} />
        {/* A warmer light gathers while someone is about to speak (opacity only). */}
        <div className={`absolute -inset-12 rounded-full transition-opacity duration-500 ease-out ${speaking ? 'opacity-100' : 'opacity-0'}`} style={{ background: 'radial-gradient(closest-side, rgb(255 106 43 / 0.14), rgb(122 92 255 / 0.10) 55%, transparent)' }} />
        {/* Decoration in the hero's entrance: it fades in with the headline and doesn't move on its way in. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, ease: EASE }}
          style={reduce ? undefined : { x, y }}
          className="relative rounded-full">
          <BrandOrb size={size} live beat outline ping />
          <Ripple pulse={pulse} />
        </motion.div>
      </div>
      <CallerWords speaking={speaking} />
    </div>
  );
}

/**
 * The hero's entrance, as one wave: the headline is the lead (two lines rising out of their masks, 110 ms apart), the
 * sentence and buttons follow as support, and the pill, the provider row and the orb only fade. The gaps shrink
 * (0 → 110 → 200 → 270 ms) and everything has landed by about 0.8 s. With reduced motion there are no delays.
 */
function Hero() {
  const k = useScale();
  const reduce = useReducedMotion() ?? false;
  const at = (s: number) => (reduce ? 0 : s);
  const caller = useCaller(reduce);
  return (
    <section className="relative mx-auto max-w-[77.5rem] px-4 pt-[clamp(2rem,6svh,5rem)] pb-6 sm:px-8">
      <Glow className="-top-32 right-[-7.5rem] h-[38.75rem] w-[38.75rem]" />
      <HeroOrb k={k} speaking={caller.speaking} pulse={caller.pulse} />
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="relative inline-flex items-center gap-2 rounded-full border border-line bg-card/60 px-3 py-1.5 text-[0.8125rem] text-ink-2">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inset-0 animate-ping rounded-full bg-ok/50" />
          <span className="relative h-2 w-2 rounded-full bg-ok" />
        </span>
        <span>
          <span className="hidden sm:inline">AI customer service · </span>ElevenAgent + ElevenRoute
        </span>
      </motion.p>

      {/* Two lines on laptops and desktops: the size follows the width beside the orb (the longest line is about
          10.6 em wide, so width / 11.2 always fits) and the screen height, so on a short screen the headline, the
          sentence and the buttons all fit in the first view. Phones wrap to four lines at the 2.5rem minimum. */}
      <h1 className="h-display relative mt-7 tracking-[-0.035em] text-[clamp(2.5rem,min(10svh,calc((min(100vw,77.5rem)-4rem)/11.2)),5.5rem)] leading-[0.98] xl:max-w-[calc(100%-23rem)] xl:text-[clamp(2.5rem,min(10svh,calc((min(100vw,77.5rem)-27rem)/11.2)),5.5rem)]">
        {HEADLINE.map((line, i) => (
          // Each line rises out of its own mask (the padding keeps descenders inside it); the second follows the first.
          <span key={line} className="-mb-[0.1em] block overflow-hidden pb-[0.18em]">
            <motion.span
              className="-mb-[0.1em] block pb-[0.1em] text-balance bg-gradient-to-b from-[#ffffff] via-[#f4f1ed] to-[#a9a29b] bg-clip-text text-transparent"
              initial={{ y: '105%' }}
              animate={{ y: 0 }}
              transition={{ duration: 0.65, delay: at(i * 0.11), ease: EASE }}>
              {line}
            </motion.span>
          </span>
        ))}
      </h1>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: at(0.2), ease: EASE }} className="relative mt-8 max-w-[52ch]">
        <p className="text-[1.0625rem] leading-relaxed text-pretty text-ink-2 sm:text-[1.1875rem]">
          ElevenAgent runs the whole customer call and remembers every detail. ElevenRoute picks the AI model for each turn, and switches provider the moment one fails.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <CtaLink to="/agent" aria-describedby="caller-line" {...caller.handlers}>Play a live call</CtaLink>
          <CtaLink href="#live" variant="secondary">Watch it route</CtaLink>
        </div>
        <CallerRow k={k} speaking={caller.speaking} pulse={caller.pulse} />
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: at(0.27), ease: EASE }} className="relative mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-[0.875rem] text-ink-2">
        <span className="text-ink-3">Every turn, across</span>
        {VENDOR_ORDER.map((v) => (
          <span key={v} className="inline-flex items-center gap-2">
            <Orb model={{ vendor: v, tier: 'flagship' }} size={Math.round(20 * k)} live />
            {VENDOR_NAMES[v]}
          </span>
        ))}
      </motion.div>
    </section>
  );
}

// ---------- the live demo: one stage at a time ----------
type Tab = 'route' | 'call';
const TABS: { id: Tab; label: string; icon: LucideIcon; caption: string }[] = [
  { id: 'route', label: 'Route a message', icon: Split, caption: 'Sample customer messages go through the real router. Simple ones go to a fast model, hard ones to a strong one.' },
  { id: 'call', label: 'Handle a whole call', icon: MessagesSquare, caption: 'ElevenAgent works through a real call: it remembers, acts, and lets the router pick the model for every turn.' },
];

function Live({ canFetch, sample, k }: { canFetch: boolean; sample: boolean; k: number }) {
  const [tab, setTab] = useState<Tab>('route');
  const current = TABS.find((t) => t.id === tab)!;
  // The active tab's pill slides on the compositor (useIndicator).
  const [tabList, tabPill] = useIndicator<HTMLDivElement>('[aria-selected="true"]', [tab]);
  return (
    <section id="live" aria-label="See it live" className="mx-auto mt-24 max-w-[77.5rem] scroll-mt-20 px-4 sm:px-8 lg:mt-32">
      <Reveal as="div" className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <SectionTitle eyebrow="Live on this page">Watch it decide, turn by turn.</SectionTitle>
        <div ref={tabList} role="tablist" aria-label="What to watch" className="relative inline-flex w-fit gap-1 rounded-full bg-card p-1 ring-1 ring-line">
          <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-full bg-ink" style={tabPill} />
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              // One line each on a phone: tighter padding, and the icons only from sm up.
              <button key={t.id} type="button" role="tab" aria-selected={on} aria-controls="live-panel" onClick={() => setTab(t.id)} className="press relative inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[0.8125rem] font-medium whitespace-nowrap sm:px-4 sm:text-[0.875rem]">
                <span className={`relative z-[1] inline-flex items-center gap-2 transition-colors duration-200 ${on ? 'text-canvas' : 'text-ink-2 hover:text-ink'}`}>
                  <t.icon size="1rem" aria-hidden="true" className="hidden sm:block" />
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </Reveal>
      {/* Two dense stages of different heights would fight if they crossfaded, so the old one leaves first; its exit
          is a quick fade (150 ms), and the caption swaps in step with it. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={`c-${tab}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease: EASE }} className="mt-5 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">
          {current.caption}
        </motion.p>
      </AnimatePresence>
      {/* Only the visible stage runs, so the page never animates or fetches for a demo nobody is looking at. */}
      <div id="live-panel" role="tabpanel" className="mt-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.3, ease: EASE }}>
            {tab === 'route' ? <Stage canFetch={canFetch} sample={sample} /> : <AgentStage canFetch={canFetch} k={k} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

// ---------- why it pays: three reasons, each leading to the page with the detail ----------
function Why({ canFetch }: { canFetch: boolean }) {
  const providers = useApi<ModelInfo[]>(canFetch ? '/providers' : null);
  // Price gap from the live catalogue, never a made-up figure.
  const ratio = useMemo(() => {
    const prices = (providers.data ?? []).filter((m) => m.enabled).map(blended).filter((p) => p > 0);
    return prices.length > 1 ? Math.max(...prices) / Math.min(...prices) : null;
  }, [providers.data]);
  const reasons: { icon: LucideIcon; title: string; body: ReactNode; to: string; cta: string }[] = [
    {
      icon: Wallet,
      title: '“Thanks” doesn’t need a flagship model.',
      body: (
        <>
          Simple turns go to a fast, low-cost model that clears your quality bar. Hard ones get the strongest.
          {ratio ? <> In our sample price list the priciest model costs <strong className="font-medium text-ink">{Math.round(ratio)}×</strong> the cheapest.</> : null}
        </>
      ),
      to: '/overview',
      cta: 'See the savings',
    },
    {
      icon: ServerCrash,
      title: 'An outage becomes a non-event.',
      body: 'When a provider errors or slows down, the same turn is answered by another vendor, and the conversation carries on.',
      to: '/playground',
      cta: 'Try an outage',
    },
    {
      icon: Bot,
      title: 'Nothing is asked twice.',
      body: 'ElevenAgent keeps the state of the call, so the model can change between turns and the customer never repeats themselves.',
      to: '/agent',
      cta: 'Play a call',
    },
  ];
  return (
    <Reveal id="why" className="mx-auto mt-28 max-w-[77.5rem] px-4 sm:px-8 lg:mt-36">
      <SectionTitle eyebrow="Why it pays">Most customer messages don’t need your most expensive model.</SectionTitle>
      <ul className="reveal-cascade mt-12 grid gap-10 md:grid-cols-3">
        {reasons.map((r, i) => (
          <li key={r.title} className="flex flex-col border-t border-ink/15 pt-6">
            <r.icon size="1.25rem" className="icon-pop text-ember" style={{ animationDelay: `${280 + i * 100}ms` }} aria-hidden="true" />
            <h3 className="mt-4 text-[1.1875rem] font-medium tracking-[-0.01em] text-balance text-ink">{r.title}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-pretty text-ink-2">{r.body}</p>
            <Link to={r.to} className="group mt-4 inline-flex w-fit items-center gap-1.5 rounded-full text-[0.875rem] font-medium text-ink transition-opacity active:opacity-60">
              {r.cta}
              <ArrowUpRight size="1rem" aria-hidden="true" className="text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
            </Link>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

/** Real numbers from this demo's logged (simulated) traffic, labelled as such. Hidden until there is traffic. */
function Proof({ canFetch }: { canFetch: boolean }) {
  const savings = useApi<Savings>(canFetch ? '/stats/savings?days=14' : null);
  const overview = useApi<Overview>(canFetch ? '/stats/overview?days=14' : null);
  const s = savings.data;
  const o = overview.data;
  if (!s || !o || s.turns === 0) return null;

  const rescued = Math.max(0, o.failovers - (s.unansweredTurns ?? 0));
  const cheaper = s.savings >= 0;

  return (
    <Reveal id="proof" className="mx-auto mt-28 max-w-[77.5rem] px-4 sm:px-8 lg:mt-36">
      <SectionTitle eyebrow="Sample results">What routing changed on sample traffic.</SectionTitle>
      <div className="reveal-cascade mt-12 grid gap-px overflow-hidden rounded-[1.5rem] border border-line bg-line sm:grid-cols-3">
        <Figure value={Math.abs(s.savingsPct)} format={pct1} label={cheaper ? 'lower model spend than sending every turn to the best allowed model' : 'extra cost against the best-model baseline'} tone={cheaper ? 'ok' : 'warn'} />
        <Figure value={s.turns} format={count} label={s.turns === 1 ? 'turn routed in the last 14 days' : 'turns routed in the last 14 days'} />
        <Figure value={rescued} format={count} label={rescued === 1 ? 'turn answered by another provider after a failure' : 'turns answered by another provider after a failure'} />
      </div>
      <p className="fine mt-4 text-[0.7813rem] leading-relaxed text-ink-3">
        Sample data: logged traffic from simulated providers at illustrative prices. Your own traffic and prices give your own numbers.
      </p>
    </Reveal>
  );
}

const pct1 = (n: number) => `${n.toFixed(1)}%`;

function Figure({ value, format, label, tone }: { value: number; format: (n: number) => string; label: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="bg-canvas p-6 sm:p-8">
      <AnimatedNumber startOnView value={value} format={format} className={`h-display block text-[2.75rem] leading-none sm:text-[3.25rem] ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-ember' : ''}`} />
      <p className="mt-3 text-[0.875rem] leading-snug text-ink-2">{label}</p>
    </div>
  );
}

// ---------- the live stage ----------
type Pt = { x: number; y: number };
/**
 * Where the connections run, measured from the stage. Wide screens read left to right: message → router → models,
 * joined by curves. Narrow screens stack them, so a rail runs down from the message through the router, and a short
 * branch turns off it into each model.
 */
type Geo =
  | { kind: 'wide'; w: number; h: number; inP: Pt; hubL: Pt; hubR: Pt; models: Record<string, Pt> }
  | { kind: 'rail'; w: number; h: number; x: number; inY: number; hubTop: number; hubBottom: number; models: Record<string, Pt> };

const curve = (a: Pt, b: Pt) => {
  const dx = (b.x - a.x) * 0.5;
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
};
/** How the rail bends into a branch. */
const BEND = 12;
const branch = (x: number, from: number, to: Pt) => `M${x},${from} L${x},${to.y - BEND} Q${x},${to.y} ${x + BEND},${to.y} L${to.x},${to.y}`;

/** The message's way into the router. */
const inPath = (g: Geo) => (g.kind === 'wide' ? curve(g.inP, g.hubL) : `M${g.x},${g.inY} L${g.x},${g.hubTop}`);
/** The way out to one model (the dot's path, then the light's). */
const outPath = (g: Geo, id: string | undefined) => {
  const m = id ? g.models[id] : undefined;
  if (!m) return null;
  return g.kind === 'wide' ? curve(g.hubR, m) : branch(g.x, g.hubBottom, m);
};
/** The faint lines to every model: a fan of curves, or one rail with a branch per model. */
function fanPaths(g: Geo, ids: string[]): { key: string; d: string }[] {
  const at = ids.filter((id) => g.models[id]);
  if (g.kind === 'wide') return at.map((id) => ({ key: id, d: curve(g.hubR, g.models[id]) }));
  if (!at.length) return [];
  const last = Math.max(...at.map((id) => g.models[id].y));
  return [
    { key: 'rail', d: `M${g.x},${g.hubBottom} L${g.x},${last - BEND}` },
    ...at.map((id) => {
      const m = g.models[id];
      return { key: id, d: `M${g.x},${m.y - BEND} Q${g.x},${m.y} ${g.x + BEND},${m.y} L${m.x},${m.y}` };
    }),
  ];
}

/** Alternate simple and complex turns so the loop shows both routes. */
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

function Stage({ canFetch, sample }: { canFetch: boolean; sample: boolean }) {
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

  // Geometry for the connections, measured relative to the stage (a fan on wide screens, a rail on narrow ones).
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dotRef = useRef<SVGGElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const measure = useCallback(() => {
    const st = stageRef.current;
    if (!st) return setGeo(null);
    const b = st.getBoundingClientRect();
    const at = (el: Element | null, side: 'l' | 'r'): Pt | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (side === 'l' ? r.left : r.right) - b.left, y: r.top + r.height / 2 - b.top };
    };
    const hub = st.querySelector('[data-anchor="hub"]');
    const ms: Record<string, Pt> = {};
    st.querySelectorAll<HTMLElement>('[data-anchor-model]').forEach((el) => {
      const p = at(el, 'l')!;
      ms[el.dataset.anchorModel!] = wide ? p : { x: p.x - 3, y: p.y };
    });
    if (!wide) {
      // The rail runs down through the router's centre, from under the incoming message to the last model.
      const box = st.querySelector('[data-anchor="in-box"]')?.getBoundingClientRect();
      const h = hub?.getBoundingClientRect();
      if (!box || !h) return setGeo(null);
      // It starts behind the message card (cards paint over the lines), so the dot drops out from under it.
      return setGeo({ kind: 'rail', w: b.width, h: b.height, x: h.left + h.width / 2 - b.left, inY: (box.top + box.bottom) / 2 - b.top, hubTop: h.top - b.top - 6, hubBottom: h.bottom - b.top + 6, models: ms });
    }
    const inP = at(st.querySelector('[data-anchor="in"]'), 'r');
    const hubL = at(hub, 'l');
    const hubR = at(hub, 'r');
    if (!inP || !hubL || !hubR) return setGeo(null);
    setGeo({ kind: 'wide', w: b.width, h: b.height, inP: { x: inP.x + 6, y: inP.y }, hubL: { x: hubL.x - 6, y: hubL.y }, hubR: { x: hubR.x + 6, y: hubR.y }, models: ms });
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
  const outD = geo ? outPath(geo, chosenId) : null;

  return (
    <div ref={screenRef} className="relative rounded-[1.75rem] bg-card p-4 ring-1 ring-line sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {playing && !reduce ? <span className="absolute inset-0 animate-ping rounded-full bg-ember/60" /> : null}
            <span className="relative h-2 w-2 rounded-full bg-ember" />
          </span>
          <span><strong className="font-medium text-ink">Real router decisions</strong> · sample messages</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={!playing}
            className="press inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 text-[0.8125rem] font-medium text-ink transition-colors hover:border-ink/20">
            {playing ? <Pause size="0.875rem" aria-hidden="true" /> : <Play size="0.875rem" aria-hidden="true" />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!ready}
            className="press inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 text-[0.8125rem] font-medium text-ink transition-colors hover:border-ink/20 disabled:opacity-50">
            <SkipForward size="0.875rem" aria-hidden="true" />
            Next
          </button>
        </div>
      </div>

      <div ref={stageRef} className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-20">
        {geo ? (
          <svg ref={svgRef} width={geo.w} height={geo.h} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
            {fanPaths(geo, models.map((m) => m.id)).map((p) => <path key={p.key} data-fan d={p.d} fill="none" style={{ stroke: 'color-mix(in srgb, var(--color-ink) 20%, transparent)' }} strokeWidth={1.25} />)}
            <AnimatePresence>
              <motion.path key={`in${step}`} data-in={step} d={inPath(geo)} fill="none" style={{ stroke: 'var(--color-ink)' }} strokeOpacity={0.35} strokeWidth={1.5} strokeLinecap="round" exit={{ opacity: 0, transition: { duration: 0.3 } }} />
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
          <div data-anchor="in-box" className="relative h-[5.75rem] overflow-hidden lg:h-[18.75rem]">
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
                    <span>{USE_CASES.find((u) => u.value === tc.useCase)?.label ?? tc.useCase}</span>
                  </div>
                  <p className="line-clamp-2 text-[0.875rem] leading-snug text-ink [overflow-wrap:anywhere]">{tc.message}</p>
                </motion.div>
              ))}
            </AnimatePresence>
            {!n ? <div className="skeleton h-[5.25rem]" /> : null}
          </div>
        </div>

        {/* The router */}
        <div className="flex items-center gap-5 lg:flex-col lg:gap-4">
          <div data-anchor="hub" className="relative shrink-0" style={{ width: hub, height: hub }}>
            <div data-hub-pulse className="h-full w-full">
              <BrandOrb size={hub} live ping drift={false} />
            </div>
          </div>
          <div className="min-h-[4.75rem] lg:w-[12.5rem] lg:text-center" aria-live="polite">
            <div className="text-[0.8125rem] font-medium text-ink">ElevenRoute</div>
            <AnimatePresence mode="wait" initial={false}>
              {decision ? (
                <motion.div key={shown} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }} className="mt-2">
                  <TurnBadge turnType={decision.turn_type} />
                  <p className="mt-2 line-clamp-2 text-[0.7813rem] leading-snug text-ink-2">{decision.route_reason}</p>
                </motion.div>
              ) : (
                <p className="mt-2 text-[0.7813rem] text-ink-3">Reading the first message…</p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Models. On narrow screens they sit to the right of the rail, which branches into each one. */}
        <div className="pl-16 lg:pl-0">
          <div className="label mb-3">Models</div>
          <ul className="flex flex-col gap-1.5">
            {models.map((m) => {
              const on = m.id === pickedId;
              return (
                <li
                  key={m.id}
                  data-anchor-model={m.id}
                  // Only the background fades; the shadow and ring (box-shadows) switch at once.
                  className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-[background-color] duration-300 ${on ? 'bg-canvas shadow-[var(--shadow-card)] ring-1 ring-ink/10' : 'ring-1 ring-transparent'}`}>
                  <Orb model={m} size={Math.round(24 * k)} live />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[0.875rem] font-medium transition-colors ${on ? 'text-ink' : 'text-ink-2'}`}>{m.name}</span>
                    <span className="block text-[0.75rem] text-ink-3">{VENDOR_SHORT[m.vendor]} · {m.tier === 'flagship' ? 'Flagship' : 'Fast'}</span>
                  </span>
                  <AnimatePresence>
                    {on ? (
                      <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15, ease: EASE } }} transition={{ duration: 0.25, ease: EASE }} className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[0.7188rem] font-medium text-canvas">
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

      {sample ? <p className="mt-6 text-[0.75rem] text-ink-3">Sample data: quality scores, prices and latencies are illustrative settings, not live measurements.</p> : null}
    </div>
  );
}
