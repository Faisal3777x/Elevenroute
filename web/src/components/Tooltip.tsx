import { Info } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { EASE } from '../lib/motion';

/** Hover waits this long before a tooltip opens, so a pointer passing over an "i" doesn't flash it open. */
const OPEN_DELAY_MS = 400;
/** Within this long after one tooltip closes, the next opens at once and without animation (reading along a row). */
const SKIP_WINDOW_MS = 300;
let openCount = 0;
let lastClosedAt = 0;
const warm = () => openCount > 0 || Date.now() - lastClosedAt < SKIP_WINDOW_MS;

/**
 * Accessible tooltip: opens on hover (after a short delay) and at once on keyboard focus, described by
 * aria-describedby. It grows out of its trigger, and once one tooltip has been read the next opens instantly.
 */
export function Tooltip({ content, children, side = 'top', className = '' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; className?: string }) {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();

  const show = (immediate: boolean) => {
    clearTimeout(timer.current);
    if (immediate || warm()) {
      setInstant(warm());
      setOpen(true);
      return;
    }
    timer.current = setTimeout(() => {
      setInstant(false);
      setOpen(true);
    }, OPEN_DELAY_MS);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  // Count open tooltips across the page, and note when the last one closed, for the instant follow-on.
  useEffect(() => {
    if (!open) return;
    openCount++;
    return () => {
      openCount--;
      lastClosedAt = Date.now();
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
      aria-describedby={open ? id : undefined}>
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={instant ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: instant ? 0 : 0.1 } }}
            transition={{ duration: 0.125, ease: EASE }}
            style={{ transformOrigin: side === 'top' ? 'bottom center' : 'top center' }}
            className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-left text-xs leading-relaxed font-normal text-white shadow-[var(--shadow-float)] ${
              side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
            }`}>
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Small "i" button that explains a metric. */
export function InfoTip({ content, label = 'More information' }: { content: ReactNode; label?: string }) {
  return (
    <Tooltip content={content}>
      <button type="button" aria-label={label} className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 transition-[color,opacity] hover:text-ink active:opacity-60">
        <Info size={14} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
