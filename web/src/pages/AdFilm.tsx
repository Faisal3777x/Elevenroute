import { useEffect, useId, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

import { Orb } from '../components/Orb';

/**
 * ElevenRoute's ad film (route /ad): a 72-second, 1920×1080 spot cut to its soundtrack, the music from the owner's
 * ElevenRoute showcase video, extended and fitted by scripts/ad-music.mjs.
 *
 * The film is written in story seconds on a 2-second bar (every time in this file). It plays one bar of the music per
 * story bar: the track runs at 110.02 BPM, so a bar lasts 2.1814 s and the film plays 9% slower than written, with
 * every scene starting on a bar line. Story time → film time is storyAt()/realAt() below. The scenes, in story seconds:
 *
 *   0–4    hook: every customer message goes to the most expensive AI (the first line over the opening swell, the
 *          drums arrive with the second)
 *   4–10   the CFO's message and the spend chart; "on it."
 *   10–12  build: "So Lina tried something smarter."
 *   12–20  drop as the claps come in: the orb, the wordmark, the line
 *   20–24  every turn routed live
 *   24–30  before and after: the flagship on every turn vs. ElevenRoute
 *   30–36  a provider fails; the same turn is answered by another (the music stutters, goes muffled, opens up again)
 *   36–46  ElevenAgent runs a whole call
 *   46–52  four features
 *   52–56  same quality bar, less spend
 *   56–60  the CFO's reply, given an extra bar while the riser builds
 *   60–64  end card on the final hit, held over the decay
 *
 * Everything on screen is a pure function of the time `t`, so the film renders the same way every time: /ad plays it
 * live (scaled to the window, looping, without sound); /ad?render exposes window.__adSetTime(seconds) so a recorder
 * can capture it frame by frame (README, "Ad film"). The cost bars use the ratio from the demo's sample traffic and
 * say so; the connectors are labelled as samples; nothing else claims a figure.
 */
/** Length of the film (and of the soundtrack edit, LENGTH in scripts/ad-music.mjs). */
export const FILM_SECONDS = 71.8;
/** Length of the story the scenes are written in. */
const STORY_SECONDS = 64;
const W = 1920;
const H = 1080;

// ---------- story time ↔ film time (the music's bar grid) ----------
/** One beat and one bar of the soundtrack (110.02 BPM); beat k is at FIRST_BEAT + k × BEAT, the drums come in on beat 5. */
const BEAT = 0.54535;
const BAR = 4 * BEAT;
const FIRST_BEAT = 0.269;
/** Story 0 is one bar before the drums: the hook's first line plays over the opening swell. */
const STORY_ZERO = FIRST_BEAT + BEAT;
/** Film seconds per story second: one 2.1814 s music bar per 2 s story bar. */
const STRETCH = BAR / 2;
/** The CFO's reply (story 56–60) gets three bars instead of two, so the riser builds under it into the final hit. */
const PAYOFF = { from: 56, to: 60, bars: 3 };
const PAYOFF_REAL = STORY_ZERO + PAYOFF.from * STRETCH;
/** The music's final hit (story 60, the end card), then its decay to the end of the film. */
const HIT_REAL = PAYOFF_REAL + PAYOFF.bars * BAR;
/** Story seconds at film second T (negative before story 0: the swell). */
function storyAt(T: number) {
  if (T <= PAYOFF_REAL) return (T - STORY_ZERO) / STRETCH;
  if (T <= HIT_REAL) return PAYOFF.from + ((T - PAYOFF_REAL) / (HIT_REAL - PAYOFF_REAL)) * (PAYOFF.to - PAYOFF.from);
  return PAYOFF.to + ((T - HIT_REAL) / (FILM_SECONDS - HIT_REAL)) * (STORY_SECONDS - PAYOFF.to);
}
/** Film seconds at story second t. */
function realAt(t: number) {
  if (t <= PAYOFF.from) return STORY_ZERO + t * STRETCH;
  if (t <= PAYOFF.to) return PAYOFF_REAL + ((t - PAYOFF.from) / (PAYOFF.to - PAYOFF.from)) * (HIT_REAL - PAYOFF_REAL);
  return HIT_REAL + ((t - PAYOFF.to) / (STORY_SECONDS - PAYOFF.to)) * (FILM_SECONDS - HIT_REAL);
}

// ---------- time ----------
const clamp = (x: number) => Math.min(1, Math.max(0, x));
/** 0 → 1 between seconds a and b. */
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number) => x * x * x;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** Settles with a small overshoot, for pops. */
const backOut = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
const px = (n: number) => `${n.toFixed(1)}px`;
/** Rises in from `dy` px. */
function rise(t: number, at: number, dur = 0.5, dy = 26): CSSProperties {
  const p = easeOut(seg(t, at, at + dur));
  return { opacity: p, transform: `translateY(${px((1 - p) * dy)})` };
}
/** Slams in: from big, blurred and clear to settled, with a small overshoot. */
function slam(t: number, at: number, dur = 0.3, from = 1.8): CSSProperties {
  if (t < at) return { opacity: 0 };
  const p = seg(t, at, at + dur);
  return { opacity: easeOut(seg(t, at, at + 0.08)), transform: `scale(${lerp(from, 1, backOut(p)).toFixed(4)})`, filter: p < 1 ? `blur(${px((1 - easeOut(p)) * 14)})` : undefined };
}
/** A pop from nothing, for pills and buttons. */
const pop = (t: number, at: number, dur = 0.35) => (t < at ? 0 : backOut(seg(t, at, at + dur)));
/** Text typed out between a and b (by code point, so emoji stay whole). */
function typed(text: string, t: number, a: number, b: number) {
  const chars = [...text];
  return chars.slice(0, Math.round(chars.length * seg(t, a, b))).join('');
}
/** Deterministic noise in [0, 1), so shakes and glitches render the same every time. */
function noise(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
/** A seeded random stream (mulberry32), for particles. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
/** The film frame (30 fps) at story time t, so jitter changes on every frame whatever the stretch. */
const frameOf = (t: number) => Math.floor(realAt(t) * 30 + 1e-6);

// ---------- the soundtrack's kick drum ----------
/**
 * The kick, measured from the audio: on every beat from the drums' entry (beat 5) to the final hit (beat 125, a big
 * one), except the beat just before it, where the riser drops out.
 */
const KICKS = Array.from({ length: 121 }, (_, i) => i + 5)
  .filter((k) => k !== 124)
  .map((k) => ({ at: FIRST_BEAT + k * BEAT, s: k === 125 ? 1.6 : 1 }));
/** 1 on every kick drum (more on the big hits), falling away quickly in film time: for things that pulse with the music. */
function pulse(t: number, decay = 9) {
  const T = realAt(t);
  let last: { at: number; s: number } | null = null;
  for (const k of KICKS) {
    if (k.at > T + 1e-6) break;
    last = k;
  }
  return last ? last.s * Math.exp(-(T - last.at) * decay) : 0;
}
/** Camera shake after each hit: a decaying jitter of `amp` px. */
function shake(t: number, hits: number[], amp: number, dur = 0.3) {
  const f = frameOf(t);
  let x = 0;
  let y = 0;
  for (const at of hits) {
    const p = seg(t, at, at + dur);
    if (p <= 0 || p >= 1) continue;
    const k = amp * (1 - p) * (1 - p);
    x += (noise(f * 3.1 + at) * 2 - 1) * k;
    y += (noise(f * 5.3 + at * 2) * 2 - 1) * k;
  }
  return `translate(${px(x)}, ${px(y)})`;
}

// ---------- whip pans: the outgoing scene leaves, the incoming one arrives, both motion-blurred ----------
type Axis = 'x' | 'y';
const WHIP = 0.44;
const WHIPS: { at: number; axis: Axis }[] = [
  { at: 4, axis: 'x' },
  { at: 24, axis: 'x' },
  { at: 46, axis: 'x' },
  { at: 56, axis: 'y' },
];
function whip(t: number, at: number, role: 'in' | 'out', axis: Axis = 'x'): CSSProperties {
  const p = seg(t, at - WHIP / 2, at + WHIP / 2);
  if ((role === 'in' && p >= 1) || (role === 'out' && p <= 0)) return {};
  const e = easeInOut(p);
  const d = px(role === 'out' ? -(axis === 'x' ? W : H) * e : (axis === 'x' ? W : H) * (1 - e));
  return { transform: axis === 'x' ? `translateX(${d})` : `translateY(${d})`, filter: `url(#mb${axis})` };
}
const whipBlur = (t: number, axis: Axis) => Math.max(0, ...WHIPS.filter((w) => w.axis === axis).map((w) => Math.sin(Math.PI * seg(t, w.at - WHIP / 2, w.at + WHIP / 2)) * 80));

// ---------- glitches (the provider outage) ----------
const GLITCHES: [number, number][] = [
  [29.82, 30.7],
  [31.7, 32.02],
];
const inGlitch = (t: number) => GLITCHES.find(([a, b]) => t >= a && t < b);
function glitchShift(t: number) {
  if (!inGlitch(t)) return '';
  const f = frameOf(t);
  return `translate(${px((noise(f * 1.7) - 0.5) * 70)}, ${px((noise(f * 2.9) - 0.5) * 16)})`;
}

// ---------- palette (the landing page's dark theme) and data ----------
const C = {
  black: '#09090a',
  card: 'rgba(255,255,255,0.045)',
  line: 'rgba(255,255,255,0.1)',
  ink: '#f4f1ed',
  ink2: '#b9b3ad',
  ink3: '#8a847f',
  teal: '#3fc1b4',
  violet: '#7a5cff',
  orange: '#ff6a2b',
  ok: '#3fcf8e',
  bad: '#ff5d5d',
  simple: '#9fb4ff',
  complex: '#ff9b6b',
};
const LIGHT_BG = 'linear-gradient(135deg, #f3efe9, #ece6f6 55%, #f8e9e1)';

type ModelId = 'gpt5' | 'gpt5mini' | 'gpro' | 'gflash' | 'sonnet' | 'haiku';
type Kind = 'Simple' | 'Complex';
type Model = { name: string; vendor: 'openai' | 'google' | 'anthropic'; tier: 'flagship' | 'fast'; maker: string };
/** The demo's six models (api/src/seed.ts). */
const MODELS: Record<ModelId, Model> = {
  gpt5: { name: 'GPT-5', vendor: 'openai', tier: 'flagship', maker: 'OpenAI' },
  gpt5mini: { name: 'GPT-5 mini', vendor: 'openai', tier: 'fast', maker: 'OpenAI' },
  gpro: { name: 'Gemini 2.5 Pro', vendor: 'google', tier: 'flagship', maker: 'Google' },
  gflash: { name: 'Gemini 2.5 Flash', vendor: 'google', tier: 'fast', maker: 'Google' },
  sonnet: { name: 'Claude Sonnet 5.5', vendor: 'anthropic', tier: 'flagship', maker: 'Anthropic' },
  haiku: { name: 'Claude Haiku 5.5', vendor: 'anthropic', tier: 'fast', maker: 'Anthropic' },
};
/**
 * Routed cost ÷ the one-model baseline on the demo's own sample traffic (GET /stats/savings on 2026-11-17:
 * $0.643 vs $1.568 over 1,761 simulated turns). The film's cost bars use it, and say it is sample data.
 */
const SAMPLE_RATIO = 0.41;

type P = { x: number; y: number };
const ctrl = (a: P, b: P) => {
  const dx = (b.x - a.x) * 0.5;
  return [a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, b] as const;
};
const curve = (a: P, b: P) => {
  const [p0, p1, p2, p3] = ctrl(a, b);
  return `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
};
/** The point at u (0–1) along curve(a, b). */
const bez = (a: P, b: P, u: number): P => {
  const [p0, p1, p2, p3] = ctrl(a, b);
  const v = 1 - u;
  const k = (q0: number, q1: number, q2: number, q3: number) => v * v * v * q0 + 3 * v * v * u * q1 + 3 * v * u * u * q2 + u * u * u * q3;
  return { x: k(p0.x, p1.x, p2.x, p3.x), y: k(p0.y, p1.y, p2.y, p3.y) };
};

export default function AdFilm() {
  const render = new URLSearchParams(window.location.search).has('render');
  // T is film time (what the recorder sets and the music follows); the scenes are written in story time t.
  const [T, setT] = useState(0);
  const t = storyAt(T);

  // Live preview: play in real time and loop. Render mode: the recorder sets the time.
  useEffect(() => {
    document.title = 'ElevenRoute · ad film';
    if (render) {
      (window as unknown as { __adSetTime: (s: number) => void }).__adSetTime = (s: number) => flushSync(() => setT(s));
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setT(((now - t0) / 1000) % FILM_SECONDS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [render]);

  // Scale the 1920×1080 stage to fit the window in preview.
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (render) return;
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [render]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: W, height: H, flexShrink: 0, transform: render ? undefined : `scale(${scale})`, transformOrigin: 'center', position: 'relative', overflow: 'hidden', background: C.black, color: C.ink, fontFamily: '"Inter Variable", system-ui, sans-serif' }}>
        <MotionBlur t={t} />
        <Hook t={t} />
        <Problem t={t} />
        <Build t={t} />
        <Drop t={t} />
        <Feed t={t} />
        <Split t={t} />
        <Failover t={t} />
        <AgentCall t={t} />
        <Features t={t} />
        <Savings t={t} />
        <Payoff t={t} />
        <EndCard t={t} />
        <GlitchOverlay t={t} />
        <Flash t={t} />
        <SampleNote t={t} />
        <Vignette />
        <Grain />
      </div>
    </div>
  );
}

// ---------- shared pieces ----------
function Scene({ t, from, to, fadeIn = 0, fadeOut = 0, style, children }: { t: number; from: number; to: number; fadeIn?: number; fadeOut?: number; style?: CSSProperties; children: ReactNode }) {
  if (t < from || t >= to) return null;
  const o = Math.min(fadeIn ? easeOut(seg(t, from, from + fadeIn)) : 1, fadeOut ? 1 - easeInOut(seg(t, to - fadeOut, to)) : 1);
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: o, ...style }}>{children}</div>;
}

/** The whip pans' motion blur: a horizontal and a vertical Gaussian, as strong as the pan is fast. */
function MotionBlur({ t }: { t: number }) {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id="mbx" x="-15%" y="0" width="130%" height="100%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${whipBlur(t, 'x').toFixed(1)} 0`} edgeMode="duplicate" />
        </filter>
        <filter id="mby" x="0" y="-15%" width="100%" height="130%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`0 ${whipBlur(t, 'y').toFixed(1)}`} edgeMode="duplicate" />
        </filter>
      </defs>
    </svg>
  );
}

