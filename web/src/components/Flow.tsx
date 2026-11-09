import { animate, stagger } from 'animejs';
import { ArrowRight } from 'lucide-react';

import type { Vendor } from '../../../shared/types';
import { useAnime, usePhase } from '../lib/anime';
import { LINE, VENDOR_COLORS, VENDOR_ORDER, VENDOR_SHORT } from '../lib/theme';
import { BrandOrb, Orb } from './Orb';

/**
 * A dashed track with packets streaming along it (anime.js): traffic moving from one place to another.
 * With reduced motion only the static track is drawn.
 */
export function FlowTrack({ color, width = 48, packets = 3, speed = 1, className = '' }: { color: string; width?: number; packets?: number; speed?: number; className?: string }) {
  const phase = usePhase();
  const root = useAnime<HTMLSpanElement>(() => {
    animate('[data-packet]', {
      x: [0, width - 6],
      opacity: [0, 1, 1, 0],
      duration: 1500,
      delay: stagger(1500 / packets, { start: phase * 400 }),
      loop: true,
      ease: 'inOutSine',
      playbackRate: speed,
    });
  }, [width, packets, speed, color]);
  return (
    <span ref={root} aria-hidden="true" className={`relative inline-flex h-3 shrink-0 items-center ${className}`} style={{ width }}>
      <span className="h-px w-full" style={{ backgroundImage: `linear-gradient(90deg, ${LINE} 55%, transparent 0)`, backgroundSize: '6px 1px' }} />
      {Array.from({ length: packets }, (_, i) => (
        <span key={i} data-packet className="absolute left-0 h-1.5 w-1.5 rounded-full opacity-0" style={{ background: color }} />
      ))}
    </span>
  );
}

/** Failover arrow with traffic flowing toward the fallback model. */
export function FlowArrow({ color, label, slow = false }: { color: string; label: string; slow?: boolean }) {
  return (
    <span className="inline-flex items-center" role="img" aria-label={label}>
      <FlowTrack color={color} width={44} speed={slow ? 0.5 : 1} />
      <ArrowRight size={15} className="-ml-1 text-ink-3" aria-hidden="true" />
    </span>
  );
}

/** Empty-state illustration: the router sending traffic to the three providers. */
export function RouterConstellation() {
  return (
    <div className="flex items-center gap-2" role="img" aria-label="ElevenRoute routes each conversation turn to OpenAI, Google Gemini or Anthropic">
      <BrandOrb size={52} live ping />
      <div className="flex flex-col gap-3">
        {VENDOR_ORDER.map((v: Vendor, i) => (
          <div key={v} className="flex items-center gap-2" style={{ marginLeft: i === 1 ? 18 : 0 }}>
            <FlowTrack color={VENDOR_COLORS[v].fast} width={i === 1 ? 52 : 70} packets={2} />
            <Orb model={{ vendor: v, tier: 'flagship' }} size={26} live />
            <span className="text-[12.5px] font-medium text-ink-2">{VENDOR_SHORT[v]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
