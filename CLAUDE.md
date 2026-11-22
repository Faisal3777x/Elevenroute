# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ElevenRoute routes each turn of a customer-service conversation to an LLM (OpenAI, Gemini or Anthropic models). For each turn it picks a model, fails over to another vendor when a call fails, tests every model on the same conversations, and reports what everything cost. The repository has three apps and one shared types file:

- `api/`: the router API. Node 24+ (developed on 26) runs the TypeScript source directly through native type stripping, with no build step. It uses `node:http`, and Postgres through `postgres` (Supabase) or `@electric-sql/pglite` (local and tests). `jose` verifies Supabase sign-in tokens. Data is multi-tenant: each user has a personal workspace.
- `web/`: the main dashboard. React 19, Vite, Tailwind 4 (`@theme` tokens in `src/index.css`), Recharts, Motion (`motion/react`) plus anime.js (`useAnime` in `lib/anime.ts` for continuous loops), react-router, Supabase Auth and a persisted TanStack Query cache.
- `app/`: the phone app. Expo SDK 58 with Expo Router native tabs, run through Expo Go. On native it shows four tabs; Rules and What-if exist only in its web build.
- `shared/types.ts`: the API request and response types, used by all three apps.

## Commands

Run these from the repo root. Each subfolder has its own `node_modules`; `npm run setup` installs all three.

```bash
npm run dev            # API on :8000 (node --watch) + web dashboard on :5173 (Vite), Supabase sign-in if configured
npm run dev:local      # same, but sign-in OFF + local PGlite DB, API on :8001 (overrides .env / web/.env.local); prints a Phone: URL for the same Wi-Fi
npm run api            # API only (npm run web: dashboard only)
npm run app            # Expo dev server + QR code for Expo Go (separate terminal)
npm test               # API tests, API typecheck, web typecheck+build, app typecheck+lint
npm run traffic        # POST /traffic/generate (500 synthetic conversations)
npm run traffic:clear  # delete logged turns only
npm run reset          # wipe traffic, tests and config edits, re-seed
npm run share          # build web, serve dashboard+API on :8000 for the LAN
npm run share:public   # same + Cloudflare quick tunnel; prints a new https://*.trycloudflare.com URL each run
```

A running `share` server reads `web/dist` from disk on every request, so `npm --prefix web run check` (which rebuilds `dist`) updates the shared and public site without a restart. Restarting `share:public` changes the public URL.

`traffic`, `traffic:clear` and `reset` go through `scripts/call.mjs`, which calls `API_URL` or else `http://localhost:8000`. Under `dev:local` the API is on :8001, so set `API_URL=http://localhost:8001` first (PowerShell: `$env:API_URL='http://localhost:8001'; npm run traffic`). Otherwise the call misses the local API, and if `share` is running on :8000 it changes the shared database instead. The script always sends an empty body; for endpoints that need one, call the API directly.

Per package:
- **api:** `npm --prefix api test` (about 90 s) and `npm --prefix api run typecheck`. To run a single test file, run `node --test --disable-warning=ExperimentalWarning test/router.test.ts` from `api/`. To run one test by name, add `--test-name-pattern="sticky"`. On this machine the full suite has run out of memory; `--test-concurrency=2` avoids it.
- **web:** `npm --prefix web run check` (`tsc --noEmit && vite build`).
- **app:** `npm --prefix app run check` (`tsc --noEmit && expo lint`).

## API conventions (`api/`)

