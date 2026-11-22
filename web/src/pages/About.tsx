import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type RefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';

import { BrandOrb } from '../components/Orb';
import { Glow, Reveal, SitePage, useDarkPage, useScale } from '../components/Site';
import { base, fast } from '../lib/motion';

// About Us: who made ElevenRoute. The logo sits at the centre of the team; when the diagram first comes into view one
// soft ripple leaves it and draws a thin line out to each person. Names and roles show at once; hovering, tapping or
// focusing a name reveals what that person did. With reduced motion the lines are simply there.

type Person = { id: string; name: string; role: string; did: string };

/** The team, in the owner's words (supplied for this page). */
const TEAM: Person[] = [
  {
    id: 'faisal',
    name: 'Faisal',
    role: 'ElevenRoute creator & website developer',
    did: 'I came up with the idea for ElevenRoute and built the website, including the dashboard where you can try the routing for yourself.',
  },
  {
    id: 'arianna',
    name: 'Arianna',
    role: 'ElevenAgent concept designer',
    did: 'I came up with the idea for ElevenAgent and shaped how the agent responds as a conversation unfolds.',
  },
  {
    id: 'jennifer',
    name: 'Jennifer',
    role: 'AI tools researcher',
    did: 'I compared AI tools and looked at where each one was most useful, so we could decide which tool suited each part of the work.',
  },
];

/**
 * Who and what made the website, limited to what the project itself confirms: the commits are co-authored by Claude,
 * the animation guides are installed from emilkowalski/skills (skills-lock.json), and the homepage film's music is
 * the owner's own (CLAUDE.md, "Ad film"). The presentation film is left out until its voices are final.
 */
const CREDITS = [
  {
    name: 'Claude Code',
    kind: 'AI coding assistant, by Anthropic',
    did: 'Wrote the code for this site from our direction: the landing page, the dashboard, the routing and agent demos, the animations and the film on the homepage.',
  },
  {
    name: 'Emil Kowalski’s design skills',
    kind: 'Open animation guides',
    did: 'Shaped how things move: the timing and easing of the animations, and how they calm down for visitors who prefer reduced motion.',
  },
  {
    name: 'Our own showcase video',
    kind: 'Soundtrack',
    did: 'The music under the homepage film comes from a video we made ourselves.',
  },
];

export default function About() {
  useDarkPage('About Us · ElevenRoute');
  return (
    <SitePage>
      <main id="main" className="relative mx-auto max-w-[77.5rem] px-4 sm:px-8">
        <Glow className="-top-40 right-[-10rem] h-[34rem] w-[34rem]" period={24} />
        <Reveal as="div" className="relative pt-[clamp(2rem,6svh,5rem)] md:text-center">
          <p className="text-[0.8125rem] font-medium tracking-[0.06em] text-ink-3 uppercase">About Us</p>
          <h1 className="h-display mt-4 pb-[0.08em] text-[clamp(2.5rem,6vw,4.5rem)] leading-[1] tracking-[-0.035em] text-balance bg-gradient-to-b from-[#ffffff] via-[#f4f1ed] to-[#a9a29b] bg-clip-text text-transparent">
            How we built ElevenRoute
          </h1>
          <p className="mt-6 max-w-[40rem] text-[1.0625rem] leading-relaxed text-pretty text-ink-2 sm:text-[1.1875rem] md:mx-auto">
            We’re a small team of students. ElevenRoute started with a question: does an AI agent need the same model to handle “Yes, 3 pm works” as it does to sort out a disputed refund? We built ElevenRoute to choose a model that fits the message.
          </p>
        </Reveal>

        <Team />

        <Reveal className="mx-auto mt-20 max-w-[46rem] md:mt-14">
          <div className="md:text-center">
            <p className="text-[0.8125rem] font-medium tracking-[0.06em] text-ink-3 uppercase">Credits</p>
            <h2 className="h-display mt-3 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.1] tracking-[-0.025em] text-balance">How the website was made</h2>
          </div>
          <dl className="reveal-cascade mt-8">
            {CREDITS.map((c) => (
              <div key={c.name} className="grid gap-1.5 border-t border-ink/15 py-5 last:border-b md:grid-cols-[14rem_minmax(0,1fr)] md:gap-8">
                <dt>
                  <span className="block text-[1.0625rem] font-medium tracking-[-0.01em] text-ink">{c.name}</span>
                  <span className="mt-0.5 block text-[0.8125rem] text-ink-3">{c.kind}</span>
                </dt>
                <dd className="text-[0.9375rem] leading-relaxed text-pretty text-ink-2">{c.did}</dd>
              </div>
            ))}
          </dl>
        </Reveal>

        <div className="mt-14 max-w-[40rem] md:mx-auto md:text-center">
          <p className="text-[0.9375rem] leading-relaxed text-pretty text-ink-3 italic">
            AI tools helped us along the way. The three of us made the product decisions and approved the final content.
          </p>
          {/* One way on: the call the intro's question is about. /agent opens on the refund call. */}
          <Link to="/agent" className="group mt-5 inline-flex items-center gap-1.5 rounded-full text-[0.9375rem] font-medium text-ink transition-opacity active:opacity-60">
            Play the refund call
            <ArrowUpRight size="1rem" aria-hidden="true" className="text-ink-3 transition-[translate,color] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
          </Link>
        </div>
      </main>
    </SitePage>
  );
}

