import { Info } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';

import { fast } from '../lib/motion';

/** Accessible tooltip: opens on hover and keyboard focus, described by aria-describedby. */
export function Tooltip({ content, children, side = 'top', className = '' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      aria-describedby={open ? id : undefined}>
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: side === 'top' ? 4 : -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={fast}
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
      <button type="button" aria-label={label} className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:text-ink">
        <Info size={14} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
