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
npm run dev:local      # same, but sign-in OFF + local PGlite DB, API on :8001 (overrides .env / web/.env.local)
npm run app            # Expo dev server + QR code for Expo Go (separate terminal)
npm test               # API tests, API typecheck, web typecheck+build, app typecheck+lint
npm run traffic        # POST /traffic/generate (500 synthetic conversations)
npm run traffic:clear  # delete logged turns only
npm run reset          # wipe traffic, tests and config edits, re-seed
npm run share          # build web, serve dashboard+API on :8000 for the LAN
npm run share:public   # same + Cloudflare quick tunnel; prints a new https://*.trycloudflare.com URL each run
```

A running `share` server reads `web/dist` from disk on every request, so `npm --prefix web run check` (which rebuilds `dist`) updates the shared and public site without a restart. Restarting `share:public` changes the public URL.

Per package:
- **api:** `npm --prefix api test` and `npm --prefix api run typecheck`. To run a single test file, run `node --test --disable-warning=ExperimentalWarning test/router.test.ts` from `api/`. To run one test by name, add `--test-name-pattern="sticky"`.
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

## Routing pipeline

A turn goes through `chat.ts` → `runTurn`:

1. `router.ts` → `decide` builds the route:
   - `classifier.ts` scores the turn using weighted, editable rules; a score of 2 or more counts as complex.
   - Models are filtered by customer policy (vendor and region), language, test-score exclusion, and, in live mode, whether an API key exists.
   - Simple turns are ranked by the cheapest model at or above the quality floor; complex turns by the highest quality.
   - Quality is `effectiveQuality(model, "lang:turnType")` from `store.ts`, which prefers the latest test-run segment scores.
   - Conversations stay pinned to their first model. Complex turns can upgrade the pin when `upgradeStickyOnComplex` is set. Simple turns can leave a pricier pin for the cheapest model above the floor when `downgradeStickyOnSimple` is set (on by default; without it, sticky conversations kept simple follow-ups on the flagship and routing could cost more than the best-model baseline). Saved strategies are merged over `seedStrategy` on load, so new strategy flags get their defaults.
2. `providers.ts` → `callModel(input, mode)` is the single point where demo and live mode diverge:
   - **Demo** simulates cost, latency, errors and canned replies from model settings and vendor outage switches.
   - **Live** makes real HTTPS calls to each vendor.
   - Failover tries the next ranked model and prefers a different vendor. A failure is an error, an open breaker, or a response slower than the latency budget.
3. `runTurn` logs one row to `turns` and returns a `trace` that the dashboard's visualiser replays step by step.

Elsewhere:
- **Tests (`evaluation.ts`):** runs the 24 test conversations in `content.ts` against every model, sets segment scores and `testScore`, and auto-excludes models that fall below the floor.
- **Synthetic traffic (`traffic.ts`):** always uses the simulated providers, even in live mode, so it never spends API credit.

## Product rules that constrain changes

- **Never invent or blur numbers.** Demo values are simulations, and the UI labels them as such (mode banner, `ESTIMATE` / `SIMULATED` tags). Overview savings compare against each customer's best allowed model per language and turn type (`stats.ts` → `savings`). When savings are negative, the UI must call it extra cost, not a saving.
- **Keep the same quality scale.** Routing, savings and what-if all judge quality with segment scores (`effectiveQuality(m, seg)`). Keep them consistent if any of them changes.
- **Keep API keys secret.** Keys are read only from env. `/config` reports only true or false for each vendor.
- **Respect reduced motion in `web/`.** `MotionConfig reducedMotion="user"` plus a CSS fallback handle Motion and CSS. anime.js code must check it itself: `useAnime` skips its setup, and the visualiser checks `useReducedMotion()` and jumps to the final state. Prefer transform and opacity; never animate CSS filters or box-shadow (that once dropped the page to 1 fps). The only exceptions are SVG `stroke-dasharray` drawing and the one-off size morph of the trace panel.
- **Endless motion needs a Pause.** Anything that loops indefinitely and carries information (the routing visualiser) keeps a Pause/Play control.

## Web animation (`web/`)

- **Two libraries, split by job.** Motion (`motion/react`, timings in `lib/motion.ts`) handles UI transitions: page changes, cards entering, modals, layout. anime.js handles continuous loops and SVG path work. In React, anime.js runs through `useAnime(setup, deps)` (`lib/anime.ts`): a `createScope` bound to a ref, so string selectors match only inside the component, and everything is reverted on unmount or when deps change.
- **Orbs (`components/Orb.tsx`).** `Orb` is a model or vendor ball. With `live={vendorState}` it moves, and the motion follows the state: slow moves at reduced speed, down stops and greys out. `BrandOrb` is the ElevenRoute logo (black, with teal, violet and orange lights). Never use a vendor `Orb` as the logo. `drift={false}` keeps a live orb from moving, which is needed inside rings and badges. `outline` draws the ring as part of the orb (ball inset inside it), and `beat` swaps the drift for a heartbeat that moves ring and ball together. `public/favicon.svg` mirrors `BrandOrb`.
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
- **web cache:** `useApi(path, pollMs)` is TanStack Query underneath (`lib/query.ts`), persisted to localStorage. Query keys are `[userId, path]`, and the cache is cleared on sign-out. Any non-GET request invalidates all queries, except the read-only POSTs listed in `READ_ONLY_POSTS` in `api.ts`. Add new read-only POST endpoints there. Bump `CACHE_BUSTER` when a cached response shape changes.
- **app:** `src/lib/api.ts` uses `EXPO_PUBLIC_API_URL` if set; otherwise the Expo dev server's LAN host on port 8000. It signs in with email and password (`components/sign-in.tsx`, `AuthGate` in `_layout.tsx`), and keeps the session in AsyncStorage. Settings are in `app/.env.local`. It has no local cache.
- **Sharing (`scripts/share.mjs`):** open to everyone by default. An optional `SHARE_PASSWORD` is passed to the API as `ACCESS_PASSWORD`; it applies only while sign-in is off, and only to requests arriving through a tunnel or proxy (`cf-connecting-ip` / `x-forwarded-for`). With sign-in off, the script also sets `DEMO_ONLY=1`. Every visitor then shares one workspace, so `canUseLiveMode` returns false and a workspace found in live mode drops back to demo (`api/test/demo-only.test.ts`).

## Current focus

**Sign-in is switched off on purpose (open access).** The owner wants everyone able to use the site. `SUPABASE_URL` (`.env`) and `VITE_SUPABASE_*` (`web/.env.local`) are commented out, and the auth code stays in place. Data still goes to Supabase Postgres via `DATABASE_URL`: migration `0003_open_access.supabase.sql` dropped the `auth.users` foreign key so `LOCAL_USER` can own the shared workspace. Don't turn sign-in back on unless asked.

**Routes:** `/` is the public landing page (`pages/Landing.tsx`, outside `Shell` and `AuthGate`), and the dashboard's Overview lives at `/overview`. The landing page's live stage runs real `/route/preview` dry runs over `/tests/cases`; keep it on real data, and keep its Pause control. It is the only dark page: `.theme-dark` (index.css) redefines the colour tokens inside it, so use token colours (`text-canvas` on `bg-ink`, `var(--color-ink)` in SVG), never hard-coded black or white. It is sized in rem (no `[Npx]` values) so `html.landing-dark` font sizes scale it on 1920/2560/3400 px screens; pixel-drawn orbs scale with `useScale()`, which must match those breakpoints.

The owner is working on the **web dashboard only**. `app/` (Expo) still builds and has sign-in, but it isn't being developed. Don't extend it unless asked.

## Secrets

The secrets live in `.env` (API: `SUPABASE_URL`, `DATABASE_URL` with the database password), `web/.env.local` and `app/.env.local`. All three are gitignored. Never print `DATABASE_URL` or echo it into commands: read it from `.env` inside scripts. `.env.example` documents every variable.

## Environment notes (Windows dev machine)

- PowerShell sessions may need `$env:Path` refreshed from Machine+User for `node`, `npm` and `git` to resolve.
- Phones reach the computer at its LAN IP, which changes between networks, so Expo QR codes and shared links go stale. Node must be allowed through the Windows firewall.