/** Soft brand light: teal, violet and orange glows drifting slowly. */
function Glows({ t, intensity = 1 }: { t: number; intensity?: number }) {
  const g = (color: string, x: number, y: number, r: number, phase: number): CSSProperties => ({
    position: 'absolute',
    left: x + Math.sin(t * 0.35 + phase) * 70,
    top: y + Math.cos(t * 0.28 + phase) * 50,
    width: r,
    height: r,
    borderRadius: '50%',
    background: `radial-gradient(closest-side, ${color}, transparent)`,
    opacity: Math.min(0.62, 0.32 * intensity),
  });
  return (
    <>
      <div style={g(C.violet, 1180, -240, 920, 0)} />
      <div style={g(C.teal, -280, 520, 780, 2)} />
      <div style={g(C.orange, 900, 660, 640, 4)} />
    </>
  );
}

function LightGlows() {
  return (
    <>
      <div style={{ position: 'absolute', left: 1280, top: -200, width: 900, height: 900, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(122,92,255,0.25), transparent)' }} />
      <div style={{ position: 'absolute', left: -200, top: 600, width: 800, height: 800, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(255,106,43,0.18), transparent)' }} />
    </>
  );
}

/** Slowly turning light rays from a point. */
function Rays({ t, strength, cx = 960, cy = 540 }: { t: number; strength: number; cx?: number; cy?: number }) {
  if (strength <= 0) return null;
  const mask = 'radial-gradient(closest-side, transparent 6%, #000 22%, rgba(0,0,0,0.5) 48%, transparent 80%)';
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - 1400,
        top: cy - 1400,
        width: 2800,
        height: 2800,
        opacity: strength,
        background: `repeating-conic-gradient(from ${(t * 16).toFixed(2)}deg, rgba(255,255,255,0.1) 0deg 3deg, rgba(255,255,255,0) 3deg 15deg)`,
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    />
  );
}

/** Specks of light drifting upwards and twinkling. */
function Sparkles({ t, n = 36, seed = 1, speed = 26 }: { t: number; n?: number; seed?: number; speed?: number }) {
  const r = rng(seed);
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const x = r() * W;
        const y0 = r() * H;
        const s = 2 + r() * 3.5;
        const tw = r() * 6.28;
        const sp = speed * (0.5 + r());
        const y = (((y0 - sp * t) % H) + H) % H;
        return <span key={i} style={{ position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: '50%', background: '#fff', opacity: 0.12 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.2 + tw)) }} />;
      })}
    </>
  );
}

/** Light behind an orb, brighter on the beat. */
function Halo({ size, beat = 0 }: { size: number; beat?: number }) {
  return <div style={{ position: 'absolute', inset: -size * 0.55, borderRadius: '50%', background: `radial-gradient(closest-side, rgba(122,92,255,${(0.32 + 0.3 * beat).toFixed(3)}), rgba(63,193,180,${(0.1 + 0.14 * beat).toFixed(3)}) 52%, transparent 74%)` }} />;
}

const ORB_GLOWS = [
  { c: C.teal, x: 74, y: 22 },
  { c: C.violet, x: 80, y: 76 },
  { c: C.orange, x: 18, y: 66 },
];
/**
 * The ElevenRoute orb (components/Orb.tsx → BrandOrb), drawn here so the film controls it per frame: the three
 * provider lights turn round the black sphere while its highlight stays put.
 */
function FilmOrb({ t, size, spin = 30 }: { t: number; size: number; spin?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'relative', display: 'block', overflow: 'visible' }} aria-hidden="true">
      <defs>
        <radialGradient id={`b${id}`} cx="32%" cy="26%" r="85%">
          <stop offset="0" stopColor="#4a4643" />
          <stop offset="0.35" stopColor="#161413" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        {ORB_GLOWS.map((g, i) => (
          <radialGradient key={i} id={`g${i}${id}`} cx={`${g.x}%`} cy={`${g.y}%`} r="34%">
            <stop offset="0" stopColor={g.c} stopOpacity={0.9} />
            <stop offset="0.5" stopColor={g.c} stopOpacity={0.22} />
            <stop offset="1" stopColor={g.c} stopOpacity={0} />
          </radialGradient>
        ))}
        <radialGradient id={`s${id}`} cx="34%" cy="28%" r="20%">
          <stop offset="0" stopColor="#fff" stopOpacity={0.8} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#b${id})`} />
      <g transform={`rotate(${((t * spin) % 360).toFixed(2)} 50 50)`}>
        {ORB_GLOWS.map((_, i) => (
          <circle key={i} cx="50" cy="50" r="48" fill={`url(#g${i}${id})`} />
        ))}
      </g>
      <circle cx="50" cy="50" r="48" fill={`url(#s${id})`} />
      <circle cx="50" cy="50" r="49.4" fill="none" stroke="rgba(244,241,237,0.25)" strokeWidth={0.7} />
    </svg>
  );
}

/** A burst of sparks and streaks from a point, slowing and fading. */
function Burst({ t, at, x, y, n = 60, seed = 1, power = 1 }: { t: number; at: number; x: number; y: number; n?: number; seed?: number; power?: number }) {
  const age = t - at;
  if (age < 0 || age > 1.9) return null;
  const r = rng(seed);
  const colors = [C.teal, C.violet, C.orange, '#ffffff'];
  return (
    <div style={{ position: 'absolute', left: x, top: y }}>
      {Array.from({ length: n }, (_, i) => {
        const a = r() * Math.PI * 2;
        const v = (450 + r() * 1350) * power;
        const s = 4 + r() * 11;
        const c = colors[Math.floor(r() * colors.length)];
        const life = 0.9 + r() * 0.9;
        const streak = r() < 0.5;
        if (age > life) return null;
        const k = 3.2;
        const d = (v / k) * (1 - Math.exp(-k * age));
        const speed = v * Math.exp(-k * age);
        const len = streak ? Math.max(s, speed * 0.035) : s;
        const hgt = streak ? Math.max(2, s * 0.35) : s;
        const cx = Math.cos(a) * d;
        const cy = Math.sin(a) * d + 110 * age * age;
        return <span key={i} style={{ position: 'absolute', left: cx - len / 2, top: cy - hgt / 2, width: len, height: hgt, borderRadius: 99, background: c, opacity: 1 - seg(age, life * 0.45, life), transform: `rotate(${a.toFixed(3)}rad)` }} />;
      })}
    </div>
  );
}

/** A shockwave ring. */
function Shock({ t, at, x, y, size = 300, color = '#ffffff', dur = 0.9 }: { t: number; at: number; x: number; y: number; size?: number; color?: string; dur?: number }) {
  const p = seg(t, at, at + dur);
  if (t < at || p >= 1) return null;
  return <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: '50%', border: `${px(lerp(9, 1, p))} solid ${color}`, opacity: 1 - p, transform: `scale(${lerp(0.25, 3.2, easeOut(p)).toFixed(4)})` }} />;
}

/**
 * White flashes on the music's big hits (the drop at 12 s and the final hits at 60 s), with light building just
 * before, and a softer one where ElevenAgent's scene starts (36 s, on a bar line of the stop-start section).
 */
function Flash({ t }: { t: number }) {
  const hit = (at: number, peak: number, dur: number) => (t >= at ? peak * (1 - easeOut(seg(t, at, at + dur))) : 0);
  const pre = (at: number, peak: number, dur: number) => (t < at && t > at - dur ? peak * easeIn(seg(t, at - dur, at)) : 0);
  const o = Math.max(hit(12, 1, 0.55), pre(12, 0.9, 0.22), hit(36, 0.32, 0.4), hit(60, 1, 0.7), pre(60, 0.95, 0.35));
  if (o < 0.002) return null;
  return <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: o, pointerEvents: 'none' }} />;
}

/** Digital glitch over the whole frame: tears, colour bars, scanlines and a faint red flicker (never a full-frame flash). */
function GlitchOverlay({ t }: { t: number }) {
  const w = inGlitch(t);
  if (!w) return null;
  const f = frameOf(t);
  const fade = 1 - 0.6 * seg(t, w[0], w[1]);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} style={{ position: 'absolute', left: (noise(f * 19 + i) - 0.5) * 400, top: noise(f * 13 + i) * H, width: W, height: 3 + noise(f * 17 + i) * 64, background: [C.bad, C.teal, '#ffffff', C.violet][i % 4], opacity: (0.08 + noise(f * 23 + i) * 0.3) * fade }} />
      ))}
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0 2px, transparent 2px 5px)' }} />
      {noise(f * 7.7) > 0.7 ? <div style={{ position: 'absolute', inset: 0, background: C.bad, opacity: 0.1 * fade }} /> : null}
    </div>
  );
}

function Caption({ t, at, until, children }: { t: number; at: number; until: number; children: ReactNode }) {
  const o = Math.min(easeOut(seg(t, at, at + 0.4)), 1 - easeInOut(seg(t, until - 0.35, until)));
  if (o <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 70, display: 'flex', justifyContent: 'center', opacity: o, transform: `translateY(${px((1 - easeOut(seg(t, at, at + 0.5))) * 18)})` }}>
      <div style={{ fontSize: 48, fontWeight: 300, letterSpacing: '-0.02em', textAlign: 'center', maxWidth: 1660, lineHeight: 1.2, color: C.ink }}>{children}</div>
    </div>
  );
}

