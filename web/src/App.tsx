import { Calculator, FlaskConical, LayoutDashboard, MessagesSquare, Server, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';

import { Modal } from './components/Modal';
import { Orb } from './components/Orb';
import { Button, Segmented, Skeleton } from './components/ui';
import { ModeProvider, useMode } from './lib/mode';
import { page, spring } from './lib/motion';

const Overview = lazy(() => import('./pages/Overview'));
const Playground = lazy(() => import('./pages/Playground'));
const RoutingRules = lazy(() => import('./pages/RoutingRules'));
const Providers = lazy(() => import('./pages/Providers'));
const TestResults = lazy(() => import('./pages/TestResults'));
const WhatIf = lazy(() => import('./pages/WhatIf'));

const NAV: { to: string; label: string; short: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { to: '/playground', label: 'Playground', short: 'Playground', icon: MessagesSquare },
  { to: '/rules', label: 'Routing rules', short: 'Rules', icon: SlidersHorizontal },
  { to: '/providers', label: 'Providers', short: 'Providers', icon: Server },
  { to: '/tests', label: 'Test results', short: 'Tests', icon: FlaskConical },
  { to: '/whatif', label: 'What-if', short: 'What-if', icon: Calculator },
];

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ModeProvider>
        <Shell />
      </ModeProvider>
    </MotionConfig>
  );
}

function Shell() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
    const current = NAV.find((n) => n.to === location.pathname);
    document.title = current && current.to !== '/' ? `${current.label} · ElevenRoute` : 'ElevenRoute';
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:pl-[252px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col border-r border-line bg-canvas px-4 py-7 lg:flex">
        <Brand />
        <nav aria-label="Main" className="mt-8 flex flex-col gap-0.5">
          {NAV.map((n) => <SideLink key={n.to} {...n} />)}
        </nav>
        <div className="mt-auto">
          <ModeSwitch />
        </div>
      </aside>

      {/* Mobile / tablet top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <ModePill />
      </header>

      <ModeBanner />

      <main id="main" className="px-4 pt-6 pb-32 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={location.pathname} variants={page} initial="initial" animate="enter" exit="exit">
            <Suspense fallback={<PageSkeleton />}>
              <Routes location={location}>
                <Route path="/" element={<Overview />} />
                <Route path="/playground" element={<Playground />} />
                <Route path="/rules" element={<RoutingRules />} />
                <Route path="/providers" element={<Providers />} />
                <Route path="/tests" element={<TestResults />} />
                <Route path="/whatif" element={<WhatIf />} />
                <Route path="*" element={<Overview />} />
              </Routes>
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile / tablet floating pill navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 lg:hidden">
        <div className="scroll-x flex max-w-full gap-0.5 rounded-full border border-line bg-canvas/95 p-1.5 shadow-[var(--shadow-float)] backdrop-blur">
          {NAV.map((n) => <PillLink key={n.to} {...n} />)}
        </div>
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 rounded-xl" aria-label="ElevenRoute home">
      <Orb model={{ vendor: 'google', tier: 'flagship' }} size={28} />
      <span className="h-display text-[22px]">ElevenRoute</span>
    </NavLink>
  );
}

function SideLink({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <NavLink to={to} end className="group relative flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[14px] font-medium">
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="side-active" transition={spring} className="absolute inset-0 rounded-full bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]" />}
          <Icon size={17} aria-hidden="true" className={`relative ${isActive ? 'text-ink' : 'text-ink-3 group-hover:text-ink'}`} />
          <span className={`relative ${isActive ? 'text-ink' : 'text-ink-2 group-hover:text-ink'}`}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function PillLink({ to, short, icon: Icon }: { to: string; short: string; icon: LucideIcon }) {
  return (
    <NavLink to={to} end className="relative flex min-w-[64px] shrink-0 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium">
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="pill-active" transition={spring} className="absolute inset-0 rounded-full bg-ink" />}
          <Icon size={17} aria-hidden="true" className={`relative ${isActive ? 'text-white' : 'text-ink-2'}`} />
          <span className={`relative ${isActive ? 'text-white' : 'text-ink-2'}`}>{short}</span>
        </>
      )}
    </NavLink>
  );
}

/** Persistent strip so demo numbers are never mistaken for live measurements. */
function ModeBanner() {
  const { config, error } = useMode();
  if (error && !config) {
    return <div role="status" className="border-b border-bad/20 bg-bad/[0.05] px-4 py-2 text-center text-[12.5px] text-bad sm:px-6 lg:px-10">{error}</div>;
  }
  if (!config) return null;
  const demo = config.mode === 'demo';
  return (
    <div role="status" className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b px-4 py-2 text-center text-[12.5px] sm:px-6 lg:px-10 ${demo ? 'border-line bg-card/70 text-ink-2' : 'border-ember/25 bg-ember/[0.06] text-ink'}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${demo ? 'bg-ink-3' : 'bg-ember'}`} aria-hidden="true" />
      <strong className="font-medium">{demo ? 'Demo mode' : 'Live mode'}</strong>
      <span>{demo ? 'Simulated providers. Costs, latencies and scores are simulated, not live measurements.' : 'Real provider calls. Requests you send cost real money.'}</span>
    </div>
  );
}

function ModePill() {
  const { config } = useMode();
  if (!config) return null;
  const demo = config.mode === 'demo';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${demo ? 'border-line text-ink-2' : 'border-ember/40 text-ink'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${demo ? 'bg-ink-3' : 'bg-ember'}`} aria-hidden="true" />
      {demo ? 'Demo' : 'Live'}
    </span>
  );
}

function ModeSwitch() {
  const { config, setMode } = useMode();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!config) return <Skeleton className="h-24" />;
  const keys = Object.entries(config.keys).filter(([, v]) => v).map(([k]) => k);
  const change = async (mode: 'demo' | 'live') => {
    if (mode === 'live') return setConfirm(true);
    setBusy(true);
    await setMode('demo').finally(() => setBusy(false));
  };
  return (
    <div className="card p-4">
      <div className="label mb-2">Mode</div>
      <Segmented label="Mode" size="sm" value={config.mode} onChange={change} options={[{ value: 'demo', label: 'Demo' }, { value: 'live', label: 'Live' }]} />
      <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
        {config.mode === 'demo' ? 'Simulated providers, no API keys, no cost.' : keys.length ? `Live keys: ${keys.join(', ')}.` : 'No API keys found in .env.'}
      </p>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Switch to live mode?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Stay in demo</Button>
            <Button
              loading={busy}
              disabled={!keys.length}
              onClick={async () => {
                setBusy(true);
                await setMode('live').finally(() => setBusy(false));
                setConfirm(false);
              }}>
              Switch to live
            </Button>
          </>
        }>
        <p className="text-[14.5px] leading-relaxed text-ink-2">
          Live mode sends Playground and test-suite requests to the real providers and they are billed to your API keys. Synthetic traffic always stays simulated.
        </p>
        <p className="mt-3 text-[14px] text-ink">
          {keys.length ? `Keys found for: ${keys.join(', ')}. Vendors without a key are skipped.` : 'No API keys were found. Add them to .env and restart the API first.'}
        </p>
      </Modal>
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
