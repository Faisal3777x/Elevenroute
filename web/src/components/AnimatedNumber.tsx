import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts up from zero when it first appears (0.9 s on the UI's ease-out) and animates between values
 * whenever it changes (0.5 s), so figures feel alive and an update reads as a change. `startOnView` holds the first
 * count until the number scrolls into view, so a figure further down a page is still counting when the visitor
 * gets there. The animated text is written to the DOM directly (no re-renders) and hidden from screen readers,
 * which get the final value instead. Reduced motion: the value shows at once.
 */
export function AnimatedNumber({ value, format, className, startOnView = false }: { value: number; format: (n: number) => string; className?: string; startOnView?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  // The value currently on screen, so an interrupted animation continues smoothly.
  const shown = useRef(0);
  const reduce = useReducedMotion();
  const [initial] = useState(() => format(reduce ? value : 0));
  const [seen, setSeen] = useState(!startOnView);

  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !seen) return;
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
  }, [value, format, reduce, seen]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true" className="tabular-nums">{initial}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