function Eyebrow({ t, at, children, style }: { t: number; at: number; children: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: 'absolute', fontSize: 24, color: C.ink2, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap', ...style, ...rise(t, at, 0.45, 10) }}>{children}</div>;
}

function Pill({ children, color = C.ink2, border = C.line, bg = 'transparent', size = 22, style }: { children: ReactNode; color?: string; border?: string; bg?: string; size?: number; style?: CSSProperties }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: `1.5px solid ${border}`, background: bg, padding: '6px 16px', fontSize: size, fontWeight: 600, color, whiteSpace: 'nowrap', ...style }}>{children}</span>;
}

const KIND_COLOR: Record<Kind, { c: string; b: string }> = {
  Simple: { c: C.simple, b: 'rgba(124,155,255,0.5)' },
  Complex: { c: C.complex, b: 'rgba(255,106,43,0.5)' },
};
function KindPill({ kind, size = 20, label }: { kind: Kind; size?: number; label?: string }) {
  return (
    <Pill color={KIND_COLOR[kind].c} border={KIND_COLOR[kind].b} size={size}>
      {label ?? kind}
    </Pill>
  );
}

/** A band of light that passes over a piece of text once, between a and b. Put it inside the text's element. */
function Sweep({ t, a, b, children }: { t: number; a: number; b: number; children: ReactNode }) {
  const p = seg(t, a, b);
  if (p <= 0 || p >= 1) return null;
  const x = lerp(-20, 120, easeInOut(p));
  const mask = `linear-gradient(100deg, transparent ${x - 14}%, #000 ${x}%, transparent ${x + 14}%)`;
  return (
    <span aria-hidden="true" style={{ position: 'absolute', inset: 0, color: '#ffffff', textShadow: '0 0 24px rgba(255,255,255,0.6)', WebkitMaskImage: mask, maskImage: mask, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

/** The ElevenRoute wordmark, letters rising in one after another. */
function Wordmark({ t, at, left, top, size, step = 0.0625 }: { t: number; at: number; left: number; top: number; size: number; step?: number }) {
  return (
    <div style={{ position: 'absolute', left, top, display: 'flex', fontSize: size, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 1, whiteSpace: 'nowrap' }}>
      {[...'ElevenRoute'].map((ch, i) => {
        const a = at + i * step;
        const p = easeOut(seg(t, a, a + 0.35));
        return (
          <span key={i} style={{ display: 'inline-block', opacity: seg(t, a, a + 0.12), transform: `translateY(${((1 - p) * 40).toFixed(2)}%)`, filter: p < 1 ? `blur(${px((1 - p) * 8)})` : undefined }}>
            {ch}
          </span>
        );
      })}
    </div>
  );
}

function SampleNote({ t }: { t: number }) {
  const o = Math.min(seg(t, 20.2, 20.7), 1 - seg(t, 51.3, 51.7));
  if (o <= 0) return null;
  return <div style={{ position: 'absolute', right: 44, bottom: 30, fontSize: 18, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.ink3, opacity: o * 0.9 }}>Product illustration · sample data</div>;
}

function Vignette() {
  return <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.34) 100%)' }} />;
}

function Grain() {
  return <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.035, backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }} />;
}

// ---------- the team chat (light scenes) ----------
function ChatWindow({ children, top }: { children: ReactNode; top: number }) {
  return (
    <div style={{ position: 'absolute', left: 260, width: 1400, top, borderRadius: 32, background: '#fdfcfc', boxShadow: '0 50px 140px -30px rgba(20,16,12,0.45)', overflow: 'hidden' }}>
      <div style={{ height: 76, display: 'flex', alignItems: 'center', gap: 12, padding: '0 34px', borderBottom: '1px solid #ebe8e4' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 16, height: 16, borderRadius: '50%', background: c }} />
        ))}
        <span style={{ marginLeft: 20, fontSize: 26, fontWeight: 600, color: '#0c0b0a' }}># support-ops</span>
      </div>
      <div style={{ padding: '38px 52px 44px', display: 'flex', flexDirection: 'column', gap: 30 }}>{children}</div>
    </div>
  );
}

const avatar = (color: string): CSSProperties => ({ width: 64, height: 64, borderRadius: 16, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 30, fontWeight: 600, flexShrink: 0 });

function Message({ who, role, color, children, style }: { who: string; role: string; color: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', ...style }}>
      <span style={avatar(color)}>{who[0]}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 25, color: '#6b645e' }}>
          <b style={{ color: '#0c0b0a', fontWeight: 600 }}>{who}</b> · {role}
        </div>
        <div style={{ marginTop: 6, fontSize: 38, lineHeight: 1.32, color: '#0c0b0a', maxWidth: 1180, letterSpacing: '-0.01em' }}>{children}</div>
      </div>
    </div>
  );
}

function Typing({ t }: { t: number }) {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
      <span style={avatar(C.violet)}>L</span>
      <span style={{ display: 'flex', gap: 10, padding: '18px 24px', borderRadius: 22, background: '#f1eeea' }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: '#8a847f', opacity: 0.3 + 0.7 * Math.max(0, Math.sin(t * 10 - i * 0.9)) }} />
        ))}
      </span>
    </div>
  );
}

/** Lina's reply: typing dots, then the message typed out. Its height is kept from the start so nothing jumps. */
function Reply({ t, typingFrom, at, text, typeFor = 0.3 }: { t: number; typingFrom: number; at: number; text: string; typeFor?: number }) {
  return (
    <div style={{ minHeight: 104 }}>
      {t >= typingFrom && t < at ? <Typing t={t} /> : null}
      {t >= at ? (
        <Message who="Lina" role="Head of Support" color={C.violet} style={rise(t, at, 0.3, 12)}>
          {typed(text, t, at, at + typeFor)}
          {t < at + typeFor + 0.35 ? <span style={{ opacity: frameOf(t) % 10 < 5 ? 1 : 0, marginLeft: 2 }}>|</span> : null}
        </Message>
      ) : null}
    </div>
  );
}

// ---------- 1. Hook (0–4 s) ----------
const RAIN = ['Hi there!', 'Thanks!', 'Where is my order?', 'Reset my password', 'Ok 👍', 'Refund please', 'Open on Sunday?', 'Thank you so much!', 'Change my address', 'Is it in stock?', 'Great, thanks', 'Cancel my plan', 'Can I pay later?'];
const HOOK_WORDS: { w: string; at: number; line: number; hot?: boolean }[] = [
  { w: 'Every', at: 0, line: 0 },
  { w: 'customer', at: 0.5, line: 0 },
  { w: 'message.', at: 1, line: 0 },
  { w: 'The most', at: 2, line: 1 },
  { w: 'expensive', at: 2.5, line: 1, hot: true },
  { w: 'AI.', at: 3, line: 1 },
];

/** Customer messages drifting up in three depths, every one tagged for the flagship model. */
function ChatRain({ t }: { t: number }) {
  return (
    <>
      {Array.from({ length: 26 }, (_, i) => {
        const layer = i % 3;
        const span = H + 260;
        const y = ((((noise(i * 5.7) * span - [34, 60, 95][layer] * t) % span) + span) % span) - 130;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 40 + noise(i * 3.1) * (W - 460),
              top: y,
              transform: `scale(${[0.72, 0.86, 1][layer]})`,
              transformOrigin: 'left top',
              filter: layer === 0 ? 'blur(2.5px)' : layer === 1 ? 'blur(1px)' : undefined,
              opacity: [0.2, 0.3, 0.42][layer],
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              borderRadius: 999,
              padding: '12px 20px',
              background: 'rgba(255,255,255,0.06)',
              border: `1.5px solid ${C.line}`,
              fontSize: 26,
              color: C.ink2,
              whiteSpace: 'nowrap',
            }}>
            {RAIN[i % RAIN.length]}
            <span style={{ fontSize: 18, fontWeight: 600, color: C.orange }}>→ flagship</span>
          </div>
        );
      })}
    </>
  );
}

function Hook({ t }: { t: number }) {
  const cam = `${shake(t, [0, 0.5, 1, 2, 2.5, 3, 3.4], 8, 0.3)} scale(${lerp(1, 1.06, easeInOut(seg(t, 0, 4))).toFixed(4)})`;
  const f = frameOf(t);
  const jitter = t > 2.8 ? `${px((noise(f) - 0.5) * 6)} ${px((noise(f + 1) - 0.5) * 4)}` : undefined;
  return (
    // starts during the music's opening swell (story −0.75 to 0, before the first word): the chat rain fades in
    <Scene t={t} from={-0.75} to={4 + WHIP / 2} fadeIn={0.7} style={whip(t, 4, 'out')}>
      <ChatRain t={t} />
      <Glows t={t} intensity={0.45} />
      <div style={{ position: 'absolute', left: 200, right: 200, top: 160, bottom: 200, background: 'radial-gradient(closest-side, rgba(9,9,10,0.94), rgba(9,9,10,0))' }} />
      <div style={{ position: 'absolute', inset: 0, transform: cam }}>
        {[0, 1].map((line) => (
          <div key={line} style={{ position: 'absolute', left: 0, right: 0, top: line ? 470 : 300, display: 'flex', justifyContent: 'center', gap: 34, fontSize: 132, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1, whiteSpace: 'nowrap' }}>
            {HOOK_WORDS.filter((x) => x.line === line).map((x) => (
              <span key={x.w} style={{ display: 'inline-block', ...slam(t, x.at), color: x.hot ? C.orange : C.ink, textShadow: x.hot ? '0 0 70px rgba(255,106,43,0.55)' : undefined, translate: x.hot ? jitter : undefined }}>
                {x.w}
              </span>
            ))}
          </div>
        ))}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 664, display: 'flex', justifyContent: 'center', fontSize: 62, fontWeight: 400, letterSpacing: '-0.025em', color: C.ink2 }}>
          <span style={{ display: 'inline-block', ...slam(t, 3.4, 0.28, 1.5) }}>
            Even for <span style={{ color: C.ink }}>“thanks!”</span>
          </span>
        </div>
      </div>
    </Scene>
  );
}

