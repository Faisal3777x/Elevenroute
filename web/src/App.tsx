import { Bot, Calculator, FlaskConical, LayoutDashboard, LogOut, MessagesSquare, Server, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';

import type { MeResponse } from '../../shared/types';
import { BrandOrb } from './components/Orb';
import { Skeleton } from './components/ui';
import { useAuth } from './lib/auth';
import { ModeProvider, useMode } from './lib/mode';
import { useIndicator } from './lib/indicator';
import { useApi } from './lib/useApi';

const SignIn = lazy(() => import('./pages/SignIn'));
const Landing = lazy(() => import('./pages/Landing'));
const AdFilm = lazy(() => import('./pages/AdFilm'));

const Overview = lazy(() => import('./pages/Overview'));
const Playground = lazy(() => import('./pages/Playground'));
const Agent = lazy(() => import('./pages/Agent'));
const RoutingRules = lazy(() => import('./pages/RoutingRules'));
const Providers = lazy(() => import('./pages/Providers'));
const TestResults = lazy(() => import('./pages/TestResults'));
const WhatIf = lazy(() => import('./pages/WhatIf'));

const NAV: { to: string; label: string; short: string; icon: LucideIcon }[] = [
  { to: '/overview', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { to: '/playground', label: 'Playground', short: 'Playground', icon: MessagesSquare },
  { to: '/agent', label: 'ElevenAgent', short: 'Agent', icon: Bot },
  { to: '/rules', label: 'Routing rules', short: 'Rules', icon: SlidersHorizontal },
  { to: '/providers', label: 'Providers', short: 'Providers', icon: Server },
  { to: '/tests', label: 'Test results', short: 'Tests', icon: FlaskConical },
  { to: '/whatif', label: 'What-if', short: 'What-if', icon: Calculator },
];

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        {/* The landing page is public; the dashboard behind it is gated only when sign-in is configured. */}
        <Route
          path="/"
          element={
            <Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
              <Landing />
            </Suspense>
          }
        />
        {/* The ad film: plays live here; /ad?render lets a recorder capture it frame by frame (README: "Ad film"). */}
        <Route
          path="/ad"
          element={
            <Suspense fallback={<div className="min-h-dvh bg-black" aria-busy="true" />}>
              <AdFilm />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <AuthGate>
              <ModeProvider>
                <Shell />
              </ModeProvider>
            </AuthGate>
          }
        />
      </Routes>
    </MotionConfig>
  );
}

/** With Supabase configured, nothing below renders (and no API call is made) until someone signs in. */
function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, ready, session, recovering } = useAuth();
  if (!enabled) return <>{children}</>;
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (!session || recovering) {
    return (
      <Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
        <SignIn />
      </Suspense>
    );
  }
  return <>{children}</>;
}

function Account({ compact = false }: { compact?: boolean }) {
  const { enabled, user, signOut } = useAuth();
  const me = useApi<MeResponse>(enabled ? '/me' : null);
  if (!enabled) return null;
  const email = user?.email ?? 'Signed in';
  if (compact) {
    return (
      <button type="button" onClick={signOut} title={`Signed in as ${email}. Sign out`} className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[13px] font-medium text-white uppercase">
        {email[0]}
        <span className="sr-only">Sign out {email}</span>
      </button>
    );
  }
  return (
    <div className="mb-3 flex items-center gap-2.5 px-1">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-medium text-white uppercase" aria-hidden="true">{email[0]}</span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] font-medium text-ink" title={email}>{email}</div>
        <div className="truncate text-[11.5px] text-ink-3">{me.data?.workspace.name ?? 'Your workspace'}</div>
      </div>
      <button type="button" onClick={signOut} className="rounded-full p-2 text-ink-3 hover:bg-card hover:text-ink" title="Sign out">
        <LogOut size={15} aria-hidden="true" />
        <span className="sr-only">Sign out</span>
      </button>
    </div>
  );
}