// ---------- the team ----------
/** Which contributions show: hovered or keyboard-focused (one each), plus any a tap or click has pinned open. */
function useReveal() {
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  // Each time a contribution opens, a light runs down that person's line once.
  const [signal, setSignal] = useState<Record<string, number>>({});
  const isOpen = (id: string, withHover = true) => (withHover && hover === id) || focus === id || pinned.includes(id);
  const opened = (id: string) => {
    if (!isOpen(id)) setSignal((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }));
  };
  return {
    isOpen,
    signal,
    hoverOn: (id: string) => (e: ReactPointerEvent) => {
      if (e.pointerType !== 'mouse') return; // touch opens by tapping the name
      opened(id);
      setHover(id);
    },
    hoverOff: () => setHover(null),
    // Keyboard focus only: a pointer press focuses the button too, and its click already toggles.
    focusOn: (id: string) => (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.matches(':focus-visible')) return;
      opened(id);
      setFocus(id);
    },
    focusOff: () => setFocus(null),
    toggle: (id: string) => {
      if (pinned.includes(id)) return setPinned((p) => p.filter((x) => x !== id));
      opened(id);
      setPinned((p) => [...p, id]);
    },
  };
}
type RevealState = ReturnType<typeof useReveal>;

/** True from the first time the element is mostly on screen: the diagram draws itself then, not while out of sight. */
function useFirstSight<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setSeen(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Team() {
  const reveal = useReveal();
  const [ref, seen] = useFirstSight<HTMLElement>();
  return (
    // `data-play` starts the drawing (CSS: "About Us" in index.css). Two layouts, one shown: the triangle from md up,
    // a stacked list on phones.
    <section ref={ref} aria-labelledby="team-title" data-play={seen ? '' : undefined} className="team relative mt-12 md:mt-14">
      <h2 id="team-title" className="sr-only">The team</h2>
      <Triangle reveal={reveal} />
      <Stack reveal={reveal} />
    </section>
  );
}

// The triangle, in viewBox units: the logo at the centre of an equilateral triangle, so the ripple reaches all three
// people at the same moment. The stage keeps the viewBox's aspect ratio, so HTML placed in percentages lines up.
const VW = 1000;
const VH = 640;
const CENTRE = { x: 500, y: 300 };
const RADIUS = 235;
/** The logo's diameter as a share of the stage width. */
const LOGO = 0.14;
const LOGO_R = (LOGO * VW) / 2;
const POINTS = [-90, 150, 30].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: CENTRE.x + RADIUS * Math.cos(a), y: CENTRE.y + RADIUS * Math.sin(a), dx: Math.cos(a), dy: Math.sin(a) };
});
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function Triangle({ reveal }: { reveal: RevealState }) {
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => Math.max(320, Math.min(window.innerWidth - 64, 896)));
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // On phones this layout is hidden (width 0): keep the last real size rather than drawing a zero-sized logo.
    const ro = new ResizeObserver(([e]) => e.contentRect.width > 0 && setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const logo = Math.round(width * LOGO);

  return (
    <div className="hidden pb-12 md:block">
      <div ref={stage} className="relative mx-auto w-full max-w-[56rem]" style={{ aspectRatio: `${VW} / ${VH}` }}>
        {/* A soft light behind the logo. */}
        <div aria-hidden="true" className="pointer-events-none absolute rounded-full" style={{ left: pct(CENTRE.x, VW), top: pct(CENTRE.y, VH), width: logo * 2.6, height: logo * 2.6, translate: '-50% -50%', background: 'radial-gradient(closest-side, rgb(122 92 255 / 0.22), rgb(63 193 180 / 0.07) 60%, transparent)' }} />

        <svg viewBox={`0 0 ${VW} ${VH}`} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {POINTS.map((p, i) => {
            const open = reveal.isOpen(TEAM[i].id);
            // From the logo's edge to the person, so the line's tip and the ripple travel out together.
            const d = `M${CENTRE.x + p.dx * LOGO_R},${CENTRE.y + p.dy * LOGO_R} L${p.x},${p.y}`;
            return (
              <g key={i}>
                <path d={d} pathLength={1} className="team-line transition-[stroke] duration-300" fill="none" strokeWidth={1.25} strokeLinecap="round" style={{ stroke: `color-mix(in srgb, var(--color-ink) ${open ? 60 : 24}%, transparent)` }} />
                {!reduce && reveal.signal[TEAM[i].id] ? <path key={reveal.signal[TEAM[i].id]} d={d} pathLength={1} className="team-signal" fill="none" strokeWidth={2} strokeLinecap="round" style={{ stroke: 'var(--color-ink)' }} /> : null}
              </g>
            );
          })}
        </svg>

        {/* The logo and the one ripple that leaves it. */}
        <div className="absolute" style={{ left: pct(CENTRE.x, VW), top: pct(CENTRE.y, VH), width: logo, height: logo, translate: '-50% -50%' }}>
          <span aria-hidden="true" className="voice-ring team-ripple pointer-events-none absolute inset-0 rounded-full" style={{ '--ripple-to': RADIUS / LOGO_R } as CSSProperties} />
          <BrandOrb size={logo} live beat outline />
        </div>

        {POINTS.map((p, i) => <Point key={i} left={pct(p.x, VW)} top={pct(p.y, VH)} open={reveal.isOpen(TEAM[i].id)} />)}

        <ul>
          {TEAM.map((person, i) => {
            const p = POINTS[i];
            // The top person reads from beside their point (the line runs below it); the other two from below theirs.
            const place: CSSProperties =
              i === 0
                ? { left: `calc(${pct(p.x, VW)} + 1.5rem)`, top: `calc(${pct(p.y, VH)} - 0.95rem)` }
                : { left: pct(p.x, VW), top: `calc(${pct(p.y, VH)} + 1.4rem)`, translate: '-50% 0' };
            return (
              <li key={person.id} className={`absolute ${i === 0 ? 'w-[20rem] text-left' : 'w-[16rem] text-center'}`} style={place} onPointerEnter={reveal.hoverOn(person.id)} onPointerLeave={reveal.hoverOff}>
                <Profile person={person} reveal={reveal} layout="triangle" />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** A person's point at the end of their line. It lands as the ripple arrives, and grows while their part is open. */
function Point({ left, top, open, style }: { left?: string; top?: string; open: boolean; style?: CSSProperties }) {
  return (
    <span aria-hidden="true" className="team-point pointer-events-none absolute h-3 w-3" style={{ left, top, translate: '-50% -50%', ...style }}>
      <span className="team-ping absolute inset-0 rounded-full border border-ink opacity-0" />
      <span className={`absolute -inset-1.5 rounded-full bg-ink/15 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`} />
      <span className={`absolute inset-0 rounded-full bg-ink transition-[scale] duration-300 ease-[var(--ease-spring)] ${open ? 'scale-[1.3]' : ''}`} />
    </span>
  );
}

/** Phones: the logo on top and the three people stacked beneath it on one line, each name a button. */
function Stack({ reveal }: { reveal: RevealState }) {
  const k = useScale();
  return (
    <div className="md:hidden">
      <div className="relative h-[4.5rem] w-[4.5rem]">
        <span aria-hidden="true" className="voice-ring team-ripple pointer-events-none absolute inset-0 rounded-full" style={{ '--ripple-to': 2.6 } as CSSProperties} />
        <BrandOrb size={Math.round(72 * k)} live beat outline />
      </div>
      <ul>
        {TEAM.map((person, i) => {
          const last = i === TEAM.length - 1;
          // The line grows down from the logo one person at a time; each point lands as it arrives.
          const d = 320 + i * 360;
          return (
            <li key={person.id} className="relative pt-7 pl-[4.25rem]">
              <span aria-hidden="true" className="team-spine absolute left-[2.25rem] top-0 w-px bg-ink/25" style={{ height: last ? '2.6rem' : '100%', translate: '-50% 0', '--d': `${d}ms` } as CSSProperties} />
              <Point left="2.25rem" top="2.6rem" open={reveal.isOpen(person.id, false)} style={{ '--d': `${d + 300}ms` } as CSSProperties} />
              <Profile person={person} reveal={reveal} layout="stack" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A name, a role and, once revealed, the person's own words. In the triangle the words fade into space kept for
 * them, so nothing moves; in the stack they open below the name (hover would make a growing list jump, so phones
 * and narrow windows reveal by tap or keyboard).
 */
function Profile({ person, reveal, layout }: { person: Person; reveal: RevealState; layout: 'triangle' | 'stack' }) {
  const stack = layout === 'stack';
  const open = reveal.isOpen(person.id, !stack);
  const id = `did-${person.id}-${layout}`;
  const words = <p className="text-[0.9375rem] leading-relaxed text-pretty text-ink">“{person.did}”</p>;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => reveal.toggle(person.id)}
        onFocus={reveal.focusOn(person.id)}
        onBlur={reveal.focusOff}
        className={`press group inline-flex items-center gap-1.5 rounded-full text-[1.25rem] font-medium tracking-[-0.01em] text-ink`}>
        {person.name}
        <ChevronDown size="1rem" aria-hidden="true" className={`text-ink-3 transition-[rotate,color] duration-200 group-hover:text-ink ${open ? 'rotate-180 text-ink' : ''}`} />
      </button>
      <p className="mt-0.5 text-[0.875rem] leading-snug text-ink-2">{person.role}</p>
      {stack ? (
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div id={id} key="did" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0, transition: fast }} transition={base} className="overflow-hidden">
              <div className="pt-2.5">{words}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : (
        <div id={id} aria-hidden={!open} className={`mt-3 transition-[opacity,translate] duration-300 ease-out ${open ? 'opacity-100' : 'translate-y-1 opacity-0'}`}>
          {words}
        </div>
      )}
    </>
  );
}