// ---------- 2. The problem: the CFO's message (4–10 s) ----------
/** "AI model spend": a line that creeps, then shoots up. No figures, only the shape. */
function SpendCard({ t }: { t: number }) {
  const p = easeInOut(seg(t, 5.4, 6.95));
  const w = 600;
  const h = 150;
  const f = (x: number) => 0.1 + 0.08 * x + 0.78 * Math.pow(x, 3.2) + 0.02 * Math.sin(x * 37);
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = (i / 60) * p;
    pts.push(`${(x * w).toFixed(1)},${(h - f(x) * h).toFixed(1)}`);
  }
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${(p * w).toFixed(1)},${h} L0,${h} Z`;
  const head = { x: p * w, y: h - f(p) * h };
  return (
    <div style={{ marginTop: 20, width: 680, borderRadius: 22, border: '1.5px solid #e9e4de', background: '#fff', padding: '18px 24px 16px', ...rise(t, 5.1, 0.45, 16) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 40 }}>
        <span style={{ fontSize: 23, fontWeight: 600, color: '#0c0b0a', letterSpacing: 0 }}>AI model spend</span>
        {t >= 7 ? <span style={{ fontSize: 20, fontWeight: 600, color: '#fff', background: '#e5484d', borderRadius: 999, padding: '6px 16px', letterSpacing: 0, transform: `scale(${pop(t, 7).toFixed(4)})` }}>▲ Over budget</span> : null}
      </div>
      <svg width={w} height={h + 8} style={{ display: 'block', marginTop: 10, overflow: 'visible' }} aria-hidden="true">
        <defs>
          <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e5484d" stopOpacity={0.28} />
            <stop offset="1" stopColor="#e5484d" stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke="#efebe6" strokeWidth={1.5} />
        ))}
        {p > 0 ? (
          <>
            <path d={area} fill="url(#spendFill)" />
            <path d={line} fill="none" stroke="#e5484d" strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={head.x} cy={head.y} r={8} fill="#e5484d" />
            <circle cx={head.x} cy={head.y} r={8 + 16 * pulse(t, 5)} fill="none" stroke="#e5484d" strokeOpacity={0.4} strokeWidth={2} />
          </>
        ) : null}
      </svg>
    </div>
  );
}

function Problem({ t }: { t: number }) {
  const iris = easeIn(seg(t, 9.4, 9.98));
  const push = lerp(1, 1.07, easeInOut(seg(t, 4.2, 9.6)));
  const style: CSSProperties = { ...whip(t, 4, 'in'), ...(iris > 0 ? { clipPath: `circle(${px(lerp(1500, 0, iris))} at 420px 700px)` } : {}) };
  return (
    <Scene t={t} from={4 - WHIP / 2} to={10} style={style}>
      <div style={{ position: 'absolute', inset: 0, background: LIGHT_BG, transform: `${shake(t, [7], 9, 0.35)} scale(${push.toFixed(4)})`, transformOrigin: '40% 70%' }}>
        <LightGlows />
        <ChatWindow top={110}>
          <Message who="Omar" role="CFO" color="#4a4541" style={rise(t, 4.4, 0.4, 18)}>
            <span style={{ color: '#0447ff', fontWeight: 500 }}>@Lina</span> the AI bill tripled again 😬 Every chat goes to the priciest model. Fix it before Friday?
            <SpendCard t={t} />
          </Message>
          <Reply t={t} typingFrom={7.3} at={8} text="on it." />
        </ChatWindow>
      </div>
    </Scene>
  );
}

// ---------- 3. Build (10–12 s) ----------
const BUILD_WORDS = [
  { w: 'So', at: 10 },
  { w: 'Lina', at: 10.25 },
  { w: 'tried', at: 10.5 },
  { w: 'something', at: 10.875 },
  { w: 'smarter.', at: 11.25 },
];

/** Streaks of light pulled into the centre, faster and faster. */
function Inflow({ t, p }: { t: number; p: number }) {
  const r = rng(42);
  const phase = (t - 10) * 0.6 + 0.8 * (t - 10) * (t - 10);
  return (
    <>
      {Array.from({ length: 48 }, (_, i) => {
        const a = r() * Math.PI * 2;
        const off = r();
        const len = 60 + r() * 150;
        const c = [C.teal, C.violet, C.orange, '#ffffff'][Math.floor(r() * 4)];
        const q = (off + phase) % 1;
        const d = lerp(1150, 120, easeIn(q));
        const o = Math.min(seg(q, 0, 0.15), 1 - seg(q, 0.8, 1)) * (0.25 + 0.75 * p);
        return <span key={i} style={{ position: 'absolute', left: 960 + Math.cos(a) * d - len / 2, top: 540 + Math.sin(a) * d - 1.5, width: len, height: 3, borderRadius: 3, background: `linear-gradient(90deg, transparent, ${c})`, opacity: o, transform: `rotate(${(a + Math.PI).toFixed(3)}rad)` }} />;
      })}
    </>
  );
}

function Build({ t }: { t: number }) {
  const p = seg(t, 10, 12);
  const suck = easeIn(seg(t, 11.42, 11.95));
  const amp = 9 * easeIn(seg(t, 10.6, 12));
  const f = frameOf(t);
  const orb = lerp(40, 300, easeIn(p));
  return (
    <Scene t={t} from={10} to={12}>
      <Rays t={t} strength={0.2 + 0.8 * easeIn(p)} />
      <Inflow t={t} p={p} />
      <div style={{ position: 'absolute', inset: 0, transform: `translate(${px((noise(f) * 2 - 1) * amp)}, ${px((noise(f + 7) * 2 - 1) * amp)})` }}>
        <div style={{ position: 'absolute', left: 960 - orb / 2, top: 540 - orb / 2, width: orb, height: orb, opacity: 0.3 + 0.7 * easeIn(p), filter: `brightness(${(0.35 + 0.65 * easeIn(p)).toFixed(3)})` }}>
          <Halo size={orb} beat={easeIn(p)} />
          <FilmOrb t={t} size={orb} />
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 250, display: 'flex', justifyContent: 'center', gap: 28, fontSize: 104, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.1, whiteSpace: 'nowrap', transform: `translateY(${px(233 * suck)}) scale(${lerp(1, 0.05, suck).toFixed(4)})`, opacity: 1 - seg(t, 11.72, 11.95), filter: suck > 0 ? `blur(${px(suck * 10)})` : undefined }}>
          {BUILD_WORDS.map((x) => (
            <span key={x.w} style={{ display: 'inline-block', ...slam(t, x.at, 0.22, 1.6), color: x.w === 'smarter.' ? C.teal : C.ink }}>
              {x.w}
            </span>
          ))}
        </div>
      </div>
    </Scene>
  );
}

// ---------- 4. Drop and reveal (12–20 s) ----------
/** The lockup: orb, gap, wordmark (150 px Inter Light; its width is measured from a render). */
const LOCK = { orb: 190, gap: 40, word: 808 };
const LOCK_LEFT = 960 - (LOCK.orb + LOCK.gap + LOCK.word) / 2;
const LOCK_ORB_X = LOCK_LEFT + LOCK.orb / 2;
const VENDOR_ROW: { name: string; model: ModelId; at: number }[] = [
  { name: 'OpenAI', model: 'gpt5', at: 18 },
  { name: 'Google Gemini', model: 'gpro', at: 18.5 },
  { name: 'Anthropic', model: 'sonnet', at: 19 },
];

function Drop({ t }: { t: number }) {
  const popIn = backOut(seg(t, 12, 12.45));
  const toLock = easeInOut(seg(t, 12.45, 12.95));
  const up = easeInOut(seg(t, 13.9, 14.35));
  const zoom = seg(t, 19.45, 20.02);
  const beat = pulse(t);
  const size = lerp(340, LOCK.orb, toLock);
  const cx = lerp(960, LOCK_ORB_X, toLock);
  const cy = lerp(540, 300, up);
  const lines = [
    { y: 500, a: 'Smart', b: 'where it matters.', at: 14, color: '#d9d0ff' },
    { y: 625, a: 'Cheap', b: 'where it doesn’t.', at: 15, color: C.teal },
  ];
  return (
    <Scene t={t} from={12} to={20.02}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${(1 + 8 * easeIn(zoom)).toFixed(4)})`, transformOrigin: `${px(cx)} ${px(cy)}`, opacity: 1 - seg(t, 19.8, 20.02), filter: zoom > 0 ? `blur(${px(easeIn(zoom) * 8)})` : undefined }}>
        <Glows t={t} intensity={0.9 + 0.5 * beat} />
        <Rays t={t} strength={0.15 + 0.5 * (1 - seg(t, 12, 14))} cx={cx} cy={cy} />
        <Sparkles t={t} seed={7} n={44} />
        <Shock t={t} at={12} x={960} y={540} size={360} />
        <Shock t={t} at={12.12} x={960} y={540} size={360} color={C.teal} />
        <Burst t={t} at={12} x={960} y={540} n={72} seed={3} />
        <div style={{ position: 'absolute', left: cx - size / 2, top: cy - size / 2, width: size, height: size, transform: `scale(${(popIn * (1 + 0.05 * beat)).toFixed(4)})` }}>
          <Halo size={size} beat={beat} />
          <FilmOrb t={t} size={size} />
        </div>
        <Wordmark t={t} at={12.55} left={LOCK_LEFT + LOCK.orb + LOCK.gap} top={cy - 78} size={150} />
        {lines.map((l, i) => (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: l.y, display: 'flex', justifyContent: 'center', gap: 30, fontSize: 104, lineHeight: 1.05, letterSpacing: '-0.04em', whiteSpace: 'nowrap', transform: `scale(${(1 + 0.012 * beat).toFixed(4)})` }}>
            <span style={{ position: 'relative', display: 'inline-block', fontWeight: 600, color: l.color, ...slam(t, l.at) }}>
              {l.a}
              <Sweep t={t} a={16 + i * 0.25} b={16.8 + i * 0.25}>
                {l.a}
              </Sweep>
            </span>
            <span style={{ position: 'relative', display: 'inline-block', fontWeight: 300, ...slam(t, l.at + 0.5, 0.3, 1.4) }}>
              {l.b}
              <Sweep t={t} a={16.12 + i * 0.25} b={16.92 + i * 0.25}>
                {l.b}
              </Sweep>
            </span>
          </div>
        ))}
        <div style={{ position: 'absolute', left: 310, right: 310, top: 790, textAlign: 'center', fontSize: 36, lineHeight: 1.4, color: C.ink2, ...rise(t, 17, 0.6, 18) }}>
          Every customer message goes to the right AI model, and switches provider the moment one fails.
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 925, display: 'flex', justifyContent: 'center', gap: 22 }}>
          {VENDOR_ROW.map((v) => (
            <span key={v.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, borderRadius: 999, border: `1.5px solid ${C.line}`, background: C.card, padding: '8px 22px 8px 10px', fontSize: 24, color: C.ink2, opacity: seg(t, v.at, v.at + 0.1), transform: `scale(${pop(t, v.at).toFixed(4)})` }}>
              <Orb model={MODELS[v.model]} size={34} />
              {v.name}
            </span>
          ))}
        </div>
      </div>
    </Scene>
  );
}

// ---------- 5. Every turn routed live (20–24 s) ----------
const FEED: { text: string; kind: Kind; to: ModelId }[] = [
  { text: 'Thanks, that’s all!', kind: 'Simple', to: 'gflash' },
  { text: 'Charged twice! Refund me today.', kind: 'Complex', to: 'sonnet' },
  { text: 'Where is order 55120?', kind: 'Simple', to: 'gpt5mini' },
  { text: 'Missed again. I want to complain.', kind: 'Complex', to: 'gpt5' },
  { text: 'What time do you open?', kind: 'Simple', to: 'haiku' },
  { text: 'Will my premium change if I move?', kind: 'Complex', to: 'gpro' },
  { text: 'Yes, 3pm tomorrow works.', kind: 'Simple', to: 'gflash' },
];
const FEED_AT = (i: number) => 20.3 + i * 0.5;
const FEED_HUB: P = { x: 960, y: 520 };
const FEED_ROW_X = 1290;
const FEED_ROWS: { id: ModelId; y: number }[] = [
  { id: 'gpt5mini', y: 268 },
  { id: 'gflash', y: 356 },
  { id: 'haiku', y: 444 },
  { id: 'gpt5', y: 636 },
  { id: 'gpro', y: 724 },
  { id: 'sonnet', y: 812 },
];
const feedRowY = (id: ModelId) => FEED_ROWS.find((r) => r.id === id)?.y ?? FEED_HUB.y;