function Shell() {
  const location = useLocation();
  // A new page starts at the top, set before the browser paints it, so the old scroll position never flashes.
  useLayoutEffect(() => {
    // Instant even when arriving from the landing page, whose smooth scrolling is still switched on at this moment.
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);
  useEffect(() => {
    const current = NAV.find((n) => n.to === location.pathname);
    document.title = current ? `${current.label} · ElevenRoute` : 'ElevenRoute';
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:pl-[252px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col border-r border-line bg-canvas px-4 py-7 lg:flex">
        <Brand />
        <SideNav pathname={location.pathname} />
        <div className="mt-auto">
          <Account />
          <DataNote />
        </div>
      </aside>

      {/* Mobile / tablet top bar */}
      {/* Nearly opaque instead of frosted: a backdrop blur here would re-blur the moving page on every scroll frame. */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-canvas/[0.97] px-4 py-3 lg:hidden">
        <Brand />
        <Account compact />
      </header>

      <LiveBanner />

      <main id="main" className="px-4 pt-6 pb-[calc(8rem+env(safe-area-inset-bottom,0px))] sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
        {/* Pages swap at once, with no transition: it's the click people make most often here. */}
        <Suspense fallback={<PageSkeleton />}>
          <Routes location={location}>
            <Route path="/overview" element={<Overview />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/agent" element={<Agent />} />
            <Route path="/rules" element={<RoutingRules />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/tests" element={<TestResults />} />
            <Route path="/whatif" element={<WhatIf />} />
            <Route path="*" element={<Overview />} />
          </Routes>
        </Suspense>
        {/* Phones and tablets have no sidebar, so the data note closes every page instead. */}
        <div className="mx-auto mt-10 max-w-[1200px] lg:hidden">
          <DataNote />
        </div>
      </main>

      {/* Mobile / tablet floating pill navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 flex justify-center px-3 lg:hidden">
        <PillNav pathname={location.pathname} />
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 rounded-xl" aria-label="ElevenRoute home">
      <BrandOrb size={28} live />
      <span className="h-display text-[22px]">ElevenRoute</span>
    </NavLink>
  );
}

/** The active page's pill slides to the new page on the compositor (useIndicator), with a springy settle. */
function SideNav({ pathname }: { pathname: string }) {
  const [list, pill] = useIndicator<HTMLElement>('[aria-current="page"]', [pathname], 280);
  return (
    <nav ref={list} aria-label="Main" className="relative mt-8 flex flex-col gap-0.5">
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-full bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]" style={pill} />
      {NAV.map((n) => <SideLink key={n.to} {...n} />)}
    </nav>
  );
}

function PillNav({ pathname }: { pathname: string }) {
  const [list, pill] = useIndicator<HTMLDivElement>('[aria-current="page"]', [pathname], 280);
  return (
    <div ref={list} className="scroll-x relative flex max-w-full [scrollbar-width:none] gap-0.5 rounded-full border border-line bg-canvas/[0.97] p-1.5 shadow-[var(--shadow-float)]">
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-full bg-ink" style={pill} />
      {NAV.map((n) => <PillLink key={n.to} {...n} />)}
    </div>
  );
}

function SideLink({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <NavLink to={to} end className="press group relative flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[14px] font-medium">
      {({ isActive }) => (
        <>
          <Icon size={17} aria-hidden="true" className={`relative transition-[color,translate] duration-200 group-hover:-translate-y-px ${isActive ? 'text-ink' : 'text-ink-3 group-hover:text-ink'}`} />
          <span className={`relative transition-colors duration-200 ${isActive ? 'text-ink' : 'text-ink-2 group-hover:text-ink'}`}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function PillLink({ to, short, icon: Icon }: { to: string; short: string; icon: LucideIcon }) {
  return (
    <NavLink to={to} end className="press relative flex min-w-[64px] shrink-0 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium">
      {({ isActive }) => (
        <>
          <Icon size={17} aria-hidden="true" className={`relative transition-colors duration-200 ${isActive ? 'text-white' : 'text-ink-2'}`} />
          <span className={`relative transition-colors duration-200 ${isActive ? 'text-white' : 'text-ink-2'}`}>{short}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * A strip across the top only when it matters: the API can't be reached, or the workspace is calling real models
 * (every request costs money). With sample data the quiet DataNote says so instead.
 */
function LiveBanner() {
  const { config, error } = useMode();
  if (error && !config) {
    return <div role="status" className="border-b border-bad/20 bg-bad/[0.05] px-4 py-2 text-center text-[12.5px] text-bad sm:px-6 lg:px-10">{error}</div>;
  }
  if (config?.mode !== 'live') return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-ember/25 bg-ember/[0.06] px-4 py-2 text-center text-[12.5px] text-ink sm:px-6 lg:px-10">
      <span className="inline-block h-2 w-2 rounded-full bg-ember" aria-hidden="true" />
      <strong className="font-medium">Live models</strong>
      <span>Real provider calls. Requests you send cost real money.</span>
    </div>
  );
}

/**
 * The one note that says where the numbers come from. Prices, scores, latencies and savings are simulated, so this
 * stays visible on every dashboard page (in the sidebar, or at the foot of the page on phones). Never remove it while
 * the workspace uses simulated providers.
 */
function DataNote() {
  const { config } = useMode();
  if (!config || config.mode === 'live') return null;
  return (
    <div className="rounded-2xl border border-line px-3.5 py-3">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-3" aria-hidden="true" />
        Sample data
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-3">Providers, prices, scores and savings are simulated for illustration, not live measurements.</p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-12 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