- **TypeScript must stay erasable.** `erasableSyntaxOnly`, `verbatimModuleSyntax` and `allowImportingTsExtensions` are all on. Imports carry the `.ts` extension. Use `import type` for types, including everything from `shared/types.ts`. Don't use enums, namespaces or parameter properties (declare the field and assign it in the constructor): Node strips types and never compiles anything.
- **`server.ts` is a small hand-written router.** Register endpoints with `route(method, path, handler)`. Handlers receive `{ body, params, query, user, ws }`. Every route requires a signed-in user unless registered with `open = true` (only `/health`). Validate input with the `str` and `oneOf` helpers and throw `HttpError` for 4xx responses. Edits that change several fields (strategy: `STRATEGY_RANGES`; models: `MODEL_RANGES`) validate every field against its range before applying any of them, so a bad field never leaves a half-applied edit, and an empty box is an error, never 0. The same handlers also answer under an `/api/...` prefix, which is what the built dashboard calls.
- **Everything is per workspace.** A `Workspace` (`store.ts`) holds that workspace's cached config (models, strategy, rules, policies, languages, segments, mode) plus in-process state: sticky pins, circuit breaker, simulated outage switches and the traffic job. Functions take `ws` as their first argument (`decide(ws, …)`, `runTurn(ws, …)`, `overview(ws, …)`). Mutate `ws` and then `await ws.save(key)`, which upserts into `workspace_settings`. Routing decisions never touch the database. Every SQL query must filter on `workspace_id`.
- **Users map to workspaces** through `workspace_members`. `workspaceIdFor(user)` creates a personal workspace on first use; `openWorkspace(id)` loads and caches it. Run one API process (the cache and in-process state aren't shared between instances).
- **Auth (`auth.ts`):** with `SUPABASE_URL` set, `Authorization: Bearer <Supabase access token>` is verified locally with `jose` against the project's JWKS (ES256), or `SUPABASE_JWT_SECRET` for legacy HS256 projects. Without it, auth is off and every request is `LOCAL_USER`. Live mode is limited to `LIVE_MODE_EMAILS`.
- **Database (`db.ts`):** `DATABASE_URL` set → Supabase Postgres via `postgres` (the session pooler; the direct host is IPv6-only). Unset → embedded PGlite in `api/data/pglite`, or in memory when `DB_PATH=':memory:'` (tests). It's the same SQL either way: `$1` placeholders; cast `count(*)`/`sum()` to `::int`/`::float8`, because bigints come back as strings. Use `insertMany` for bulk rows (traffic generation inserts ~1,700 turns in one transaction).
- **Migrations** are `api/migrations/NNNN_name.sql`, applied at startup and recorded in `schema_migrations`. Files ending `.supabase.sql` (row-level security, `auth.users` references) run only on Supabase. Never edit an applied migration; add a new file.
- **The `turns` table is the only log.** Overview, savings and what-if (`stats.ts`) are all computed from it.
- **Tests** set `DB_PATH=':memory:'` (and `auth.test.ts` sets fake Supabase env) before importing anything from `src/`, so test files load modules with dynamic `await import()`. Each router test opens a fresh workspace.

## Language

English only. Spanish was removed on 2026-11-17 (Arabic earlier); migration `0008_remove_spanish.sql` deleted Spanish turns and test results, rescored saved test runs on their English results, and stripped Spanish from saved settings. `Language` is still a field on every request, policy and quality segment (`"en:simple"`), so a language can be added back by widening the type and adding content. The dashboard shows no language picker while there is only one language. Don't reintroduce Spanish copy or test content unless asked.

## Routing pipeline

A turn goes through `chat.ts` → `runTurn`:

1. `router.ts` → `decide` builds the route:
   - `classifier.ts` scores the turn using weighted, editable rules (weights can be negative); a score at or above the strategy's `complexThreshold` (default 2) counts as complex.
   - Models are filtered by customer policy (vendor and region), language, test-score exclusion, and, in live mode, whether an API key exists.
   - Simple turns are ranked by the cheapest model at or above the quality floor; complex turns by the highest quality.
   - Quality is `effectiveQuality(model, "lang:turnType")` from `store.ts`, which prefers the latest test-run segment scores.
   - Conversations stay pinned to their first model. Complex turns can upgrade the pin when `upgradeStickyOnComplex` is set. Simple turns can leave a pricier pin for the cheapest model above the floor when `downgradeStickyOnSimple` is set (on by default; without it, sticky conversations kept simple follow-ups on the flagship and routing could cost more than the best-model baseline). Saved strategies are merged over `seedStrategy` on load, so new strategy flags get their defaults.
2. `providers.ts` → `callModel(input, mode)` is the single point where demo and live mode diverge:
   - **Demo** simulates cost, latency, errors and canned replies from model settings and vendor outage switches.
   - **Live** makes real HTTPS calls to each vendor, sending each model's `liveModel` id. It has never been run against real keys, so check those ids and the prices before relying on it.
   - The mode is a per-workspace setting (`ws.mode`, saved under the `mode` key; new workspaces start in demo). Only `POST /mode` with `{"mode": "live"}` changes it, and the dashboard has no button for it. That call is refused under `DEMO_ONLY` and, with sign-in on, for emails outside `LIVE_MODE_EMAILS`. The API reads no `MODE` environment variable.
   - Failover tries the next ranked model and prefers a different vendor. A failure is an error, an open breaker, or a response slower than the latency budget.
3. `runTurn` logs one row to `turns` and returns a `trace` that the dashboard's visualiser replays step by step.

Elsewhere:
- **Tests (`evaluation.ts`):** runs the 12 test conversations in `content.ts` (6 call types × simple and complex) against every model, sets segment scores and `testScore`, and auto-excludes models that fall below the floor.
- **Synthetic traffic (`traffic.ts`):** always uses the simulated providers, even in live mode, so it never spends API credit.

## ElevenAgent (`api/src/agent.ts`, `web/src/pages/Agent.tsx`, route `/agent`)

A stateful agent that sits above the router. It is the demo of the "ElevenAgent Enterprise Core" half of the business strategy the site illustrates; ElevenRoute is the other half.

- **The agent owns the state, the router owns the model.** `agentTurn(ws, req)` runs one loop per customer turn: read the turn into the session's slots → run every tool whose slots are filled → pick the reply → call `runTurn`, which routes the turn like any other. Sessions live in `ws.agentSessions` (in-process, bounded, cleared by reset), so a model switch or failover between turns never loses the conversation.
- **Scenarios are data.** `SCENARIOS` holds each one's slots, tools, slot finders, simulated connector results, replies and a script. `scriptFills` names the slot each script line supplies; the page uses it to suggest the next customer line. `api/test/agent.test.ts` plays every script and requires it to reach its goal with at least one simple and one complex turn, so keep that true when editing a script or the classifier rules.
- **Writes wait for a yes.** A tool with `write: true` runs only after the `confirm` slot is "Yes", and a "yes" counts only when the agent was waiting for it.
- **Everything outside the router is simulated and labelled so.** The Salesforce Service Cloud and SAP S/4HANA connectors return fixed records and make no network call. The agent always uses the simulated providers (`simulated: true`, even in live mode) with a reply chosen by the state machine, passed through `TurnOptions.script`, which also bills the turn for its context tokens (the conversation so far plus the state). Keep the sample-connector notes (under "What it does" on `/agent`, and at the foot of the landing's `AgentStage`), and don't describe the connectors as real integrations.
- Agent turns are logged in `turns` like Playground turns, so they count in Overview and savings.
- **Each call is priced against the one-model baseline.** `bestAllowedModel` (`router.ts`) is the single definition of "best allowed model"; `stats.ts` → `savings` and the agent both use it, so the per-call figure and the Overview figure can't drift apart. When routing costs more than the baseline the page says "extra cost".
- **Dry runs:** `POST /agent/preview` runs the same loop with `{ dry: true }`: nothing is logged, nothing waits (`virtual`), failures go to a throwaway breaker, and a finished session is dropped. It is listed in `READ_ONLY_POSTS`.
- **The page replays each turn** (`useReplay` in `Agent.tsx`): one API response is shown step by step in the order the agent worked (learned → system calls → route → reply), and `sessionAt` masks the state so nothing from a turn shows before its step. Only the pacing is added; with reduced motion the turn shows at once. "Play the call" ends by itself and has a Stop button.
- **`components/AgentStage.tsx`** is the landing page's live agent stage: the three scripted calls through `/agent/preview`. It loops, so it keeps Pause and Next, holds still off-screen, starts paused under reduced motion, and requests each turn once (a ref guards against development's double effects, which would otherwise send a line twice and make the agent re-ask).

## Product rules that constrain changes

- **Never invent or blur numbers.** Demo values are simulations, and the UI says so, quietly:
  - **Official look (owner's choice, 2026-11-17).** No grey "Demo mode" banner, no Demo/Live switch, no dashed `SIMULATED` / `ESTIMATE` tags, no "dry run" jargon in visible copy.
  - **The labels that stay.** One "Sample data" note on every dashboard page (`DataNote` in `App.tsx`: the sidebar on desktop, the page foot on phones), short "Sample data" lines on the landing page, and the sample-connector notes on the agent pages. Never remove them while providers are simulated, and never word a simulated figure as measured. Live mode shows a cost-warning strip (`LiveBanner`).
  - **Savings.** Overview compares against each customer's best allowed model per language and turn type (`stats.ts` → `savings`). When savings are negative, the UI calls it extra cost, not a saving. What-if results are "projected".
  - **Formatting.** `money()` (`lib/format.ts`) keeps three significant digits under $1, so a $0.015 price never reads "$0.01". Negative numbers use a true minus (`signed()`).
- **Keep the same quality scale.** Routing, savings and what-if all judge quality with segment scores (`effectiveQuality(m, seg)`). Keep them consistent if any of them changes.
- **Keep API keys secret.** Keys are read only from env. `/config` reports only true or false for each vendor.
- **Respect reduced motion in `web/`.** Reduced motion means less movement, not no feedback. `MotionConfig reducedMotion="user"` covers Motion; the CSS rule at the end of `index.css` stops keyframes and loops and limits transitions to colour and opacity (fades stay, movement goes; the loading spinner keeps turning). Things that don't follow it on their own check `useReducedMotion()` themselves: anime.js (`useAnime` skips its setup; the visualiser jumps to the final state), Motion values bound to `style` (the hero orb's pointer lean doesn't attach), and the hero's delays (dropped). The scroll-driven hero effect has its own `@media` off switch.
- **Animate cheaply (`web/`).** Animating CSS filters or box-shadow once dropped the page to 1 fps, so:
  - Animate transform and opacity only. Predetermined loops are CSS keyframes (they run on the compositor); JavaScript loops cost main-thread time every frame (measured: the old anime.js orb loops were 43 ms of script a second on Providers).
  - Tailwind rings are box-shadows too, so `transition-[…]` lists never include `box-shadow`.
  - Bars grow with `scaleX` from `origin-left`, not `width`. Sliding pills (`useIndicator`) move by `translate`.
  - No Motion `layoutId` pills: their shared layout animation runs on the main thread, often while the next page loads. Use `useIndicator` (`lib/indicator.ts`). `layout` stays only where items really reorder (the ranked candidates, the vendor tie-break chips, alerts, the landing stage's queue).
  - No `mix-blend-mode` and no always-on `backdrop-blur` over animated content. The landing header blurs only once scrolled.
  - Exceptions: SVG `stroke-dasharray` drawing, the one-off size morph of the trace panel, and the height grow of new lines in the landing's call stage (its column is `contain`ed).
- **Endless motion needs a Pause.** Anything that loops indefinitely and carries information (the routing visualiser, the landing demos) keeps a Pause/Play control. Decorative loops (living logos and orbs, drifting glows) are welcome; they are CSS keyframes, pause off-screen and stop under reduced motion.

## Web animation (`web/`)

**The owner wants the site to feel alive.** Improve and add motion; never remove an animation to follow a "restraint" rule (a skill's or anyone's). If removing something seems right, ask first. The craft comes from Emil Kowalski's skills in `.claude/skills/` (`animate`, `choreograph`, `improve-animations`, `animation-performance`, `emil-design-eng`, `gestures`, `mobile-native`, `break-ui`, `apple-design`…): use them for *how* to animate (performance, curves, choreography, interruption, reduced motion), not as a reason to delete motion.

- **Three tools, split by job.** CSS keyframes and transitions for predetermined motion (entrances, orb loops, glows, pills): they run on the compositor. Motion (`motion/react`, tokens in `lib/motion.ts`: `EASE`, `fast`, `base`, `spring` with a light 0.15 bounce, `DRAWER`) for interactive UI: dialogs, tooltips, toasts, collapses, presses, value changes, the hero's pointer lean. anime.js for SVG path work and the scripted timelines of the visualiser and the landing stage, through `useAnime(setup, deps)` (`lib/anime.ts`): a `createScope` bound to a ref, reverted on unmount or when deps change, paused off-screen. `useOnScreen` lets step-by-step stages stop stepping off-screen.
- **Entrances (CSS, `index.css`).**
  - Dashboard pages: `Page` has `.page-enter`, so its sections rise in as one quick wave with shrinking gaps; content that mounts later rises in too. A grid marked `.cascade` brings its cards in one by one (KPIs, score cards, What-if tiles, the trace steps, the agent's result chips).
  - Landing sections: `Reveal` flags `data-in` when it scrolls into view; the title leads (`rise-in-lead`), the rest follow, `.fine` print fades, `.reveal-cascade` items flow in, and `.icon-pop` icons pop a beat later. Hidden-until-revealed only applies when motion is allowed.
  - Data: charts grow in (Recharts, 750 ms ease-out) and animate changes; score bars grow from zero (`scaleX`); `AnimatedNumber` counts up on first show and animates every change (`startOnView` for figures below the fold).
- **Interaction.**
  - Sliding "active" pills use `useIndicator` with the springy `--ease-spring` curve: navigation 280 ms, segmented controls and tabs 260 ms, the agent's loop strip 320 ms.
  - Presses: Motion buttons use `whileTap` (0.97); plain buttons use the `.press` class. Button icons nudge on hover; sidebar icons lift. Buttons show their spinner only after 200 ms, so quick saves don't flash.
  - Cards that show figures (KPIs, score cards, What-if tiles) carry a soft light that follows the mouse (`spotlight()` in `lib/spotlight.ts`, non-inheriting `--mx/--my`), instead of a lift that would suggest they can be clicked.
  - Tooltips wait 400 ms on hover (open at once on focus), grow from the trigger in 125 ms, and the next one within 300 ms opens instantly. Chart tooltips glide quickly (160 ms).
  - The dialog rises from centre on desktop and slides up as a sheet on phones (`DRAWER` curve), where it can be swiped down: 1:1 tracking from the grab handle, rubber-band upward, closes past 35% or on a flick, otherwise springs back with the finger's speed; the scrim fades with the drag.
- **Landing.** The hero is one wave: two headline lines rise out of their masks 110 ms apart, the sentence and buttons follow, the pill, provider row and orb fade in; done in about 0.8 s, with no delays under reduced motion. Its orb leans towards the mouse (a spring) and rises and dims on scroll (CSS scroll-driven animation). The header logo beats, the provider dots and the eyebrow dot are alive, and the glows drift (`.glow-drift`, also on the Overview and What-if banners).
- **Orbs (`components/Orb.tsx`).** `Orb` is a model or vendor ball. With `live={vendorState}` it moves, and the motion follows the state: slow moves at reduced speed, down stops and greys out. The loops are CSS keyframes (`index.css`, "Living orbs") with per-orb timing in inline `--orb-*` properties; off-screen orbs pause. `BrandOrb` is the ElevenRoute logo (black, with teal, violet and orange lights). Never use a vendor `Orb` as the logo. `drift={false}` keeps a live orb from moving, which is needed inside rings and badges. `outline` draws the ring as part of the orb (ball inset inside it), and `beat` swaps the drift for a heartbeat that moves ring and ball together. `public/favicon.svg` mirrors `BrandOrb`.
- **Phones.** `viewport-fit=cover` with `env(safe-area-inset-*)` padding (body sides, the floating nav, the page bottom, the sheet); inputs are 16 px on touch screens (no iOS zoom); no tap flash, so every control has a press state; chat lists use `overscroll-contain`. `theme-color` is light for the dashboard and black on the landing page (`index.html` sets it, and the black page background, before any script loads; `Landing.tsx` restores the light one on leave).
- **`RoutingVisualiser`** replays one real trace (from `/chat` or a `/route/preview` dry run; never invented):
  - `buildSteps` turns the trace into timed steps. Each loop starts with an `idle` reset, and `LOOP_HOLD_MS` holds the finished route.
  - `routePaths` computes, before render, the SVG path the dot follows and the chosen connection's path.
  - anime.js effects then animate them: `svg.createDrawable` draws the `[data-conn]` lines in and out, `svg.createMotionPath` moves the dot along the exact curve, and a looping drawable sends light along the chosen connection.
  - Node boxes stay React and Motion.
  - `TracePanel` is the "Real routing trace" pill that morphs into the step log with anime.js. It uses `flushSync` so the target size can be measured.

## Clients: API, sign-in and cache

- **web:** `src/lib/api.ts` uses `VITE_API_URL` if set. Otherwise it uses `host:8000` in Vite dev and same-origin `/api` in the production build, which the API serves when `SERVE_WEB=1`. It attaches the Supabase access token and signs out on a 401.
- **web sign-in:** `lib/supabase.ts` (client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in `web/.env.local`; `null` means sign-in is off), `lib/auth.tsx` (`useAuth`), `pages/SignIn.tsx`. `AuthGate` in `App.tsx` renders nothing else until there's a session. Supabase is used for auth only; all data goes through the API.
  - `flowType: 'implicit'` is deliberate. PKCE email links only complete in the browser that started sign-up, which broke confirmations opened on a phone.
  - Email links return to `window.location.origin`, so every origin used must be allowed in Supabase → Authentication → URL Configuration (including `https://*.trycloudflare.com/**`).
  - The SignIn page reads `/auth/v1/settings` and disables provider buttons that aren't enabled (Google currently isn't).
  - Supabase's built-in mailer sends only a few emails per hour. "Email rate limit" errors come from Supabase, not the app; password sign-in needs no email.
- **web cache:** `useApi(path, pollMs)` is TanStack Query underneath (`lib/query.ts`), persisted to localStorage; a `null` path skips the request. Query keys are `[userId, path]`, and the cache is cleared on sign-out. Any non-GET request invalidates all queries, except the read-only POSTs listed in `READ_ONLY_POSTS` in `api.ts`. Add new read-only POST endpoints there. Bump `CACHE_BUSTER` when a cached response shape changes.
- **app:** `src/lib/api.ts` uses `EXPO_PUBLIC_API_URL` if set; otherwise the Expo dev server's LAN host on port 8000. It signs in with email and password (`components/sign-in.tsx`, `AuthGate` in `_layout.tsx`), and keeps the session in AsyncStorage. Settings are in `app/.env.local`. It has no local cache.
- **Sharing (`scripts/share.mjs`):** open to everyone by default. An optional `SHARE_PASSWORD` is passed to the API as `ACCESS_PASSWORD`; it applies only while sign-in is off, and only to requests arriving through a tunnel or proxy (`cf-connecting-ip` / `x-forwarded-for`). With sign-in off, the script also sets `DEMO_ONLY=1`, so `canUseLiveMode` returns false and a workspace found in live mode drops back to demo (`api/test/demo-only.test.ts`).
  - **Visitor sandboxes (`api/src/sandbox.ts`, on whenever sign-in is off and `DEMO_ONLY=1`, i.e. the public site).** The shared demo workspace is read-only to the public: GETs and the `READ_ONLY_POSTS` (mirrored in `server.ts` and `web/src/lib/api.ts`) read it, and a visitor's first change copies it (settings, turns, test runs, alerts) into a private sandbox keyed by the browser's random `x-visitor-id` (localStorage `er-visitor`). "Reset everything" deletes the sandbox. Changes without a visitor id get 403. Sandboxes idle 48 h are deleted hourly; at most 300 exist and 40 per IP a day (a classroom shares one IP). Only requests with `x-admin-token: $ADMIN_TOKEN` (in `.env` and on Render) change the shared demo: use it to regenerate the demo's traffic or tests (`api/test/sandbox.test.ts`).
  - **Hardening (`server.ts`, `limits.ts`):** per-IP rate limits sized for a classroom behind one IP (3000/min, writes 600/min, heavy jobs 60 per 10 min; one landing-page visitor makes ~64 calls a minute; IP from `cf-connecting-ip`, which Render's Cloudflare sets; `GET /admin/client-ip` with the admin token shows it), 64 KB bodies, bounded inputs, generic 500 messages, security headers on every response, a CSP on pages (inline scripts allowed by hash, computed from the built `index.html`), HSTS over HTTPS, and CORS limited to `CORS_ORIGINS` when set. A new external resource on the site needs its origin added to the CSP in `contentSecurityPolicy()`.
  - `share:public` runs `cloudflared` over HTTP/2 (`--protocol http2`; QUIC was unreliable), keeps the computer awake while it runs, and has a watchdog: after 3 failed checks 30 s apart it starts a new tunnel. A new tunnel means a new URL, and the current one is always written to `tools/public-link.txt`, so read that file when a user says the link stopped working.
- **Hosting (`render.yaml`):** a Render Blueprint for one always-on web service (Starter plan, Frankfurt, `SERVE_WEB=1`, `DEMO_ONLY=1`, health check `/health`, auto-deploy on push). `DATABASE_URL` is `sync: false` (entered only in Render's dashboard), and `REQUIRE_DATABASE_URL=1` makes `api/src/main.ts` exit rather than fall back to PGlite on an ephemeral disk. Only one copy (Render or `share:public`) should run against the same database at a time: each caches workspace settings in memory and they would overwrite each other's edits.
  - **Live since 2026-11-18 at https://elevenroute.onrender.com** (service `elevenroute`, the only one; Blueprint "Website"), and since 2026-11-19 at the custom domain **https://elevenroute.com** (registered at Cloudflare; `www` and `http` redirect to it). Its DNS is two CNAMEs (`@`, `www`) to `elevenroute.onrender.com`, DNS-only so Render issues the certificate; the MX/SPF/DKIM records are Cloudflare email routing; a `_dmarc` TXT record (quarantine) blocks spoofed mail, and DNSSEC is on (enabled 2026-11-19). `CLOUDFLARE_API_TOKEN` in `.env` manages that DNS (same rules as the Render key). Render's `DATABASE_URL` must be Supabase's **session pooler** address (`*.pooler.supabase.com`, as in `.env`): the direct `db.*.supabase.co` host is IPv6-only and times out on Render, which failed every early deploy.
  - The owner wants Claude to manage Render through its API (`https://api.render.com/v1`) with `RENDER_API_KEY` from `.env`: read both keys inside scripts, never print them. Debug a failed deploy from the service's deploys and `/logs`, then check `/health`, the pages and `/promo.mp4` on the live URL.
  - The static server streams files with their MIME type and honours byte ranges (`sendFile` in `server.ts`): Safari won't play the ad without `video/mp4` and range support.

## Current focus

**Sign-in is switched off on purpose (open access).** The owner wants everyone able to use the site. `SUPABASE_URL` (`.env`) and `VITE_SUPABASE_*` (`web/.env.local`) are commented out, and the auth code stays in place. Data still goes to Supabase Postgres via `DATABASE_URL`: migration `0003_open_access.supabase.sql` dropped the `auth.users` foreign key so `LOCAL_USER` can own the shared workspace. Don't turn sign-in back on unless asked.

**Routes:** `/` is the public landing page (`pages/Landing.tsx`, outside `Shell` and `AuthGate`), and `/about` the public About Us page. The dashboard pages, one file each in `pages/`, are `/overview`, `/playground`, `/agent`, `/rules`, `/providers`, `/tests` and `/whatif`. `NAV` in `App.tsx` lists them, and any other path shows Overview. Wherever the landing page describes ElevenAgent (the hero sentence, the "Handle a whole call" tab, the third reason), it may only claim what the `/agent` page does. The landing page's live stage runs real `/route/preview` dry runs over `/tests/cases`; keep it on real data, and keep its Pause control. The hero orb leans towards the mouse pointer (a Motion spring) and rises and dims as the page scrolls (CSS scroll-driven animation); see "Web animation". The hero previews the caller behind "Play a live call" (`useCaller` in `Landing.tsx`). One silent 700 ms ripple leaves an orb's outer ring (`.voice-ring` draws it and `.caller-ripple` moves it, so use both). Then "I’ve been charged twice." fades in, word by word, in space kept for it. It never delays the link.
- **xl and up with a mouse:** the big orb speaks while the button is hovered or keyboard-focused.
- **Everywhere else (phones, tablets, touch):** a small orb under the buttons (`CallerRow`), or the big one on a wide touch screen, speaks once as the hero lands. The line then stays, and hover or focus sends another ripple.
- **Reduced motion:** the line is simply there, with no ripple.

The live routing stage animates on every screen: curves left to right from lg up, and below lg a rail down through the router with a branch into each model (`Geo` `kind: 'rail'`).

**About Us (`/about`, `pages/About.tsx`):** the team page, linked from the header and footer. The intro, names, roles, contributions and closing line are the owner's wording; don't rewrite them. The logo sits at the centre of an equilateral triangle. When it first comes into view, one ripple leaves the logo while thin lines grow out to the three people at the same pace (CSS, `.team[data-play]` in index.css). Names and roles show at once. Hover, keyboard focus or a tap reveals each person's words in space kept for them. On phones the people are stacked under the logo on one line, and a tap opens each one. Under reduced motion the lines are simply there. Below the team, "How the website was made" (`CREDITS`) credits only what the repo confirms: Claude Code (co-authored commits), Emil Kowalski's skills (`skills-lock.json`) and the owner's own soundtrack for the homepage film. Leave the presentation film's credits out until its voices are final, and add nothing else unless the owner confirms it. The page ends on the closing line and one link, "Play the refund call" (`/agent`, which opens on the refund call).

**Public pages:** `/` and `/about` are the dark pages. They share their header, footer, theme hook and section pieces through `components/Site.tsx` (`SitePage`, `useDarkPage`, `useScale`, `Reveal`, `CtaLink`…); `index.html` paints both black before load. `.theme-dark` (index.css) redefines the colour tokens inside them, so use token colours (`text-canvas` on `bg-ink`, `var(--color-ink)` in SVG), never hard-coded black or white. They are sized in rem (no `[Npx]` values) so `html.landing-dark` font sizes scale them on 1920/2560/3400 px screens; pixel-drawn orbs scale with `useScale()`, which must match those breakpoints.

**The landing page is the hook, not the manual.** Order: hero (one line to remember, one sentence, two CTAs) → ad slot → live demo → three reasons → proof → closing CTA. Keep it short: explanations belong on the dashboard page that shows them (the four routing steps are on Routing rules, the agent's three points on ElevenAgent, both via `components/HowItWorks.tsx`), and each reason on the landing page links there. The live demo shows one stage at a time in tabs (`Stage` for routing, `AgentStage` for a call), so only the visible one runs. The proof figures hide until there is traffic. The hero must fit the first view on a 1366 × 768 laptop: the headline is sized from the width beside the orb and from the screen height (`svh`), and stays two lines on laptops and desktops; the ad frame is capped at the screen height.

**Ad slot:** `web/src/lib/promo.ts` → `PROMO` (a video file in `web/public`, a YouTube id, or an image banner), shown in a 16:9 frame right under the hero by `components/PromoSlot.tsx`. A video plays by itself, muted and looping, while half of it is on screen, and pauses off screen; under reduced motion it waits for a click. Browsers only autoplay muted, so a **Sound on** button restarts it from the top with sound and fades away once the sound is on. With `PROMO = null` there is no slot at all, in development too (the page closes up around it).

**Ad film:** `PROMO` is `web/public/promo.mp4` (71.8 s, 1920×1080, H.264 with an AAC soundtrack) with `promo-poster.jpg`, rendered from `pages/AdFilm.tsx` at the `/ad` route (outside `Shell`).
- The film is a pure function of time: `/ad` plays it live (silent) and loops; `/ad?render` exposes `window.__adSetTime(seconds)` for frame-by-frame capture.
- Music (the owner's choice, 2026-11-18): the soundtrack of the owner's own video `ElevenRoute-showcase.mov` (110.02 BPM, a four-bar loop). Its rights are the owner's; keep the source audio out of git (`tools/ad-music-source.wav`, made by `scripts/ad-music.mjs --source …`). The script extends it by two loops (bars 0–19, 12–19 again, then the riser and final hit) and gives the outage a stutter and a low-pass dip. Earlier choices, replaced: a paid AudioJungle track (never take music from YouTube) and Mixkit's "Close Up".
- Timing: the scenes are written in 2 s "story" bars and play one music bar (2.1814 s) per story bar, 9% slower than written, starting one bar before the drums; the CFO's reply gets one extra bar for the riser (`storyAt()`/`realAt()`). Every scene starts on a bar line; `KICKS` drives the beat pulses. Changing the edit means changing those, `FILM_SECONDS` and the script's `LENGTH` together.
- To change it: edit, then re-render the frames, rebuild the music and mux them (README, "Ad film").
- Story: hook (every message goes to the most expensive AI) → the CFO's message → build → drop and reveal → every turn routed → before/after → failover → ElevenAgent → four features → same quality bar, less spend → payoff → end card. Its honesty rules: the cost bars use the demo's sample-traffic ratio (`SAMPLE_RATIO`) and say so, the routing scenes carry "Product illustration · sample data", the connectors are "Sample connectors", and no other figure is claimed.

The owner is working on the **web dashboard only**. `app/` (Expo) still builds and has sign-in, but it isn't being developed. Don't extend it unless asked.

## Secrets

The secrets live in `.env` (API: `SUPABASE_URL`, `DATABASE_URL` with the database password), `web/.env.local` and `app/.env.local`. All three are gitignored. Never print `DATABASE_URL` or echo it into commands: read it from `.env` inside scripts. `.env.example` documents every variable.

## Environment notes (Windows dev machine)

- PowerShell sessions may need `$env:Path` refreshed from Machine+User for `node`, `npm` and `git` to resolve.
- Python isn't installed. Write helper scripts in Node.
- Phones reach the computer at its LAN IP, which changes between networks, so Expo QR codes and shared links go stale. Node must be allowed through the Windows firewall.
- **Checking animations in the Playwright browser:**
  - Call `page.bringToFront()` first. A tab behind another tab is throttled to 1–2 fps and its IntersectionObservers stop firing, which looks exactly like broken animations.
  - Playwright saves its files in `.playwright-mcp/` at the repo root. It isn't gitignored, so delete it when done.
  - The user may have tabs of their own open there; leave them alone.