function FeedBubble({ t, i, n, shift }: { t: number; i: number; n: number; shift: number }) {
  if (i >= n) return null;
  const m = FEED[i];
  const a = FEED_AT(i);
  const k = n - 1 - i;
  const slot = k === 0 ? 0 : k - 1 + shift;
  const o = 1 - seg(slot, 2, 2.9);
  if (o <= 0) return null;
  const inX = k === 0 ? lerp(-640, 0, easeOut(seg(t, a, a + 0.22))) : 0;
  return (
    <div style={{ position: 'absolute', left: 110, top: FEED_HUB.y - 57 - slot * 124, width: 560, borderRadius: 26, padding: '16px 22px', background: k === 0 ? 'rgba(255,255,255,0.09)' : C.card, border: `1.5px solid ${k === 0 ? 'rgba(255,255,255,0.22)' : C.line}`, opacity: o, transform: `translateX(${px(inX)}) scale(${(1 - 0.03 * slot).toFixed(4)})`, transformOrigin: 'left center' }}>
      <div style={{ fontSize: 29, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.text}</div>
      <div style={{ marginTop: 10, height: 34, display: 'flex', alignItems: 'center', gap: 12 }}>
        {t >= a + 0.2 ? (
          <span style={{ display: 'inline-flex', transform: `scale(${pop(t, a + 0.2, 0.22).toFixed(4)})`, transformOrigin: 'left center' }}>
            <KindPill kind={m.kind} size={18} />
          </span>
        ) : null}
        {t >= a + 0.46 ? <span style={{ fontSize: 21, color: C.ink3, opacity: easeOut(seg(t, a + 0.46, a + 0.7)) }}>→ {MODELS[m.to].name}</span> : null}
      </div>
    </div>
  );
}

function FeedPaths({ t }: { t: number }) {
  const from = { x: FEED_HUB.x + 92, y: FEED_HUB.y };
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden="true">
      {FEED_ROWS.map((r) => (
        <path key={r.id} d={curve(from, { x: FEED_ROW_X - 12, y: r.y })} fill="none" stroke="rgba(244,241,237,0.1)" strokeWidth={2} />
      ))}
      {FEED.map((m, i) => {
        const a = FEED_AT(i);
        if (t < a || t > a + 1.3) return null;
        const inP = easeInOut(seg(t, a + 0.04, a + 0.2));
        const outP = easeInOut(seg(t, a + 0.22, a + 0.46));
        const to = { x: FEED_ROW_X - 12, y: feedRowY(m.to) };
        const col = KIND_COLOR[m.kind].c;
        const head = outP > 0 ? bez(from, to, outP) : { x: lerp(680, FEED_HUB.x - 92, inP), y: FEED_HUB.y };
        return (
          <g key={i} opacity={1 - seg(t, a + 0.55, a + 1.25)}>
            {inP > 0 ? <line x1={680} y1={FEED_HUB.y} x2={lerp(680, FEED_HUB.x - 92, inP)} y2={FEED_HUB.y} stroke={C.ink} strokeOpacity={0.45} strokeWidth={3} strokeLinecap="round" /> : null}
            {outP > 0 ? <path d={curve(from, to)} pathLength={1} fill="none" stroke={col} strokeWidth={4} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - outP} /> : null}
            {t < a + 0.5 ? (
              <>
                <circle cx={head.x} cy={head.y} r={20} fill={col} opacity={0.25} />
                <circle cx={head.x} cy={head.y} r={8} fill="#ffffff" />
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function Feed({ t }: { t: number }) {
  const enter = easeOut(seg(t, 19.75, 20.2));
  const n = FEED.filter((_, i) => t >= FEED_AT(i)).length;
  const lastAt = n ? FEED_AT(n - 1) : 0;
  const shift = easeOut(seg(t, lastAt, lastAt + 0.22));
  const beat = pulse(t);
  const cls = FEED.map((m, i) => ({ m, a: FEED_AT(i) + 0.18 })).filter((x) => t >= x.a).pop();
  const groups = [
    { label: 'Fast · low cost', y: 200, color: C.simple, ids: ['gpt5mini', 'gflash', 'haiku'] },
    { label: 'Strongest', y: 568, color: C.complex, ids: ['gpt5', 'gpro', 'sonnet'] },
  ];
  return (
    <Scene t={t} from={19.75} to={24 + WHIP / 2} style={whip(t, 24, 'out')}>
      {/* emerges from the point where the reveal flew into the orb */}
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${lerp(0.35, 1, enter).toFixed(4)})`, transformOrigin: `${px(LOCK_ORB_X)} 300px`, opacity: enter, filter: enter < 1 ? `blur(${px((1 - enter) * 10)})` : undefined }}>
        <Glows t={t} intensity={0.55 + 0.35 * beat} />
        <Eyebrow t={t} at={20} style={{ left: 110, top: 96 }}>
          Every turn, routed live
        </Eyebrow>
        <FeedPaths t={t} />
        {FEED.map((_, i) => (
          <FeedBubble key={i} t={t} i={i} n={n} shift={shift} />
        ))}

        {/* the router */}
        {cls ? <div style={{ position: 'absolute', left: FEED_HUB.x - 85, top: FEED_HUB.y - 85, width: 170, height: 170, borderRadius: '50%', border: `2px solid ${KIND_COLOR[cls.m.kind].c}`, opacity: 0.7 * (1 - seg(t, cls.a, cls.a + 0.5)), transform: `scale(${lerp(1, 1.9, easeOut(seg(t, cls.a, cls.a + 0.5))).toFixed(4)})` }} /> : null}
        <div style={{ position: 'absolute', left: FEED_HUB.x - 85, top: FEED_HUB.y - 85, width: 170, height: 170, transform: `scale(${(1 + 0.06 * beat).toFixed(4)})` }}>
          <Halo size={170} beat={beat} />
          <FilmOrb t={t} size={170} spin={60} />
        </div>
        <div style={{ position: 'absolute', left: FEED_HUB.x - 160, width: 320, top: FEED_HUB.y + 104, textAlign: 'center', fontSize: 26, fontWeight: 600 }}>ElevenRoute</div>
        {cls ? (
          <div style={{ position: 'absolute', left: FEED_HUB.x - 160, width: 320, top: FEED_HUB.y + 148, display: 'flex', justifyContent: 'center', transform: `scale(${pop(t, cls.a, 0.25).toFixed(4)})` }}>
            <KindPill kind={cls.m.kind} size={22} label={`${cls.m.kind} turn`} />
          </div>
        ) : null}

        {/* the models */}
        {groups.map((g, gi) => (
          <div key={g.label} style={{ position: 'absolute', left: FEED_ROW_X + 6, top: g.y, fontSize: 22, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: g.color, ...rise(t, 20.05 + gi * 0.1, 0.4, 10) }}>
            {g.label}
          </div>
        ))}
        {FEED_ROWS.map((r, idx) => {
          const hits = FEED.map((m, i) => (m.to === r.id ? FEED_AT(i) + 0.46 : -1)).filter((h) => h >= 0 && t >= h);
          const f = hits.length ? Math.exp(-(t - hits[hits.length - 1]) * 3.5) : 0;
          const strong = MODELS[r.id].tier === 'flagship';
          const edge = strong ? `rgba(255,155,107,${(0.25 + 0.6 * f).toFixed(3)})` : `rgba(159,180,255,${(0.25 + 0.6 * f).toFixed(3)})`;
          return (
            <div key={r.id} style={{ position: 'absolute', left: FEED_ROW_X, top: r.y - 38, width: 500, height: 76, borderRadius: 22, display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px', background: `rgba(255,255,255,${(0.03 + 0.1 * f).toFixed(3)})`, border: `1.5px solid ${f > 0.04 ? edge : C.line}`, whiteSpace: 'nowrap', ...rise(t, 20.1 + idx * 0.05, 0.4, 12) }}>
              <span style={{ display: 'inline-flex', transform: `scale(${(1 + 0.2 * f).toFixed(4)})` }}>
                <Orb model={MODELS[r.id]} size={44} />
              </span>
              <span style={{ flex: 1, fontSize: 28, fontWeight: 500, color: f > 0.3 ? C.ink : C.ink2 }}>{MODELS[r.id].name}</span>
              <span style={{ fontSize: 20, color: C.ink3 }}>{MODELS[r.id].maker}</span>
            </div>
          );
        })}
        <Caption t={t} at={21} until={23.85}>
          Simple turns → fast, low-cost models. <span style={{ color: C.complex }}>Hard turns → the strongest.</span>
        </Caption>
      </div>
    </Scene>
  );
}

// ---------- 6. Before and after (24–30 s) ----------
const MIX: { text: string; kind: Kind }[] = [
  { text: 'Thanks!', kind: 'Simple' },
  { text: 'Where’s my order?', kind: 'Simple' },
  { text: 'Charged twice!', kind: 'Complex' },
  { text: 'Open on Sunday?', kind: 'Simple' },
  { text: 'Ok 👍', kind: 'Simple' },
  { text: 'Missed again!', kind: 'Complex' },
  { text: '3pm works', kind: 'Simple' },
  { text: 'Great, thanks', kind: 'Simple' },
  { text: 'Will my premium change?', kind: 'Complex' },
  { text: 'Got it', kind: 'Simple' },
];
const MIX_AT = (i: number) => 24.45 + i * 0.42;
const FALL = 0.8;
const COMPLEX_N = MIX.filter((m) => m.kind === 'Complex').length;
/** Each turn's share of the bar: on the flagship every turn costs the same; routed, the simple turns share what is left of the sample ratio. */
const STEP = { flagship: 1 / MIX.length, fast: (SAMPLE_RATIO - COMPLEX_N / MIX.length) / (MIX.length - COMPLEX_N) };
const SPLIT_DEST = { left: { x: 480, y: 610 }, fast: { x: 1250, y: 610 }, flag: { x: 1640, y: 610 } };

function Split({ t }: { t: number }) {
  const hitAt = (i: number) => MIX_AT(i) + FALL;
  const absorbed = (pred: (i: number) => boolean) => MIX.map((_, i) => i).filter((i) => pred(i) && t >= hitAt(i));
  const bump = (list: number[]) => (list.length ? Math.exp(-(t - hitAt(list[list.length - 1])) * 7) : 0);
  const leftHits = absorbed(() => true);
  const fastHits = absorbed((i) => MIX[i].kind === 'Simple');
  const flagHits = absorbed((i) => MIX[i].kind === 'Complex');
  const fill = (side: 'left' | 'right') => MIX.reduce((sum, m, i) => sum + (side === 'left' || m.kind === 'Complex' ? STEP.flagship : STEP.fast) * easeOut(seg(t, hitAt(i), hitAt(i) + 0.25)), 0);
  const leftSize = 150 + 6 * leftHits.length;
  const divider = easeInOut(seg(t, 24.1, 24.5));
  const heads = [
    { x: 480, eyebrow: 'Without ElevenRoute', title: 'Every turn → the flagship', color: C.ink2 },
    { x: 1440, eyebrow: 'With ElevenRoute', title: 'Each turn → the right model', color: C.teal },
  ];
  return (
    <Scene t={t} from={24 - WHIP / 2} to={30} style={whip(t, 24, 'in')}>
      <div style={{ position: 'absolute', inset: 0, transform: glitchShift(t) }}>
        <Glows t={t} intensity={0.55} />
        <div style={{ position: 'absolute', left: 959, top: 60, width: 2, height: 960, background: C.line, transform: `scaleY(${divider.toFixed(4)})`, transformOrigin: 'top' }} />
        {heads.map((h, i) => (
          <div key={h.eyebrow} style={{ position: 'absolute', left: h.x - 440, width: 880, top: 92, textAlign: 'center', ...rise(t, 24.2 + i * 0.12, 0.45, 14) }}>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: h.color }}>{h.eyebrow}</div>
            <div style={{ marginTop: 12, fontSize: 48, fontWeight: 300, letterSpacing: '-0.025em' }}>{h.title}</div>
          </div>
        ))}

        {/* destinations */}
        <div style={{ position: 'absolute', left: SPLIT_DEST.left.x - leftSize / 2, top: SPLIT_DEST.left.y - leftSize / 2, width: leftSize, height: leftSize, transform: `scale(${(1 + 0.12 * bump(leftHits)).toFixed(4)})` }}>
          <div style={{ position: 'absolute', inset: -leftSize * 0.6, borderRadius: '50%', background: `radial-gradient(closest-side, rgba(255,93,93,${(0.12 + 0.05 * leftHits.length).toFixed(3)}), transparent)` }} />
          <Orb model={MODELS.sonnet} size={leftSize} />
        </div>
        <div style={{ position: 'absolute', left: SPLIT_DEST.left.x - 200, width: 400, top: 705, textAlign: 'center', fontSize: 22, color: C.ink3 }}>Flagship model</div>
        <div style={{ position: 'absolute', left: SPLIT_DEST.fast.x - 90, top: SPLIT_DEST.fast.y - 70, width: 180, height: 140, transform: `scale(${(1 + 0.14 * bump(fastHits)).toFixed(4)})` }}>
          {(['gpt5mini', 'gflash', 'haiku'] as ModelId[]).map((id, i) => (
            <span key={id} style={{ position: 'absolute', left: [58, 0, 116][i], top: [0, 70, 70][i] }}>
              <Orb model={MODELS[id]} size={64} />
            </span>
          ))}
        </div>
        <div style={{ position: 'absolute', left: SPLIT_DEST.fast.x - 160, width: 320, top: 705, textAlign: 'center', fontSize: 22, color: C.ink3 }}>Fast models</div>
        <div style={{ position: 'absolute', left: SPLIT_DEST.flag.x - 75, top: SPLIT_DEST.flag.y - 75, width: 150, height: 150, transform: `scale(${(1 + 0.12 * bump(flagHits)).toFixed(4)})` }}>
          <Orb model={MODELS.sonnet} size={150} />
        </div>
        <div style={{ position: 'absolute', left: SPLIT_DEST.flag.x - 160, width: 320, top: 705, textAlign: 'center', fontSize: 22, color: C.ink3 }}>Flagship model</div>

        {/* the same turns falling on both sides */}
        {MIX.map((m, i) => {
          const q = seg(t, MIX_AT(i), MIX_AT(i) + FALL);
          if (t < MIX_AT(i) || q >= 1) return null;
          const jitter = (noise(i * 4.1) - 0.5) * 240;
          return (['left', 'right'] as const).map((side) => {
            const x0 = (side === 'left' ? 480 : 1440) + jitter;
            const dest = side === 'left' ? SPLIT_DEST.left : m.kind === 'Simple' ? SPLIT_DEST.fast : SPLIT_DEST.flag;
            const x = lerp(x0, dest.x, easeInOut(q));
            const y = lerp(258, dest.y, easeIn(q));
            const k = side === 'right' ? KIND_COLOR[m.kind] : { c: C.ink2, b: 'rgba(255,255,255,0.22)' };
            return (
              <span key={`${i}${side}`} style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${lerp(1, 0.3, easeIn(q)).toFixed(4)})`, opacity: Math.min(seg(q, 0, 0.1), 1 - seg(q, 0.85, 1)), whiteSpace: 'nowrap', borderRadius: 999, padding: '12px 22px', background: 'rgba(255,255,255,0.1)', border: `1.5px solid ${k.b}`, fontSize: 28, color: C.ink }}>
                {m.text}
              </span>
            );
          });
        })}

        {/* spend meters */}
        {(['left', 'right'] as const).map((side) => (
          <div key={side} style={{ position: 'absolute', left: side === 'left' ? 120 : 1080, top: 772, width: 720, ...rise(t, 24.5, 0.45, 12) }}>
            <div style={{ fontSize: 22, color: C.ink3, marginBottom: 12 }}>Model spend</div>
            <div style={{ height: 24, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '100%', borderRadius: 999, background: side === 'left' ? `linear-gradient(90deg, ${C.orange}, ${C.bad})` : `linear-gradient(90deg, ${C.teal}, ${C.violet})`, transform: `scaleX(${fill(side).toFixed(4)})`, transformOrigin: 'left' }} />
            </div>
          </div>
        ))}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 862, textAlign: 'center', fontSize: 20, color: C.ink3, ...rise(t, 25, 0.45, 8) }}>Illustration · the spend ratio comes from the demo’s sample traffic</div>
        <Caption t={t} at={27.2} until={29.85}>
          Pay flagship prices <span style={{ color: C.teal }}>only when the turn needs it.</span>
        </Caption>
      </div>
    </Scene>
  );
}

