import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';

import { base } from '../lib/motion';

/** Expandable panel with a smooth height transition. */
export function Collapse({ label, children, defaultOpen = false, className = '' }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-lg py-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={base} className="inline-flex">
          <ChevronDown size={15} aria-hidden="true" />
        </motion.span>
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={base}
            className="overflow-hidden">
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
