import { Volume2 } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Promo } from '../lib/promo';

/**
 * The landing page's 16:9 ad frame (configured in lib/promo.ts). A video plays by itself, muted and looping, while
 * at least half of it is on screen, and pauses when it leaves. Browsers only autoplay muted, so a "Sound on" button
 * restarts the film from the top with its soundtrack. With reduced motion it waits for a click. It always has its own
 * controls. The landing page renders the frame only when PROMO is set. Sized in rem and coloured with tokens, like
 * the rest of the dark landing page.
 */
export function PromoSlot({ promo }: { promo: Promo }) {
  const frame = 'relative aspect-video w-full overflow-hidden rounded-[1.75rem] bg-card ring-1 ring-line';
  const caption = promo.title ? <figcaption className="mt-3 text-[0.875rem] text-ink-3">{promo.title}</figcaption> : null;
  if (promo.kind === 'video') {
    return (
      <figure>
        <div className={frame}>
          <PromoVideo src={promo.src} poster={promo.poster} title={promo.title} />
        </div>
        {caption}
      </figure>
    );
  }
  if (promo.kind === 'youtube') {
    return (
      <figure>
        <div className={frame}>
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(promo.id)}?rel=0`}
            title={promo.title}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
        {caption}
      </figure>
    );
  }
  const image = <img className="h-full w-full object-cover" src={promo.src} alt={promo.alt} loading="lazy" />;
  return <PromoImage image={image} href={promo.href} caption={caption} frame={frame} />;
}

function PromoImage({ image, href, caption, frame }: { image: ReactNode; href?: string; caption: ReactNode; frame: string }) {
  return (
    <figure>
      <div className={frame}>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full w-full">{image}</a> : image}
      </div>
      {caption}
    </figure>
  );
}

/**
 * Plays muted while half on screen, pauses off screen; under reduced motion it only plays when asked. The button
 * turns the sound on and starts again from the top, so the music and the cuts line up; it fades away once the sound
 * is on (also when the visitor unmutes with the video's own controls).
 */
function PromoVideo({ src, poster, title }: { src: string; poster?: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotion();
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; // React sets `muted` as a property only; make sure the film starts muted so autoplay is allowed
    const sync = () => setMuted(v.muted || v.volume === 0);
    v.addEventListener('volumechange', sync);
    return () => v.removeEventListener('volumechange', sync);
  }, []);
  useEffect(() => {
    const v = ref.current;
    if (!v || reduce) return;
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? void v.play().catch(() => {}) : v.pause()), { threshold: 0.5 });
    io.observe(v);
    return () => io.disconnect();
  }, [reduce]);
  const soundOn = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = false;
    if (v.volume === 0) v.volume = 1;
    v.currentTime = 0;
    void v.play().catch(() => {});
  };
  return (
    <>
      <video ref={ref} className="h-full w-full object-cover" src={src} poster={poster} controls muted loop playsInline preload="metadata" aria-label={title} />
      <span className={`absolute right-3 top-3 transition-opacity duration-200 sm:right-4 sm:top-4 ${muted ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <button
          type="button"
          onClick={soundOn}
          tabIndex={muted ? 0 : -1}
          aria-hidden={!muted}
          className="press inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[0.875rem] font-medium text-canvas shadow-[0_0.5rem_1.5rem_rgb(0_0_0/0.35)]">
          <Volume2 className="size-4" aria-hidden="true" />
          {reduce ? 'Play with sound' : 'Sound on'}
        </button>
      </span>
    </>
  );
}