// ---------- 7. Failover (30–36 s) ----------
const FO_HUB: P = { x: 880, y: 540 };
const FO_X = 1240;
const FO_ROWS: { id: ModelId; y: number }[] = [
  { id: 'haiku', y: 410 },
  { id: 'gpt5mini', y: 540 },
  { id: 'gflash', y: 670 },
];

/** Light streaks rushing past, for the build back up to the drop. */
function Warp({ t, strength }: { t: number; strength: number }) {
  if (strength <= 0) return null;
  const r = rng(5);
  return (
    <>
      {Array.from({ length: 40 }, (_, i) => {
        const y = r() * H;
        const len = 120 + r() * 380;
        const sp = 1400 + r() * 2600;
        const off = r() * (W + 600);
        const x = W + 300 - ((off + sp * (t - 34) * (0.4 + strength)) % (W + 600));
        return <span key={i} style={{ position: 'absolute', left: x, top: y, width: len, height: 2, borderRadius: 2, background: 'linear-gradient(90deg, rgba(255,255,255,0.9), transparent)', opacity: 0.1 + 0.5 * strength }} />;
      })}
    </>
  );
}

function Failover({ t }: { t: number }) {
  const f = frameOf(t);
  const rgb = (amt: number) => {
    const d = (noise(f * 1.3) - 0.5) * 2 * amt;
    return `${px(d)} 0 rgba(255,40,90,0.9), ${px(-d)} 0 rgba(0,225,255,0.9)`;
  };
  const bigOut = easeIn(seg(t, 30.78, 31));
  const view = easeOut(seg(t, 30.98, 31.3));
  const inP = easeInOut(seg(t, 31.12, 31.32));
  const out1 = easeInOut(seg(t, 31.33, 31.66));
  const out2 = easeInOut(seg(t, 32.05, 32.38));
  const failed = t >= 31.7;
  const answered = t >= 32.42;
  const push = lerp(1, 1.12, easeIn(seg(t, 33.8, 36)));
  const from = { x: FO_HUB.x + 80, y: FO_HUB.y };
  const rowTo = (i: number) => ({ x: FO_X - 12, y: FO_ROWS[i].y });
  const beat = pulse(t);
  return (
    <Scene t={t} from={30} to={36}>
      <div style={{ position: 'absolute', inset: 0, transform: `${glitchShift(t)} ${shake(t, [31.7], 14, 0.3)} scale(${push.toFixed(4)})`, transformOrigin: `${FO_HUB.x}px ${FO_HUB.y}px` }}>
        <Glows t={t} intensity={0.45} />
        <div style={{ position: 'absolute', left: 560, top: -520, width: 900, height: 900, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(255,93,93,0.4), transparent)', opacity: 1 - 0.75 * seg(t, 32.4, 33.4) }} />
        <div style={{ position: 'absolute', left: 900, top: 380, width: 900, height: 900, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(63,207,142,0.28), transparent)', opacity: seg(t, 32.4, 33) }} />
        <Warp t={t} strength={easeIn(seg(t, 34, 36))} />

        {/* the outage */}
        {t < 31 ? (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 390, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, opacity: 1 - bigOut, transform: `scale(${lerp(1, 0.6, bigOut).toFixed(4)})` }}>
            <span style={{ display: 'inline-block', ...slam(t, 30.02, 0.3, 1.6), fontSize: 136, fontWeight: 600, letterSpacing: '-0.045em', color: C.bad, whiteSpace: 'nowrap', textShadow: rgb(t < 30.7 ? 14 : 3) }}>⚠︎ Provider outage</span>
            <span style={{ ...rise(t, 30.35, 0.35, 14), fontSize: 42, fontWeight: 300, color: C.ink2 }}>In the middle of a live conversation.</span>
          </div>
        ) : null}

        {/* the routing view */}
        {t >= 30.98 ? (
          <div style={{ position: 'absolute', inset: 0, opacity: view }}>
            <div style={{ position: 'absolute', left: 110, top: 92, ...rise(t, 31, 0.4, 10) }}>
              <Pill color={C.bad} border="rgba(255,93,93,0.55)" bg="rgba(255,93,93,0.08)" size={24}>
                ⚠︎ Provider outage
              </Pill>
            </div>
            <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden="true">
              {FO_ROWS.map((_, i) => (
                <path key={i} d={curve(from, rowTo(i))} fill="none" stroke="rgba(244,241,237,0.1)" strokeWidth={2} />
              ))}
              {inP > 0 ? <line x1={590} y1={FO_HUB.y} x2={lerp(590, FO_HUB.x - 80, inP)} y2={FO_HUB.y} stroke={C.ink} strokeOpacity={0.5} strokeWidth={3} strokeLinecap="round" /> : null}
              {out1 > 0 ? <path d={curve(from, rowTo(0))} pathLength={1} fill="none" stroke={failed ? C.bad : C.ink} strokeWidth={4} strokeLinecap="round" strokeDasharray={failed ? '0.04 0.03' : '1 1'} strokeDashoffset={failed ? 0 : 1 - out1} opacity={failed ? 1 - 0.6 * seg(t, 31.7, 32.3) : 1} /> : null}
              {out2 > 0 ? <path d={curve(from, rowTo(1))} pathLength={1} fill="none" stroke={C.ok} strokeWidth={5} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - out2} /> : null}
              {out2 > 0 && out2 < 1 ? <circle {...bez(from, rowTo(1), out2)} r={9} fill="#ffffff" /> : null}
            </svg>
            <div style={{ position: 'absolute', left: 110, top: FO_HUB.y - 64, width: 480, borderRadius: 26, padding: '18px 24px', background: 'rgba(255,255,255,0.09)', border: '1.5px solid rgba(255,255,255,0.2)', transform: `translateX(${px(lerp(-600, 0, easeOut(seg(t, 31, 31.25))))})` }}>
              <div style={{ fontSize: 18, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.ink3, fontWeight: 600 }}>Customer</div>
              <div style={{ marginTop: 6, fontSize: 32 }}>Where is order 55120?</div>
            </div>
            {t >= 32.6 ? (
              <div style={{ position: 'absolute', left: 110, top: FO_HUB.y + 76, width: 480, borderRadius: 26, padding: '16px 22px', background: C.card, border: `1.5px solid rgba(63,207,142,0.45)`, ...rise(t, 32.6, 0.4, 16) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, fontWeight: 600 }}>
                  <Orb model={MODELS.gpt5mini} size={28} /> GPT-5 mini
                </div>
                <div style={{ marginTop: 8, fontSize: 27, lineHeight: 1.3 }}>Order 55120 is out for delivery. It arrives today.</div>
              </div>
            ) : null}

            <div style={{ position: 'absolute', left: FO_HUB.x - 75, top: FO_HUB.y - 75, width: 150, height: 150, transform: `scale(${(1 + 0.05 * beat).toFixed(4)})` }}>
              <Halo size={150} beat={beat} />
              <FilmOrb t={t} size={150} spin={50} />
            </div>
            <div style={{ position: 'absolute', left: FO_HUB.x - 170, width: 340, top: FO_HUB.y + 92, textAlign: 'center', fontSize: 24, fontWeight: 600 }}>ElevenRoute</div>
            {t >= 31.95 ? (
              <div style={{ position: 'absolute', left: FO_HUB.x - 200, width: 400, top: FO_HUB.y + 136, display: 'flex', justifyContent: 'center', transform: `scale(${pop(t, 31.95).toFixed(4)})` }}>
                <Pill color={C.ok} border="rgba(63,207,142,0.55)" size={21}>
                  Failover → another vendor
                </Pill>
              </div>
            ) : null}

            <div style={{ position: 'absolute', left: FO_X + 6, top: 316, fontSize: 22, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.ink3 }}>Ranked for this turn</div>
            {FO_ROWS.map((r, i) => {
              const trying = i === 0 && t >= 31.6 && !failed;
              const dead = i === 0 && failed;
              const won = i === 1 && t >= 32.38;
              const border = dead ? 'rgba(255,93,93,0.65)' : won ? 'rgba(63,207,142,0.7)' : trying ? 'rgba(255,255,255,0.4)' : C.line;
              return (
                <div key={r.id} style={{ position: 'absolute', left: FO_X, top: r.y - 42, width: 580, height: 84, borderRadius: 24, display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px', whiteSpace: 'nowrap', background: won ? 'rgba(63,207,142,0.08)' : dead ? 'rgba(255,93,93,0.06)' : 'rgba(255,255,255,0.03)', border: `1.5px solid ${border}` }}>
                  <span style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 600, color: C.ink2, border: `1.5px solid ${C.line}` }}>{i + 1}</span>
                  <span style={{ display: 'inline-flex', opacity: dead ? 0.45 : 1, filter: dead ? 'grayscale(1)' : undefined }}>
                    <Orb model={MODELS[r.id]} size={44} />
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 28, fontWeight: 500, color: dead ? C.ink3 : C.ink }}>{MODELS[r.id].name}</span>
                    <span style={{ display: 'block', fontSize: 19, color: C.ink3 }}>{MODELS[r.id].maker}</span>
                  </span>
                  {dead ? (
                    <span style={{ display: 'inline-flex', transform: `scale(${pop(t, 31.7, 0.25).toFixed(4)})` }}>
                      <Pill color={C.bad} border="rgba(255,93,93,0.55)" size={20}>
                        ✕ No response
                      </Pill>
                    </span>
                  ) : null}
                  {i === 1 && answered ? (
                    <span style={{ display: 'inline-flex', transform: `scale(${pop(t, 32.42).toFixed(4)})`, borderRadius: 999, background: C.ok, color: C.black, padding: '8px 18px', fontSize: 20, fontWeight: 600 }}>✓ Answered</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <Caption t={t} at={32.9} until={35.7}>
        A provider fails? <span style={{ color: C.ok }}>The same turn is answered by another one.</span>
      </Caption>
    </Scene>
  );
}

// ---------- 8. ElevenAgent (36–46 s) ----------
const CALL: { who: 'c' | 'a'; text: string; at: number; model?: ModelId; kind?: Kind }[] = [
  { who: 'c', text: 'I was charged twice for the same order. I want a refund today.', at: 37 },
  { who: 'a', text: 'Sorry about that. What’s the order number?', at: 38, model: 'sonnet', kind: 'Complex' },
  { who: 'c', text: 'It’s 48213.', at: 39 },
  { who: 'a', text: 'I can see two payments of $64.90. Shall I refund one?', at: 40, model: 'gflash', kind: 'Simple' },
  { who: 'c', text: 'Yes, go ahead.', at: 41 },
  { who: 'a', text: 'Done. Refund RF-48213 is on its way to your card.', at: 42, model: 'gflash', kind: 'Simple' },
];
const SLOTS = [
  { label: 'What went wrong', value: 'Duplicate charge', at: 37.35 },
  { label: 'Order number', value: '48213', at: 39.35 },
  { label: 'Customer’s yes', value: 'Yes', at: 41.35 },
];
const TOOLS = [
  { op: 'Case: look up by order', sys: 'Salesforce Service Cloud · Read', at: 39.55, icon: '☁' },
  { op: 'Billing: list payments', sys: 'SAP S/4HANA · Read', at: 39.8, icon: '▤' },
  { op: 'Billing: post refund', sys: 'SAP S/4HANA · Write', at: 41.55, icon: '▤', write: true },
];

function CallLine({ t, m }: { t: number; m: (typeof CALL)[number] }) {
  const grow = easeOut(seg(t, m.at, m.at + 0.3));
  const flip = seg(t, m.at + 0.05, m.at + 0.5);
  const mine = m.who === 'c';
  return (
    <div style={{ maxHeight: grow * 260, paddingTop: grow * 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', flexShrink: 0 }}>
      <div style={{ maxWidth: 680, borderRadius: 26, padding: '16px 22px', background: mine ? C.ink : C.card, color: mine ? C.black : C.ink, border: mine ? '1.5px solid transparent' : `1.5px solid ${C.line}`, ...rise(t, m.at, 0.35, 22) }}>
        {m.model && m.kind ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, transform: `perspective(600px) rotateX(${lerp(90, 0, backOut(flip)).toFixed(2)}deg)`, transformOrigin: 'top' }}>
            <Orb model={MODELS[m.model]} size={30} />
            <span style={{ fontSize: 21, fontWeight: 600 }}>{MODELS[m.model].name}</span>
            <KindPill kind={m.kind} size={16} />
          </div>
        ) : null}
        <div style={{ fontSize: 27, lineHeight: 1.35 }}>{m.text}</div>
      </div>
    </div>
  );
}

function AgentCall({ t }: { t: number }) {
  const punch = 1 + 0.08 * (1 - backOut(seg(t, 36, 36.5)));
  const beat = pulse(t);
  const fade = 'linear-gradient(to bottom, transparent 0, #000 90px)';
  return (
    <Scene t={t} from={36} to={46 + WHIP / 2} style={whip(t, 46, 'out')}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${punch.toFixed(4)})` }}>
        <Glows t={t} intensity={0.55 + 0.3 * beat} />
        <Shock t={t} at={36} x={960} y={540} size={420} color={C.violet} />
        <Burst t={t} at={36} x={960} y={540} n={40} seed={17} power={0.8} />
        <div style={{ position: 'absolute', left: 120, top: 92, fontSize: 62, fontWeight: 300, letterSpacing: '-0.035em', whiteSpace: 'nowrap', ...slam(t, 36.15, 0.3, 1.3) }}>
          <span style={{ fontWeight: 600, color: '#c9bcff' }}>ElevenAgent</span> runs the whole call.
        </div>

        {/* the call */}
        <div style={{ position: 'absolute', left: 120, top: 220, width: 840, height: 680, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden', WebkitMaskImage: fade, maskImage: fade }}>
          {CALL.filter((m) => t >= m.at).map((m) => (
            <CallLine key={m.at} t={t} m={m} />
          ))}
        </div>

        {/* what it knows, what it does */}
        <div style={{ position: 'absolute', left: 1040, top: 236, width: 760, ...rise(t, 36.4, 0.5, 18) }}>
          <div style={{ fontSize: 22, color: C.ink3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>What ElevenAgent knows</div>
          <div style={{ marginTop: 14, borderRadius: 26, border: `1.5px solid ${C.line}`, background: C.card }}>
            {SLOTS.map((s, i) => {
              const got = t >= s.at;
              const sp = seg(t, s.at, s.at + 0.5);
              return (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '18px 24px', borderTop: i ? `1.5px solid ${C.line}` : undefined }}>
                  <span style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
                    {got && sp < 1
                      ? [0, 1, 2, 3, 4, 5].map((j) => (
                          <span key={j} style={{ position: 'absolute', left: 15, top: 15, width: 16, height: 3, borderRadius: 2, background: C.ok, opacity: 1 - sp, transform: `rotate(${j * 60}deg) translateX(${px(18 + 22 * easeOut(sp))})`, transformOrigin: '0 50%' }} />
                        ))
                      : null}
                    <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 19, fontWeight: 700, background: got ? C.ok : 'transparent', color: C.black, border: got ? 'none' : `2px dashed ${C.ink3}`, transform: `scale(${(got ? pop(t, s.at, 0.35) : 1).toFixed(4)})` }}>{got ? '✓' : ''}</span>
                  </span>
                  <span>
                    <span style={{ display: 'block', fontSize: 19, color: C.ink3 }}>{s.label}</span>
                    <span style={{ display: 'block', fontSize: 27, fontWeight: got ? 600 : 400, color: got ? C.ink : C.ink3 }}>{got ? s.value : 'Not known yet'}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 22, color: C.ink3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>What it does</span>
            <span style={{ fontSize: 17, color: C.ink3, letterSpacing: '0.06em', textTransform: 'uppercase', border: `1.5px dashed ${C.ink3}`, borderRadius: 999, padding: '3px 12px' }}>Sample connectors</span>
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TOOLS.map((x) => {
              const on = t >= x.at;
              const ping = on ? seg(t, x.at, x.at + 0.8) : 0;
              const waiting = x.write && !on;
              return (
                <div key={x.op} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '12px 20px', borderRadius: 22, background: on ? 'rgba(255,255,255,0.07)' : 'transparent', border: `1.5px solid ${on ? 'rgba(255,255,255,0.18)' : 'transparent'}` }}>
                  <span style={{ position: 'relative', width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, background: on ? C.ink : 'rgba(255,255,255,0.07)', color: on ? C.black : C.ink3, fontSize: 20 }}>
                    {on ? <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${C.ink}`, opacity: 0.6 * (1 - ping), transform: `scale(${(1 + ping).toFixed(4)})` }} /> : null}
                    {x.icon}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 25, fontWeight: on ? 600 : 400, color: on ? C.ink : C.ink2 }}>{x.op}</span>
                    <span style={{ display: 'block', fontSize: 19, color: C.ink3 }}>{x.sys}</span>
                  </span>
                  {waiting ? (
                    <Pill size={17} color={C.ink3}>
                      Waits for a yes
                    </Pill>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Caption t={t} at={43} until={45.75}>
        The model can change every turn. <span style={{ color: '#c9bcff' }}>The call never forgets.</span>
      </Caption>
    </Scene>
  );
}

