import type { Transition } from 'motion/react';

/**
 * Shared motion settings. Interface motion stays within 150–300 ms on the UI curve (a strong ease-out, also the
 * `--ease-out` token in index.css). Longer, slower motion belongs only to the landing page and to explanatory
 * replays (the routing visualiser, the agent's turn replay).
 */
export const EASE = [0.22, 1, 0.36, 1] as const;
/** iOS-like sheet curve, for the dialog when it slides up from the bottom on phones. */
export const DRAWER = [0.32, 0.72, 0, 1] as const;
export const fast: Transition = { duration: 0.18, ease: EASE };
export const base: Transition = { duration: 0.28, ease: EASE };
/**
 * The one spring: presses, toggles, dialogs, small pops, reordering lists. A little bounce (0.15) keeps the
 * interface feeling alive while it still settles fast; the rare happy moment ("Goal met") gets a bit more.
 */
export const spring: Transition = { type: 'spring', duration: 0.4, bounce: 0.15 };

