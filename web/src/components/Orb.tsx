import { useEffect, useId, useRef, type CSSProperties } from 'react';

import type { ModelInfo, VendorState } from '../../../shared/types';
import { usePhase } from '../lib/anime';
import { EMBER, INK3, VENDOR_COLORS, VIOLET } from '../lib/theme';

type OrbModel = Pick<ModelInfo, 'vendor' | 'tier'> | undefined;

/** Custom properties set inline (React's CSSProperties type doesn't know them). */
type OrbVars = CSSProperties & Record<`--orb-${string}`, string>;
const ms = (n: number) => `${Math.round(n)}ms`;

/**
 * Pauses an orb's CSS loops while it is well off-screen, so a long page full of orbs lets the compositor rest.
 * The loops themselves are CSS keyframes (index.css, "Living orbs"), so they never run JavaScript per frame.
 */
function useOffscreenPause<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => el.toggleAttribute('data-orb-paused', !entry.isIntersecting), { rootMargin: '160px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/**
 * Abstract gradient "orb" identifying a model by vendor and tier.
 * `live` makes it a living orb: it drifts, breathes and its light turns.
 * Pass the vendor's state so the motion tells the truth: slow providers move sluggishly, down ones stop and fade.
 * `ping` adds a heartbeat ring (use it once per provider, not on every model).
 */
export function Orb({ model, size = 28, className, live, ping = false }: { model: OrbModel; size?: number; className?: string; live?: boolean | VendorState; ping?: boolean }) {
  if (!live) return <OrbSvg model={model} size={size} className={className} />;
  return <LiveOrb model={model} size={size} className={className} state={live === true ? 'healthy' : live} ping={ping} />;
}

// ---- ElevenRoute's own orb: a black sphere lit by the three providers it routes to ----
/** Provider glows, tuned to read on black: OpenAI teal, Google violet, Anthropic orange. */
const BRAND_GLOWS = [
  { color: '#3fc1b4', cx: 74, cy: 22 },
  { color: '#7a5cff', cx: 80, cy: 76 },
  { color: '#ff6a2b', cx: 18, cy: 66 },
] as const;

function BrandBase({ id }: { id: string }) {
  return (
    <>
      <radialGradient id={`bb${id}`} cx="32%" cy="26%" r="85%">
        <stop offset="0" stopColor="#4a4643" />
        <stop offset="0.35" stopColor="#161413" />
        <stop offset="1" stopColor="#000" />
      </radialGradient>
      {BRAND_GLOWS.map((g, i) => (
        <radialGradient key={i} id={`bg${i}${id}`} cx={`${g.cx}%`} cy={`${g.cy}%`} r="34%">
          <stop offset="0" stopColor={g.color} stopOpacity={0.85} />
          <stop offset="0.5" stopColor={g.color} stopOpacity={0.2} />
          <stop offset="1" stopColor={g.color} stopOpacity={0} />
        </radialGradient>
      ))}
    </>
  );
}

const glowCircles = (id: string) => BRAND_GLOWS.map((_, i) => <circle key={i} cx="50" cy="50" r="48" fill={`url(#bg${i}${id})`} />);

/**
 * ElevenRoute's logo orb. Live: the three provider glows slowly circle the sphere (traffic going round to every
 * vendor) and the highlight turns the other way. By default it also drifts and breathes like the provider orbs.
 * `outline` draws a thin ring around the ball, with the ball inset inside it. `beat` replaces the drift with a
 * heartbeat (a quick double pulse, then a rest); ring and ball beat together, so the ball never leaves its outline.
 */
export function BrandOrb({ size = 28, live = false, ping = false, drift = true, beat = false, outline = false, className = '' }: { size?: number; live?: boolean; ping?: boolean; drift?: boolean; beat?: boolean; outline?: boolean; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const phase = usePhase();
  const root = useOffscreenPause<HTMLSpanElement>();
  // With an outline, the ball sits inside the ring with a small gap.
  const gap = outline ? Math.max(2, Math.round(size * 0.08)) : 0;
  const inner = size - gap * 2;

  const ring = outline ? (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 22%, transparent)' }} />
  ) : null;

  if (!live) {
    const ball = (
      <svg width={inner} height={inner} viewBox="0 0 100 100" className={outline ? 'absolute' : className} style={outline ? { inset: gap } : undefined} aria-hidden="true">
        <defs>
          <BrandBase id={id} />
          <radialGradient id={`bs${id}`} cx="34%" cy="28%" r="18%">
            <stop offset="0" stopColor="#fff" stopOpacity={0.75} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill={`url(#bb${id})`} />
        {glowCircles(id)}
        <circle cx="50" cy="50" r="48" fill={`url(#bs${id})`} />
      </svg>
    );
    if (!outline) return ball;
    return (
      <span aria-hidden="true" className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
        {ring}
        {ball}
      </span>
    );
  }

  // drift={false} keeps the ball fixed (inside a ring or a badge); its lights still turn. A beat replaces the drift.
  const drifting = drift && !beat;
  const dy = 1900 + phase * 600;
  const dx = 2800 + phase * 900;
  const vars: OrbVars = {
    inset: gap,
    '--orb-dy': ms(dy),
    '--orb-dy-delay': ms(-phase * dy),
    '--orb-dx': ms(dx),
    '--orb-dx-delay': ms(-phase * dx),
    '--orb-db': '2300ms',
  };

  return (
    <span ref={root} aria-hidden="true" className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      {ping ? <span className={`absolute inset-0 rounded-full opacity-0 ${beat ? 'orb-beat-ping' : 'orb-ping'}`} style={{ border: '1.5px solid var(--color-ink)', '--orb-ping': '2600ms' } as OrbVars} /> : null}
      <span className={`absolute inset-0 block ${beat ? 'orb-beat' : ''}`}>
        {ring}
        <span className={`absolute block ${drifting ? 'orb-dy' : ''}`} style={vars}>
          <span className={`absolute inset-0 block overflow-hidden rounded-full ${drifting ? 'orb-dx' : ''}`}>
            <svg width={inner} height={inner} viewBox="0 0 100 100" className="block" aria-hidden="true">
              <defs>
                <BrandBase id={id} />
              </defs>
              <circle cx="50" cy="50" r="48" fill={`url(#bb${id})`} />
            </svg>
            <span className="orb-spin absolute inset-0 block" style={{ '--orb-spin': '14000ms' } as OrbVars}>
              <svg width={inner} height={inner} viewBox="0 0 100 100" className="block" aria-hidden="true">
                <defs>
                  <BrandBase id={`${id}g`} />
                </defs>
                {glowCircles(`${id}g`)}
              </svg>
            </span>
            <span
              className="orb-spin-rev absolute inset-0 rounded-full"
              style={{ '--orb-spin': '9000ms', background: 'radial-gradient(circle at 33% 27%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.15) 12%, rgba(255,255,255,0) 26%)' } as OrbVars}
            />
          </span>
        </span>
      </span>
    </span>
  );
}

function colors(model: OrbModel) {
  return {
    base: model ? VENDOR_COLORS[model.vendor][model.tier] : INK3,
    accent: model?.vendor === 'anthropic' || model?.tier === 'fast' ? EMBER : VIOLET,
  };
}

function OrbSvg({ model, size, className, shine = true }: { model: OrbModel; size: number; className?: string; shine?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { base, accent } = colors(model);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`g${id}`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#fff" stopOpacity={shine ? 0.95 : 0.25} />
          <stop offset="0.35" stopColor={base} stopOpacity={0.9} />
          <stop offset="0.8" stopColor={base} />
          <stop offset="1" stopColor={accent} />
        </radialGradient>
        <radialGradient id={`h${id}`} cx="72%" cy="78%" r="40%">
          <stop offset="0" stopColor={accent} stopOpacity={0.55} />
          <stop offset="1" stopColor={accent} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#g${id})`} />
      <circle cx="50" cy="50" r="48" fill={`url(#h${id})`} />
    </svg>
  );
}

function LiveOrb({ model, size, className = '', state, ping }: { model: OrbModel; size: number; className?: string; state: VendorState; ping: boolean }) {
  const { base } = colors(model);
  const phase = usePhase();
  const root = useOffscreenPause<HTMLSpanElement>();
  const down = state === 'down'; // a down provider sits still
  // A slow provider moves at 0.4× speed: every period is 2.5× longer.
  const k = state === 'slow' ? 2.5 : 1;
  // Two drifts with unrelated periods trace a wandering path that never visibly repeats.
  const dy = (1700 + phase * 600) * k;
  const dx = (2600 + phase * 900) * k;
  const db = (2200 + phase * 400) * k;
  const vars: OrbVars = {
    '--orb-dy': ms(dy),
    '--orb-dy-delay': ms(-phase * dy),
    '--orb-dx': ms(dx),
    '--orb-dx-delay': ms(-phase * dx),
    '--orb-db': ms(db),
  };

  return (
    <span
      ref={root}
      aria-hidden="true"
      // Only the opacity fades; the greyscale switches at once (CSS filters are never animated here).
      className={`relative inline-block shrink-0 transition-opacity duration-300 ${down ? 'opacity-50 grayscale' : ''} ${className}`}
      style={{ width: size, height: size }}>
      {ping && !down ? (
        <span className="orb-ping absolute inset-0 rounded-full opacity-0" style={{ border: `1.5px solid ${base}`, '--orb-ping': ms(2400 * k), '--orb-ping-delay': ms(-phase * 2400 * k) } as OrbVars} />
      ) : null}
      <span className={`absolute inset-0 block ${down ? '' : 'orb-dy'}`} style={vars}>
        <span className={`absolute inset-0 block overflow-hidden rounded-full ${down ? '' : 'orb-dx'}`}>
          <OrbSvg model={model} size={size} shine={false} className="block" />
          {/* The highlight orbits the sphere, so it reads as a turning ball rather than a flat disc. */}
          <span
            className={`absolute inset-0 rounded-full ${down ? '' : 'orb-spin'}`}
            style={{ '--orb-spin': ms((7000 + phase * 3000) * k), background: 'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.35) 22%, rgba(255,255,255,0) 48%)' } as OrbVars}
          />
        </span>
      </span>
    </span>
  );
}