// ---------- 9. Features (46–52 s) ----------
const FEATURES = [
  { title: 'Smart routing', body: 'Simple turns go to fast models. Hard turns get the strongest.' },
  { title: 'Automatic failover', body: 'If a provider fails, another one answers the same turn.' },
  { title: 'Quality tests', body: 'Every model is tested on the same conversations. Below your bar, it’s out.' },
  { title: 'Customer policies', body: 'Vendor and region rules for each of your customers.' },
];
const CARD = { w: 390, h: 470, gap: 32, top: 330 };
const cardLeft = (i: number) => 960 - (4 * CARD.w + 3 * CARD.gap) / 2 + i * (CARD.w + CARD.gap);

/** Each feature's icon, animated on a loop. */
function FeatureIcon({ t, i }: { t: number; i: number }) {
  const stroke = { fill: 'none', strokeWidth: 4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (i === 0) {
    // a line that forks: turns travel up to the fast branch or down to the strong one, alternately on the beat
    const u = (t * 2) % 1;
    const up = Math.floor(t * 2) % 2 === 0;
    const end = up ? 25 : 75;
    const dot = u < 0.35 ? { x: lerp(10, 40, u / 0.35), y: 50 } : u < 0.75 ? bez({ x: 40, y: 50 }, { x: 70, y: end }, (u - 0.35) / 0.4) : { x: lerp(70, 90, (u - 0.75) / 0.25), y: end };
    return (
      <svg width={96} height={96} viewBox="0 0 100 100" aria-hidden="true">
        <path d="M10 50 H40" stroke={C.ink2} {...stroke} />
        <path d={`${curve({ x: 40, y: 50 }, { x: 70, y: 25 })} H90`} stroke={C.simple} {...stroke} />
        <path d={`${curve({ x: 40, y: 50 }, { x: 70, y: 75 })} H90`} stroke={C.complex} {...stroke} />
        <circle cx={dot.x} cy={dot.y} r={6.5} fill="#ffffff" />
      </svg>
    );
  }
  if (i === 1) {
    // try the first provider, it fails, the turn goes to the next one
    const u = (t % 2) / 2;
    const a = seg(u, 0, 0.25);
    const b = seg(u, 0.45, 0.7);
    return (
      <svg width={96} height={96} viewBox="0 0 100 100" aria-hidden="true">
        <circle cx={16} cy={50} r={7} fill={C.ink2} />
        <path d={curve({ x: 16, y: 50 }, { x: 78, y: 24 })} pathLength={1} stroke={u > 0.25 ? C.bad : C.ink2} strokeDasharray="1 1" strokeDashoffset={1 - a} {...stroke} />
        <path d={curve({ x: 16, y: 50 }, { x: 78, y: 76 })} pathLength={1} stroke={C.ok} strokeDasharray="1 1" strokeDashoffset={1 - b} {...stroke} />
        <circle cx={84} cy={24} r={9} stroke={u > 0.25 ? C.bad : C.ink2} {...stroke} />
        {u > 0.25 ? <path d="M80 20 L88 28 M88 20 L80 28" stroke={C.bad} {...stroke} strokeWidth={3} /> : null}
        <circle cx={84} cy={76} r={9} stroke={u > 0.7 ? C.ok : C.ink2} {...stroke} />
        {u > 0.7 ? <path d="M79.5 76 L83 79.5 L89 72.5" stroke={C.ok} {...stroke} strokeWidth={3} /> : null}
      </svg>
    );
  }
  if (i === 2) {
    // scores rise; the one under the quality bar dims out
    const u = (t % 2.5) / 2.5;
    const g = easeOut(seg(u, 0, 0.35));
    const scores = [0.82, 0.62, 0.9, 0.38];
    return (
      <svg width={96} height={96} viewBox="0 0 100 100" aria-hidden="true">
        {scores.map((s, j) => {
          const out = s < 0.5 && u > 0.45;
          return <rect key={j} x={12 + j * 21} y={88 - 72 * s * g} width={13} height={72 * s * g} rx={3} fill={out ? 'rgba(255,93,93,0.35)' : j % 2 ? C.teal : C.violet} />;
        })}
        <path d="M6 52 H94" stroke={C.ink} strokeWidth={2.5} strokeDasharray="5 4" fill="none" />
      </svg>
    );
  }
  // a shield with a check that draws itself, and a ring going out
  const u = (t % 2) / 2;
  return (
    <svg width={96} height={96} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx={50} cy={50} r={30 + 18 * u} fill="none" stroke={C.teal} strokeOpacity={0.5 * (1 - u)} strokeWidth={2} />
      <path d="M50 12 L80 24 V48 C80 68 66 82 50 88 C34 82 20 68 20 48 V24 Z" stroke={C.ink2} {...stroke} />
      <path d="M36 50 L46 60 L65 40" pathLength={1} stroke={C.teal} strokeDasharray="1 1" strokeDashoffset={1 - easeOut(seg(u, 0.1, 0.45))} {...stroke} strokeWidth={5} />
    </svg>
  );
}

function Features({ t }: { t: number }) {
  const beat = pulse(t);
  const sweepX = lerp(-500, W + 500, easeInOut(seg(t, 49.4, 50.6)));
  const headOut = easeIn(seg(t, 51.5, 51.95));
  return (
    <Scene t={t} from={46 - WHIP / 2} to={52} style={whip(t, 46, 'in')}>
      <Glows t={t} intensity={0.7 + 0.35 * beat} />
      <Sparkles t={t} seed={31} n={30} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', opacity: 1 - headOut, transform: `translateY(${px(-80 * headOut)})` }}>
        <span style={{ display: 'inline-block', fontSize: 76, fontWeight: 300, letterSpacing: '-0.035em', ...slam(t, 46.25, 0.3, 1.4) }}>Built for real customer service.</span>
      </div>
      {FEATURES.map((c, i) => {
        const at = 46.5 + i * 0.5;
        const inP = seg(t, at, at + 0.5);
        const outP = easeIn(seg(t, 51.4 + i * 0.1, 51.75 + i * 0.1));
        if (t < at) return null;
        const rot = lerp(-95, 0, backOut(inP)) + 95 * outP;
        return (
          <div key={c.title} style={{ position: 'absolute', left: cardLeft(i), top: CARD.top, width: CARD.w, height: CARD.h, borderRadius: 30, overflow: 'hidden', padding: 36, background: 'rgba(255,255,255,0.055)', border: `1.5px solid ${C.line}`, opacity: Math.min(seg(inP, 0, 0.3), 1 - outP), transform: `perspective(1600px) rotateY(${rot.toFixed(2)}deg) scale(${(1 + 0.012 * beat).toFixed(4)})` }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 260, left: sweepX - cardLeft(i) - 130, background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.12), transparent)' }} />
            <div style={{ width: 120, height: 120, borderRadius: 30, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.05)', border: `1.5px solid ${C.line}` }}>
              <FeatureIcon t={t} i={i} />
            </div>
            <div style={{ marginTop: 40, fontSize: 38, fontWeight: 500, letterSpacing: '-0.02em' }}>{c.title}</div>
            <div style={{ marginTop: 16, fontSize: 26, lineHeight: 1.38, color: C.ink2 }}>{c.body}</div>
          </div>
        );
      })}
    </Scene>
  );
}

// ---------- 10. Same quality bar, less spend (52–56 s) ----------
function Savings({ t }: { t: number }) {
  const beat = pulse(t);
  const a = easeOut(seg(t, 53, 53.6));
  const b = easeOut(seg(t, 53.35, 54.1));
  const bars = [
    { label: 'Every turn on the best allowed model', w: 1, p: a, color: 'rgba(244,241,237,0.35)', at: 52.9 },
    { label: 'ElevenRoute, turn by turn', w: SAMPLE_RATIO, p: b, color: `linear-gradient(90deg, ${C.teal}, ${C.violet})`, at: 53.2 },
  ];
  return (
    <Scene t={t} from={52} to={56 + WHIP / 2} style={whip(t, 56, 'out', 'y')}>
      <Glows t={t} intensity={0.8 + 0.4 * beat} />
      <Burst t={t} at={52.5} x={960} y={400} n={36} seed={23} power={0.7} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 170, textAlign: 'center', fontSize: 112, letterSpacing: '-0.045em', lineHeight: 1.1, whiteSpace: 'nowrap' }}>
        <div>
          <span style={{ display: 'inline-block', fontWeight: 300, ...slam(t, 52) }}>Same quality bar.</span>
        </div>
        <div>
          <span style={{ display: 'inline-block', fontWeight: 600, color: C.teal, textShadow: `0 0 ${(40 + 50 * beat).toFixed(0)}px rgba(63,193,180,${(0.3 + 0.35 * beat).toFixed(3)})`, ...slam(t, 52.5) }}>Less spend.</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 320, top: 520, width: 1280, display: 'flex', flexDirection: 'column', gap: 40 }}>
        {bars.map((x) => (
          <div key={x.label} style={rise(t, x.at, 0.45, 16)}>
            <div style={{ fontSize: 30, color: C.ink2 }}>{x.label}</div>
            <div style={{ marginTop: 14, height: 42, width: 1280, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${x.w * 100}%`, borderRadius: 999, background: x.color, transform: `scaleX(${x.p.toFixed(4)})`, transformOrigin: 'left' }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 320, top: 838, fontSize: 21, color: C.ink3, ...rise(t, 54.1, 0.5, 10) }}>Illustration from the demo’s sample traffic. Your traffic and prices give your own numbers.</div>
    </Scene>
  );
}

// ---------- 11. Payoff (56–60 s) ----------
function Reactions({ t, at }: { t: number; at: number }) {
  const items = [
    { e: '🔥', n: 2 },
    { e: '🙌', n: 1 },
    { e: '💯', n: 1 },
  ];
  return (
    <div style={{ display: 'flex', gap: 12, marginLeft: 82, minHeight: 48 }}>
      {items.map((r, i) =>
        t >= at + i * 0.12 ? (
          <span key={r.e} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, background: '#eef0ff', border: '1.5px solid #c9d1ff', padding: '4px 14px', fontSize: 24, color: '#1d2a7a', transform: `scale(${pop(t, at + i * 0.12, 0.3).toFixed(4)})` }}>
            {r.e} {r.n}
          </span>
        ) : null,
      )}
    </div>
  );
}

/** A confetti popper: paper and emoji fired up and inwards from a bottom corner, falling under gravity. */
function Confetti({ t, at, x, y, dir, seed }: { t: number; at: number; x: number; y: number; dir: 1 | -1; seed: number }) {
  const age = t - at;
  if (age < 0 || age > 2.2) return null;
  const r = rng(seed);
  const colors = [C.violet, C.teal, C.orange, '#ffd23f', '#0447ff'];
  const emoji = ['🎉', '✨', '💸', '🙌'];
  return (
    <div style={{ position: 'absolute', left: x, top: y }}>
      {Array.from({ length: 40 }, (_, i) => {
        const vx = dir * (250 + r() * 1100);
        const vy = -1500 - r() * 1100;
        const rot = r() * 360;
        const vr = (r() - 0.5) * 900;
        const e = r() < 0.3 ? emoji[Math.floor(r() * emoji.length)] : null;
        const c = colors[Math.floor(r() * colors.length)];
        const w = 10 + r() * 10;
        const h = 6 + r() * 8;
        const drag = (1 - Math.exp(-1.6 * age)) / 1.6;
        const cx = vx * drag;
        const cy = vy * drag + 0.5 * 1900 * age * age;
        const o = 1 - seg(age, 1.5, 2.2);
        return e ? (
          <span key={i} style={{ position: 'absolute', left: cx, top: cy, fontSize: 40, opacity: o, transform: `rotate(${(rot + vr * age * 0.3).toFixed(1)}deg)` }}>
            {e}
          </span>
        ) : (
          <span key={i} style={{ position: 'absolute', left: cx, top: cy, width: w, height: h, borderRadius: 2, background: c, opacity: o, transform: `rotate(${(rot + vr * age).toFixed(1)}deg)` }} />
        );
      })}
    </div>
  );
}

function Payoff({ t }: { t: number }) {
  const push = easeInOut(seg(t, 58.5, 60));
  return (
    <Scene t={t} from={56 - WHIP / 2} to={60} style={whip(t, 56, 'in', 'y')}>
      <div style={{ position: 'absolute', inset: 0, background: LIGHT_BG, transform: `scale(${lerp(1, 1.4, push).toFixed(4)})`, transformOrigin: '520px 480px' }}>
        <LightGlows />
        <ChatWindow top={190}>
          <Message who="Omar" role="CFO" color="#4a4541" style={rise(t, 56.3, 0.35, 18)}>
            <span style={{ color: '#0447ff', fontWeight: 500 }}>@Lina</span> how did you cut the bill without hurting quality?? 🤯
          </Message>
          <Reply t={t} typingFrom={56.95} at={57.7} text="ElevenRoute 😉" />
          <Reactions t={t} at={58} />
        </ChatWindow>
        <Confetti t={t} at={58} x={150} y={1120} dir={1} seed={11} />
        <Confetti t={t} at={58.06} x={1770} y={1120} dir={-1} seed={12} />
      </div>
    </Scene>
  );
}

// ---------- 12. End card (60–64 s) ----------
/** The end card's lockup (the 140 px wordmark is 754 px wide in a render). */
const END = { orb: 170, gap: 36, word: 754, y: 390 };
const END_LEFT = 960 - (END.orb + END.gap + END.word) / 2;
const END_ORB_X = END_LEFT + END.orb / 2;

function EndCard({ t }: { t: number }) {
  const breathe = 1 + 0.025 * Math.sin((t - 60) * 2.6) + 0.04 * pulse(t);
  const btn = pop(t, 61, 0.4);
  const shimmer = seg(t, 61.7, 62.4);
  return (
    <Scene t={t} from={60} to={STORY_SECONDS + 1} style={{ opacity: 1 - easeInOut(seg(t, 63.25, 63.95)) }}>
      <Glows t={t} intensity={1} />
      <Rays t={t} strength={0.3} cx={END_ORB_X} cy={END.y} />
      <Sparkles t={t} seed={21} n={50} />
      <Shock t={t} at={60} x={END_ORB_X} y={END.y} size={240} />
      <Shock t={t} at={60.1} x={END_ORB_X} y={END.y} size={240} color={C.violet} />
      <Burst t={t} at={60} x={END_ORB_X} y={END.y} n={48} seed={9} power={0.8} />
      <div style={{ position: 'absolute', left: END_ORB_X - END.orb / 2, top: END.y - END.orb / 2, width: END.orb, height: END.orb, transform: `scale(${(pop(t, 60, 0.45) * breathe).toFixed(4)})` }}>
        <Halo size={END.orb} beat={0.4 + 0.3 * Math.sin((t - 60) * 2.6)} />
        <FilmOrb t={t} size={END.orb} />
      </div>
      <Wordmark t={t} at={60.15} left={END_LEFT + END.orb + END.gap} top={END.y - 72} size={140} step={0.04} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 540, textAlign: 'center', fontSize: 46, fontWeight: 300, letterSpacing: '-0.02em', color: C.ink2, ...rise(t, 60.55, 0.6, 16) }}>Smart where it matters. Cheap where it doesn’t.</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 650, display: 'flex', justifyContent: 'center' }}>
        {t >= 61 ? (
          <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 14, borderRadius: 999, background: C.ink, color: C.black, padding: '28px 58px', fontSize: 40, fontWeight: 500, transform: `scale(${btn.toFixed(4)})`, boxShadow: `0 0 ${(60 + 30 * Math.sin((t - 61) * 3)).toFixed(0)}px rgba(122,92,255,0.45)` }}>
            Play a live call <span style={{ fontSize: 42 }}>→</span>
            {shimmer > 0 && shimmer < 1 ? <span style={{ position: 'absolute', top: 0, bottom: 0, width: 120, left: `${lerp(-30, 120, easeInOut(shimmer)).toFixed(2)}%`, background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.85), transparent)' }} /> : null}
          </div>
        ) : null}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 820, textAlign: 'center', fontSize: 26, color: C.ink3, ...rise(t, 61.4, 0.6, 10) }}>ElevenAgent + ElevenRoute · AI customer service</div>
    </Scene>
  );
}
