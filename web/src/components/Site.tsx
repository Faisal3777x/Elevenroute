import { ArrowRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useState, type AnchorHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';

import { PROMO } from '../lib/promo';
import { BrandOrb } from './Orb';

// The public site's chrome, shared by the landing page and About Us: the black theme, the header, the footer and the
// small pieces their sections are built from. Everything here is sized in rem and coloured with tokens, so it scales
// with html.landing-dark on very large screens and follows .theme-dark.

/** Static film grain (SVG turbulence), tiled. */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

/**
 * Size factor for very large screens. Must match the html.landing-dark font sizes in index.css: the page's rem-based
 * layout grows with them, and this scales what is drawn in pixels (orbs, the logo) by the same amount.
 */
const scaleFor = (w: number) => (w >= 3400 ? 34 / 16 : w >= 2560 ? 26 / 16 : w >= 1920 ? 20 / 16 : 1);
export function useScale(): number {
  const [k, setK] = useState(() => scaleFor(window.innerWidth));
  useEffect(() => {
    const on = () => setK(scaleFor(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return k;
}

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setOn(m.matches);
    update();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, [query]);
  return on;
}

/**
 * Black theme for a public page: the page behind it (overscroll, body) and the phone's status bar go black while it
 * is open (index.html already does both before any script loads), and a new page starts at the top unless the link
 * points at one of its sections.
 */
export function useDarkPage(title: string) {
  useLayoutEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  useEffect(() => {
    document.title = title;
    document.documentElement.classList.add('landing-dark');
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    theme?.setAttribute('content', '#09090a');
    return () => {
      document.documentElement.classList.remove('landing-dark');
      theme?.setAttribute('content', '#fdfcfc'); // the dashboard's canvas colour
    };
  }, [title]);
}

/** The page frame: black canvas, film grain, header, content, footer. */
export function SitePage({ children, home = false }: { children: ReactNode; home?: boolean }) {
  return (
    <div className="theme-dark relative min-h-dvh overflow-x-clip">
      {/* Film grain: a plain low-opacity layer. No blend mode, which would make the browser re-blend the whole screen
          on every frame of every animation underneath it. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] opacity-[0.03]" style={{ backgroundImage: GRAIN, backgroundSize: '220px 220px' }} />
      <TopBar home={home} />
      {children}
      <SiteFooter />
    </div>
  );
}

const quiet = 'rounded-full px-3 py-2 text-[0.875rem] text-ink-2 transition-[color,opacity] hover:text-ink active:opacity-60';

/** The header. On the landing page its links jump to sections; elsewhere they lead back to them. */
function TopBar({ home }: { home: boolean }) {
  const k = useScale();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  // Section links give way first on narrower screens, so the bar never crowds the button.
  const section = (id: string, label: string, show = 'md:inline-block') =>
    home ? <a href={`#${id}`} className={`hidden ${show} ${quiet}`}>{label}</a> : <Link to={`/#${id}`} className={`hidden ${show} ${quiet}`}>{label}</Link>;
  return (
    // The blur only exists once there is something under the bar to blur (backdrop filters cost a repaint per frame).
    <header className={`landing-bar sticky top-0 z-40 border-b transition-colors duration-300 ${scrolled ? 'border-line bg-canvas/80 backdrop-blur' : 'border-transparent bg-canvas/0'}`}>
      <div className="mx-auto flex h-16 max-w-[77.5rem] items-center justify-between gap-4 px-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5 rounded-xl" aria-label="ElevenRoute home">
          <BrandOrb size={Math.round(30 * k)} live beat outline />
          <span className="h-display text-[1.375rem]">ElevenRoute</span>
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1 sm:gap-2">
          {PROMO ? section('film', 'Watch', 'lg:inline-block') : null}
          {section('live', 'See it live')}
          {section('why', 'Why it pays', 'lg:inline-block')}
          <NavLink to="/about" className={({ isActive }) => `hidden md:inline-block ${quiet} ${isActive ? 'text-ink' : ''}`}>About Us</NavLink>
          <CtaLink to="/overview" size="sm">Open dashboard</CtaLink>
        </nav>
      </div>
    </header>
  );
}

/** Where the footer leads: the dashboard pages a visitor is most likely to want next, and who made it. */
const FOOTER_LINKS = [
  { to: '/overview', label: 'Overview' },
  { to: '/agent', label: 'ElevenAgent' },
  { to: '/playground', label: 'Playground' },
  { to: '/rules', label: 'Routing rules' },
  { to: '/tests', label: 'Test results' },
  { to: '/about', label: 'About Us' },
];

function SiteFooter() {
  const k = useScale();
  return (
    <footer className="mx-auto flex max-w-[77.5rem] flex-col gap-5 px-4 pt-8 pb-12 text-[0.8125rem] text-ink-3 sm:px-8 md:flex-row md:items-center md:justify-between">
      <Link to="/" className="flex w-fit items-center gap-2 rounded-xl text-ink-2" aria-label="ElevenRoute home">
        <BrandOrb size={Math.round(20 * k)} outline />
        ElevenRoute
      </Link>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
        {FOOTER_LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end className={({ isActive }) => `rounded transition-[color,opacity] hover:text-ink active:opacity-60 ${isActive ? 'text-ink-2' : ''}`}>{l.label}</NavLink>
        ))}
      </nav>
    </footer>
  );
}

/**
 * Soft brand-coloured light that drifts and breathes very slowly (`.glow-drift`: a CSS loop on the compositor, so
 * it costs no script; stopped under reduced motion). `period` and `delay` keep two glows from moving in step.
 */
export function Glow({ className = '', period = 22, delay = 0 }: { className?: string; period?: number; delay?: number }) {
  return (
    <div
      aria-hidden="true"
      className={`glow-drift pointer-events-none absolute rounded-full ${className}`}
      style={{ background: 'radial-gradient(closest-side, rgb(122 92 255 / 0.22), rgb(63 193 180 / 0.10) 55%, transparent)', '--glow-period': `${period}s`, '--glow-delay': `${-delay}s` } as CSSProperties}
    />
  );
}

/**
 * A section that rises in once, as it scrolls into view. It only flags itself (`data-in`); the entrance is CSS
 * (`.reveal` in index.css, compositor-only): the first child leads and travels furthest, the rest follow with
 * shrinking gaps, `.fine` print only fades, and a `.reveal-cascade` inside flows in item by item.
 */
export function Reveal({ children, className = '', id, as = 'section' }: { children: ReactNode; className?: string; id?: string; as?: 'section' | 'div' }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!el || inView) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setInView(true);
        io.disconnect();
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, inView]);
  const props = { ref: setEl, id, 'data-in': inView ? '' : undefined, className: `reveal scroll-mt-20 ${className}` };
  return as === 'div' ? <div {...props}>{children}</div> : <section {...props}>{children}</section>;
}

export function SectionTitle({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[0.8125rem] font-medium tracking-[0.06em] text-ink-3 uppercase">{eyebrow}</p>
      <h2 className="h-display mt-3 max-w-[24ch] text-[clamp(1.875rem,3.6vw,2.875rem)] leading-[1.05] tracking-[-0.028em] text-balance">{children}</h2>
    </div>
  );
}

type CtaProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className' | 'children'> & {
  to?: string;
  href?: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
};

/** Pill link styled as a button: a route (to) or an anchor on this page (href). Colours follow the theme. */
export function CtaLink({ to, href, children, variant = 'primary', size = 'md', ...rest }: CtaProps) {
  const look = variant === 'primary' ? 'bg-ink text-canvas hover:bg-ink/90' : 'border border-line bg-canvas text-ink hover:border-ink/30 hover:bg-card';
  const sizing = size === 'sm' ? 'h-9 px-4 text-[0.8125rem] gap-1.5' : 'h-12 px-6 text-[0.9375rem] gap-2';
  const cls = `group inline-flex shrink-0 items-center rounded-full font-medium transition-[color,background-color,border-color,scale] duration-[160ms] active:scale-[0.97] ${look} ${sizing}`;
  const inner = (
    <>
      {children}
      <ArrowRight size={size === 'sm' ? '0.875rem' : '1rem'} aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5" />
    </>
  );
  return href ? <a href={href} className={cls} {...rest}>{inner}</a> : <Link to={to ?? '/'} className={cls} {...rest}>{inner}</Link>;
}
