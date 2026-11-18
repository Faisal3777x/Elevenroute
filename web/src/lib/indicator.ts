import { useLayoutEffect, useRef, useState, type CSSProperties, type DependencyList } from 'react';

type Box = { x: number; y: number; w: number; h: number };

/**
 * The sliding "active" pill behind a group of options (segmented controls, tabs, navigation).
 *
 * It measures the active item (the first match of `selector` inside the returned ref, which must be `relative`) and
 * returns a style that moves the pill there with a CSS `translate` transition, which runs on the compositor. The
 * width and height ease too (cheap: the pill is an absolutely positioned leaf). This replaces Motion `layoutId`
 * pills, whose shared layout animation ran on the main thread, often exactly while the next page was loading.
 * The first placement doesn't animate; after that every change slides over `ms` on a springy curve with a touch of
 * overshoot (`--ease-spring`), so the pill feels alive: navigation 280 ms, segmented switches and tabs 260 ms, the
 * agent's step strip 320 ms. Reduced motion: it snaps (index.css).
 */
export function useIndicator<T extends HTMLElement>(selector: string, deps: DependencyList, ms = 260) {
  const ref = useRef<T>(null);
  const [state, setState] = useState<{ box: Box | null; placed: boolean }>({ box: null, placed: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>(selector);
      const box = active ? { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight } : null;
      setState((s) => ({ box, placed: s.box !== null }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // The caller lists what changes the active item (the value, the route…).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const { box, placed } = state;
  const style: CSSProperties = box
    ? {
        translate: `${box.x}px ${box.y}px`,
        width: box.w,
        height: box.h,
        opacity: 1,
        transition: placed && ms > 0 ? `translate ${ms}ms var(--ease-spring), width ${ms}ms var(--ease-out), height ${ms}ms var(--ease-out), opacity 150ms ease` : 'none',
      }
    : { opacity: 0 };
  return [ref, style] as const;
}
