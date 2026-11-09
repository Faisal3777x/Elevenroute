import { animate } from 'animejs';
import { useId } from 'react';

import type { ModelInfo, VendorState } from '../../../shared/types';
import { useAnime, usePhase } from '../lib/anime';
import { EMBER, INK3, VENDOR_COLORS, VIOLET } from '../lib/theme';

type OrbModel = Pick<ModelInfo, 'vendor' | 'tier'> | undefined;

/**
 * Abstract gradient "orb" identifying a model by vendor and tier.
 * `live` makes it a living orb (anime.js): it drifts, breathes and its light turns.
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
  // With an outline, the ball sits inside the ring with a small gap.
  const gap = outline ? Math.max(2, Math.round(size * 0.08)) : 0;
  const inner = size - gap * 2;
  const root = useAnime<HTMLSpanElement>(() => {
    if (!live) return;
    const amp = Math.max(1.5, size * 0.08);
    const common = { loop: true, alternate: true, ease: 'inOutSine' } as const;
    if (beat) {
      // Lub-dub, then rest: about 50 beats a minute. The ping ring (if any) leaves on the first beat.
      const period = 1250;
      animate('[data-orb-beat]', {
        scale: [
          { to: 1.075, duration: 140, ease: 'outQuad' },
          { to: 0.985, duration: 130, ease: 'inOutQuad' },
          { to: 1.045, duration: 130, ease: 'outQuad' },
          { to: 1, duration: 340, ease: 'inOutSine' },
        ],
        loop: true,
        loopDelay: period - 740,
      });
      if (ping) animate('[data-orb-ping]', { scale: [1, 1.6], opacity: [0.45, 0], duration: period, loop: true, ease: 'outQuad' });
    } else if (drift) {
      // drift={false} keeps the ball fixed (inside a ring or a badge); its lights still turn.
      animate('[data-orb-body]', { y: [amp * 0.4, -amp], duration: 1900 + phase * 600, delay: phase * 900, ...common });
      animate('[data-orb-body]', { x: [-amp * 0.4, amp * 0.4], duration: 2800 + phase * 900, delay: phase * 1300, ...common });
      animate('[data-orb-body]', { scale: [0.97, 1.04], duration: 2300, ...common });
    }
    animate('[data-orb-glow]', { rotate: 360, duration: 14000, loop: true, ease: 'linear' });
    animate('[data-orb-shine]', { rotate: -360, duration: 9000, loop: true, ease: 'linear' });
    if (ping && !beat) animate('[data-orb-ping]', { scale: [1, 1.75], opacity: [0.4, 0], duration: 2600, loop: true, ease: 'outQuad' });
  }, [live, size, ping, drift, beat]);

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

  return (
    <span ref={root} aria-hidden="true" className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      {ping ? <span data-orb-ping className="absolute inset-0 rounded-full opacity-0" style={{ border: '1.5px solid var(--color-ink)' }} /> : null}
      <span data-orb-beat className="absolute inset-0 block will-change-transform">
        {ring}
        <span data-orb-body className="absolute block overflow-hidden rounded-full will-change-transform" style={{ inset: gap }}>
          <svg width={inner} height={inner} viewBox="0 0 100 100" className="block" aria-hidden="true">
            <defs>
              <BrandBase id={id} />
            </defs>
            <circle cx="50" cy="50" r="48" fill={`url(#bb${id})`} />
          </svg>
          <span data-orb-glow className="absolute inset-0 block">
            <svg width={inner} height={inner} viewBox="0 0 100 100" className="block" aria-hidden="true">
              <defs>
                <BrandBase id={`${id}g`} />
              </defs>
              {glowCircles(`${id}g`)}
            </svg>
          </span>
          <span
            data-orb-shine
            className="absolute inset-0 rounded-full"
            style={{ background: 'radial-gradient(circle at 33% 27%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.15) 12%, rgba(255,255,255,0) 26%)' }}
          />
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
  const down = state === 'down';

  const root = useAnime<HTMLSpanElement>(() => {
    if (down) return; // a down provider sits still
    const rate = state === 'slow' ? 0.4 : 1;
    const amp = Math.max(1.5, size * 0.09);
    const common = { loop: true, alternate: true, ease: 'inOutSine', playbackRate: rate } as const;
    // Two drifts with unrelated periods trace a wandering path that never visibly repeats.
    animate('[data-orb-body]', { y: [amp * 0.4, -amp], duration: 1700 + phase * 600, delay: phase * 900, ...common });
    animate('[data-orb-body]', { x: [-amp * 0.45, amp * 0.45], duration: 2600 + phase * 900, delay: phase * 1300, ...common });
    animate('[data-orb-body]', { scale: [0.97, 1.04], duration: 2200 + phase * 400, ...common });
    // The highlight orbits the sphere, so it reads as a turning ball rather than a flat disc.
    animate('[data-orb-shine]', { rotate: 360, duration: 7000 + phase * 3000, loop: true, ease: 'linear', playbackRate: rate });
    if (ping) {
      animate('[data-orb-ping]', { scale: [1, 1.75], opacity: [0.45, 0], duration: 2400, delay: phase * 1200, loop: true, ease: 'outQuad', playbackRate: rate });
    }
  }, [state, size, ping]);

  return (
    <span
      ref={root}
      aria-hidden="true"
      className={`relative inline-block shrink-0 transition-[opacity,filter] duration-300 ${down ? 'opacity-50 grayscale' : ''} ${className}`}
      style={{ width: size, height: size }}>
      {ping && !down ? <span data-orb-ping className="absolute inset-0 rounded-full opacity-0" style={{ border: `1.5px solid ${base}` }} /> : null}
      <span data-orb-body className="absolute inset-0 block overflow-hidden rounded-full will-change-transform">
        <OrbSvg model={model} size={size} shine={false} className="block" />
        <span
          data-orb-shine
          className="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.35) 22%, rgba(255,255,255,0) 48%)' }}
        />
      </span>
    </span>
  );
}
