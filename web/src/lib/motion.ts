import type { Transition, Variants } from 'motion/react';

/** Shared motion settings. Interface motion stays within 150–400 ms. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const fast: Transition = { duration: 0.18, ease: EASE };
export const base: Transition = { duration: 0.28, ease: EASE };
export const slow: Transition = { duration: 0.4, ease: EASE };
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 };
export const softSpring: Transition = { type: 'spring', stiffness: 260, damping: 28 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: base },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
};

export const page: Variants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0, transition: base },
  exit: { opacity: 0, y: -4, transition: fast },
};

/** Hover elevation and press feedback for interactive cards and buttons. */
export const hoverLift = { whileHover: { y: -2 }, transition: spring };
export const press = { whileTap: { scale: 0.97 }, transition: spring };
