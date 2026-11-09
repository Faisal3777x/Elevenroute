import { createScope, type Scope } from 'animejs';
import { useEffect, useRef, useState, type DependencyList, type RefObject } from 'react';

/** Start a little before an element scrolls into view, so it is already moving when it appears. */
const NEAR_VIEW = '160px 0px';

type Playable = { pause?: () => unknown; resume?: () => unknown; paused?: boolean; completed?: boolean };

/**
 * Runs anime.js animations scoped to the returned ref: string selectors in `setup` only match inside it,
 * and everything is reverted on unmount or when `deps` change. Skipped entirely when the user prefers
 * reduced motion (re-evaluated live if that setting changes). anime.js pauses while the tab is hidden.
 * While the element is off-screen its running animations are paused and resumed where they left off, so a page
 * full of looping orbs only spends frames on the ones you can see (this is what keeps phones smooth).
 */
export function useAnime<T extends Element>(setup: (scope: Scope) => void | (() => void), deps: DependencyList): RefObject<T | null> {
  const root = useRef<T>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const scope = createScope({ root: root as RefObject<HTMLElement | null>, mediaQueries: { reduce: '(prefers-reduced-motion: reduce)' } }).add((self) => {
      if (!self || self.matches.reduce) return;
      return setup(self);
    });
    const held = new Set<Playable>();
    const io = new IntersectionObserver(
      ([entry]) => {
        const running = scope.revertibles as unknown as Playable[];
        if (!entry.isIntersecting) {
          for (const a of running) {
            if (a.pause && !a.paused && !a.completed) {
              a.pause();
              held.add(a);
            }
          }
        } else {
          for (const a of held) a.resume?.();
          held.clear();
        }
      },
      { rootMargin: NEAR_VIEW },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      scope.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return root;
}

/**
 * True while the element is on (or near) the screen. Loops that drive React state (step-by-step demos) use it to
 * stop stepping off-screen instead of re-rendering something nobody can see.
 */
export function useOnScreen<T extends Element>(): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: NEAR_VIEW });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return [setEl, visible];
}

/** A stable 0–1 value per component instance, used to offset loop phases so neighbours don't move in lockstep. */
export function usePhase(): number {
  const phase = useRef<number | null>(null);
  if (phase.current === null) phase.current = Math.random();
  return phase.current;
}
