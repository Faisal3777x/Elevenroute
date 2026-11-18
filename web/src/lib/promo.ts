/**
 * The landing page's ad slot: one 16:9 frame right under the hero. null = no slot at all (the page closes up
 * around it, in development too).
 *
 * Examples:
 *   A video file: put it in web/public (e.g. web/public/promo.mp4), then
 *     { kind: 'video', src: '/promo.mp4', poster: '/promo.jpg', title: 'ElevenRoute in 60 seconds' }
 *   A YouTube film (the id is the part after "v=" in the link):
 *     { kind: 'youtube', id: 'dQw4w9WgXcQ', title: 'ElevenRoute in 60 seconds' }
 *   An image banner, optionally linking somewhere:
 *     { kind: 'image', src: '/promo.png', alt: 'What the banner says', href: 'https://example.com' }
 */
export type Promo =
  | { kind: 'video'; src: string; poster?: string; title: string }
  | { kind: 'youtube'; id: string; title: string }
  | { kind: 'image'; src: string; alt: string; href?: string; title?: string };

/**
 * The ad film (rendered from the /ad page, with the music edit from scripts/ad-music.mjs, see README "Ad film"). It
 * starts muted, as browsers require; the slot's "Sound on" button restarts it with sound.
 */
export const PROMO: Promo | null = { kind: 'video', src: '/promo.mp4', poster: '/promo-poster.jpg', title: 'ElevenRoute in 72 seconds' };
