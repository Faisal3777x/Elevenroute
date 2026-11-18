import { X } from 'lucide-react';
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { DRAWER, fast, spring } from '../lib/motion';

/** Below Tailwind's `sm` breakpoint the dialog is a bottom sheet (see the `items-end` layout below). */
const SHEET_QUERY = '(max-width: 639.98px)';

/** Dialog with an animated open / close, Escape to close, focus moved in and restored. */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // On a phone the dialog sits at the bottom as a sheet, so it slides up from below; elsewhere it rises from centre.
  const [sheet, setSheet] = useState(() => window.matchMedia(SHEET_QUERY).matches);
  useEffect(() => {
    const m = window.matchMedia(SHEET_QUERY);
    const on = () => setSheet(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
      (first ?? panel.current)?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
        if (!items.length) return;
        const [firstEl, lastEl] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  // ---- Swipe down to close the sheet (phones). Track phase: the sheet is the finger (1:1, a motion value, no
  // spring), resisting if pulled upward. Release phase: past 35% of its height or flicked down, it closes; otherwise
  // it springs back carrying the finger's speed. The scrim fades with the drag, from the same value.
  const y = useMotionValue(0);
  const reduce = useReducedMotion();
  const drag = useRef<{ from: number; lastY: number; lastT: number; v: number } | null>(null);
  const scrim = useTransform(y, (v) => (typeof v === 'number' ? 1 - Math.min(1, Math.max(0, v) / (panel.current?.offsetHeight || 400)) : 0));
  const grab = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { from: e.clientY - (typeof y.get() === 'number' ? y.get() : 0), lastY: e.clientY, lastT: e.timeStamp, v: 0 };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.from;
    // Upward the sheet rubber-bands (the further past the edge, the less it follows); downward it tracks 1:1.
    y.set(raw >= 0 ? raw : -((Math.abs(raw) * 200 * 0.55) / (200 + 0.55 * Math.abs(raw))));
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = ((e.clientY - d.lastY) / dt) * 1000; // px/s
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
  };
  const release = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const height = panel.current?.offsetHeight || 400;
    if (y.get() > height * 0.35 || d.v > 450) return onClose();
    animate(y, 0, reduce ? { duration: 0.15, ease: 'easeOut' } : { type: 'spring', duration: 0.5, bounce: 0.2, velocity: d.v });
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fast} onClick={onClose}>
            <motion.div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" style={sheet ? { opacity: scrim } : undefined} />
          </motion.div>
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            style={sheet ? { y } : undefined}
            {...(sheet
              ? {
                  initial: { y: '100%' },
                  animate: { y: 0, transition: { duration: 0.45, ease: DRAWER } },
                  exit: { y: '100%', transition: { duration: 0.28, ease: DRAWER } },
                }
              : {
                  initial: { opacity: 0, y: 16, scale: 0.98 },
                  animate: { opacity: 1, y: 0, scale: 1, transition: spring },
                  exit: { opacity: 0, y: 8, scale: 0.98, transition: fast },
                })}
            className="relative max-h-[90dvh] w-full overflow-y-auto overscroll-contain rounded-t-[24px] bg-canvas p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] shadow-[var(--shadow-lift)] sm:max-w-lg sm:rounded-[24px] sm:pb-6">
            {sheet ? (
              // The grab handle: a 44 px touch target around a small bar, clear of the close button.
              <div
                aria-hidden="true"
                onPointerDown={grab}
                onPointerMove={move}
                onPointerUp={release}
                onPointerCancel={release}
                className="absolute top-0 left-1/2 flex h-11 w-36 -translate-x-1/2 cursor-grab touch-none items-start justify-center pt-2 active:cursor-grabbing">
                <span className="h-1 w-10 rounded-full bg-ink/15" />
              </div>
            ) : null}
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 id={titleId} className="h-display text-2xl">{title}</h2>
              <button type="button" data-close onClick={onClose} aria-label="Close" className="press rounded-full p-1.5 text-ink-3 transition-colors hover:bg-card hover:text-ink">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {children}
            {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
