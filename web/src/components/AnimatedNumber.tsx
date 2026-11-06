import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Counts to `value` when it first loads and animates between values when it
 * changes. The animated text is written to the DOM directly (no re-renders) and
 * hidden from screen readers, which get the final value instead.
 */
export function AnimatedNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // The value currently on screen, so an interrupted animation continues smoothly.
  const shown = useRef(0);
  const reduce = useReducedMotion();
  const [initial] = useState(() => format(reduce ? value : 0));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    if (reduce || from === value) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    const controls = animate(from, value, {
      duration: from === 0 ? 0.9 : 0.5,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, format, reduce]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true" className="tabular-nums">{initial}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
