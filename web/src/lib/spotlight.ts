import type { PointerEvent } from 'react';

/**
 * A soft light that follows the mouse across a card (the `.spotlight` class in index.css). Spread the result onto
 * the card: it adds the class and moves the light by setting two non-inheriting custom properties on the card
 * itself, so a move restyles only that card's own light layer. Touch pointers are ignored (no hover on touch).
 */
export function spotlight(className = '') {
  return {
    className: `spotlight ${className}`,
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse') return;
      const r = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
      e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
    },
  };
}
