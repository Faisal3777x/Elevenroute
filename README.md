# ElevenRoute

Model-agnostic routing for voice and chat agents. ElevenRoute sits between customer-service agents and LLM providers (OpenAI, Google Gemini, Anthropic). For every conversation turn it picks the best model, retries on another provider when one fails, tests every model on the same conversations, and shows what it all costs.

| Part | Stack | Where |
|---|---|---|
| Router API | Node.js 24+ and TypeScript, `node:http`; Postgres via `postgres` (Supabase) or `@electric-sql/pglite` (local), `jose` for sign-in tokens | `api/` |
| Database and sign-in | Supabase: Postgres with row-level security, Supabase Auth (email + password, magic link, Google) | `api/migrations/` |
| Web dashboard | React 19, Vite 8, TypeScript, Tailwind CSS 4, Recharts 3, Motion for React | `web/` |
| Phone app | Expo SDK 58, React Native 0.88, Expo Router, TypeScript, react-native-svg | `app/` |
| Shared types | TypeScript types used by all three | `shared/types.ts` |

## Run it

Needs Node.js 24 or later.

```bash
npm run setup      # install api/, web/ and app/ dependencies
npm run dev        # API on :8000 and the web dashboard on :5173
npm run app        # (second terminal) Expo dev server with the QR code for the phone
```

- **Web dashboard:** http://localhost:5173
- **Phone:** install Expo Go, connect the phone to the same Wi-Fi as the computer, and scan the QR code. The app finds the API on your computer automatically (same address as the Expo server, port 8000).
- **Fill the dashboard:** click **Generate traffic** on Overview, or run `npm run traffic`.

On Windows, allow Node.js through the firewall on private networks when prompted, or the phone can't reach the computer.

| Command | What it does |
|---|---|
| `npm test` | API tests (`node --test`), API type-check, web type-check and build, app type-check and lint |
| `npm run traffic` | send 500 synthetic conversations through the router |
| `npm run traffic:clear` | delete all logged traffic; keep models, rules, policies and test results (same as **Reset traffic** on Overview) |
| `npm run reset` | wipe traffic, tests and edits, then re-seed the demo |
| `npm run web` | web dashboard only (Vite on :5173) |
| `npm run dev:local` | for editing: website on :5173 + API on :8001 with **sign-in off** and a local database (`api/data/pglite`), ignoring the Supabase settings. Runs alongside `share` / `share:public` |
| `npm run share` | share the dashboard with your team on your network, open to everyone (see below) |
| `npm run share:public` | the same, plus a public HTTPS link anyone can open |

## Share with your team

`npm run dev` only works on your own computer. To let teammates open the dashboard:

1. Close the "ElevenRoute API" window or stop `npm run dev`. Sharing runs its own copy of the API on port 8000.
2. Run `npm run share:public` for teammates anywhere, or `npm run share` for teammates on the same Wi-Fi or office network.
3. Send them the links printed in the window: the web dashboard link and, for phones, the Expo Go link (`exp://<your-ip>:8081`, with `npm run app` running in another window). Nobody needs a password or an account: the public link opens on the landing page, and "Open dashboard" goes straight in.

| | `npm run share` | `npm run share:public` |
|---|---|---|
| Who can open it | people on your network: web dashboard and Expo Go | also anyone with the public link (web dashboard) |
| Link | `http://<your-ip>:8000`, `exp://<your-ip>:8081` | `https://<random>.trycloudflare.com` (new each run) |
| Password | none | none, unless you set `SHARE_PASSWORD` |
| Needs | Windows firewall allowing Node.js | internet; `cloudflared` (downloaded to `tools/` on first run on Windows) |

- The dashboard is built (`web/dist`) and served by the API itself on one port. It calls the API under `/api/...`.
- **Password (optional):** set `SHARE_PASSWORD` (8+ characters) in `.env` to require it on the public link (username: anything). Without it the link is open to everyone. It applies only to requests through the tunnel (except `/health`) and only while sign-in is off. Direct connections on your network stay open so Expo Go keeps working; set `REQUIRE_PASSWORD_LOCALLY=1` to guard those too (the phone app then can't connect).
- **Your computer must stay on**, with the share window open. Closing it stops sharing.
- **Everyone shares one demo.** With sign-in off, visitors share one workspace: they can generate or reset traffic and edit models and rules. Live mode is locked (`DEMO_ONLY=1`), so nobody can spend the API keys in `.env`.
- **Expo Go for teammates elsewhere** needs both Metro and the API on public addresses (`npx expo start --tunnel` plus `EXPO_PUBLIC_API_URL`), or a deployed API with an EAS Update. On the same network it works as is.
- **With Supabase sign-in on**, the share password is not used: every teammate signs in with their own account and gets their own workspace.
- For a permanent, always-on link, deploy to Render (below).

## Hosting on Render (always on)

`render.yaml` is a Render Blueprint for one always-on web service in Frankfurt (next to the Supabase database). It builds the dashboard, starts the API with `SERVE_WEB=1`, runs with `DEMO_ONLY=1` (open access, live mode locked), and checks `/health`.

1. Push this repository to GitHub (a private repository is fine).
2. In Render: **New → Blueprint**, connect GitHub, pick the repository.
3. When asked for `DATABASE_URL`, paste the Supabase **Session pooler** connection string. It is stored only in Render. Without it the service refuses to start, rather than losing data on a temporary disk.
4. Keep the **Starter** plan; the free plan sleeps after 15 minutes without visitors.

To edit afterwards: change the code locally (`npm run dev:local`), commit, and `git push`. Render rebuilds and redeploys in about two minutes. Only run one shared copy against the same database at a time (stop `npm run share:public` once Render is live): each copy caches the workspace settings, so two copies can overwrite each other's edits.

## Database, sign-in and workspaces

**Sign-in is currently off (open access).** `SUPABASE_URL` in `.env` and `VITE_SUPABASE_*` in `web/.env.local` are commented out, so nobody signs in and everyone shares one workspace. Data still goes to Supabase Postgres through `DATABASE_URL` (migration `0003_open_access` lets the shared local user own a workspace there). Uncomment those lines to bring sign-in back.

Without Supabase settings everything runs locally: an embedded Postgres (PGlite) in `api/data/pglite` and sign-in off (every request acts as one local user). With Supabase:

| Where | Settings |
|---|---|
| `.env` (API) | `SUPABASE_URL`, `DATABASE_URL` (Session pooler connection string, IPv4), optional `LIVE_MODE_EMAILS` |
| `web/.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `app/.env.local` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

- **Workspaces.** Each user gets a personal workspace on first sign-in, seeded with the demo setup. Models, rules, policies, traffic, test runs and alerts all belong to a workspace (`workspace_id`), and `workspace_members` links users to workspaces, so shared team workspaces can be added later without reshaping tables.
- **Who sees what.** The API verifies the Supabase access token on every request (`Authorization: Bearer`, checked locally against the project's published keys) and scopes every query to the caller's workspace. Row-level security in Supabase allows signed-in users to read only their own workspaces' rows and allows no writes through the public API, so the publishable key exposes nothing.
- **Migrations** live in `api/migrations/` and run automatically when the API starts (`*.supabase.sql` only on Supabase). They're recorded in `schema_migrations`.
- **Live mode** spends the server's API keys, so only emails in `LIVE_MODE_EMAILS` can switch their workspace to it.
- **Local cache (web).** The dashboard keeps every API response in a TanStack Query cache saved in the browser: pages open instantly with the last data and refresh in the background; changes refresh affected pages. The cache is keyed by user and wiped on sign-out.
- **Phone app** signs in with email and password (magic links and Google are on the web).

Supabase dashboard settings: Authentication → URL Configuration must list every address the dashboard is opened from (for example `http://localhost:5173`, `http://localhost:8000`, `http://<your-ip>:8000`), or email links and Google sign-in can't return to it. Google sign-in also needs a Google OAuth client added under Authentication → Providers → Google.

## Modes

| | Demo (default) | Live |
|---|---|---|
| API keys | none | at least one of `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` in `.env` |
| Providers | simulated cost, latency, error rate, quality, canned replies in English | direct HTTPS calls to each vendor's API |
| Test judge | simulated from quality settings plus noise | strongest model that has a key |

Copy `.env.example` to `.env`. Demo or live is a setting of each workspace (new ones start in demo). The dashboard has no switch for it: send `POST /mode` with `{"mode": "live"}` (or `"demo"`). A shared server (`DEMO_ONLY`) refuses live mode. Keys are read only from the environment and never stored, logged or returned (`/config` reports only true or false per vendor). Synthetic traffic always uses the simulated providers, so it never spends API credit.

Demo prices, latencies and quality scores are illustrative simulation settings, not vendor quotes.

## How routing works

1. **Classify** the turn as simple or complex with editable, weighted rules: long turn +2, very short −1, multi-step +1, dispute/refund keywords +2, confirmation −3, order number or time −1, refund/complaint call +1. Score ≥ 2 means complex.
2. **Filter** models by customer policy (vendors, data region), language support, test-score exclusion, and (in live mode) API key presence.
3. **Rank.** Simple turns go to the cheapest model at or above the quality floor (0.78; a language or customer can raise it). Complex turns go to the highest-quality model. Quality comes from the latest test scores for that language and turn type when available.
4. **Sticky:** a conversation stays on its first model. Escalating calls upgrade to a stronger model (on by default; switch it off on Routing rules).
5. **Circuit breaker:** after 2 failures in 30 s, a vendor goes to the back of the queue for 20 s.
6. **Failover:** errors or responses slower than the 2,000 ms budget retry on the next ranked model, preferring a different vendor. If everything fails, the caller gets an apology and a human handoff in their language.

Every decision carries a plain-English reason and a full route trace.

## Web dashboard (`web/`)

| Page | What it shows |
|---|---|
| Overview | estimated savings vs a best-model baseline, eight animated KPIs with week-over-week trends and explanations, the **routing visualiser**, cost per model over time (filterable chart or table), where turns go, failover history |
| Playground | chat with the router; per reply: model, simple/complex badge, cost, latency, routing time, reason, a "Why this model?" trace timeline, failover notifications; the visualiser replays the selected reply |
| Routing rules | live dry-run preview (score gauge, matched rules, animated candidate ranking, diagram), quality-threshold scale, customer policies with allowed models, strategy, language preferences, classifier rules |
| Providers | a card per provider with Healthy / Down / Slow switches, breaker and key status, model tiles (pricing, latency, quality, test score vs floor), edit and add dialogs, and a traffic-redirect panel during a simulated outage |
| Test results | animated run progress, scorecards with change vs the previous run, model comparison chart, heatmap by call type / language / turn type, quality alerts, expandable scored conversations, run history |
| What-if | traffic-share slider, projected savings headline, current vs optimised allocation chart, quality / latency / policy trade-offs |

**Routing visualiser.** Replays one real routing trace step by step: request → classification → policy, language and quality checks → each provider attempt (failed attempts turn red and fail over) → selected model → response back to the customer. It only draws what the API returned (`/chat` traces, or `/route/preview` dry runs, which are labelled as such). Play, pause and replay controls; with reduced motion it shows the final route as a static diagram plus a written step list.

**Honesty rules.** The site looks like a product, not a prototype, but simulated numbers are never passed off as measurements: every dashboard page carries one quiet "Sample data" note (sidebar on desktop, page foot on phones), the landing page says "Sample data" under its live demos and figures, and the agent pages say the Salesforce and SAP connectors are sample connectors. Savings are called *estimated* (Overview) or *projected* (What-if). Simulated outages are labelled as test switches. Live mode, when switched on through the API, shows a cost-warning strip.

**Motion.** Shared settings in `web/src/lib/motion.ts` (150–400 ms for interface motion, springs for presses and layout). `MotionConfig reducedMotion="user"` plus a CSS fallback respect `prefers-reduced-motion`. Animations use transform and opacity; hover elevation fades a pseudo-element's shadow (`.lift`) rather than animating `box-shadow`. The landing hero's orb leans towards the pointer and settles as you scroll (mouse only, off with reduced motion).

## Phone app (`app/`)

Overview, Playground, Providers and Tests tabs on iOS and Android (Expo Go). Its web build still works, but the dashboard above is the web front end.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | `{conversation_id, message, language, use_case, customer_id}` → `{reply, model_used, provider, latency_ms, cost_usd, route_reason, failover_used, turn_type, trace}` |
| POST | `/route/preview` | routing decision with no model call and no logging |
| GET | `/stats/overview` | dashboard numbers and time series (incl. `requestsDaily`, `latencyDaily`) |
| GET | `/stats/savings` | routed spend vs the same logged tokens on each customer's best allowed model (estimate) |
| GET / POST | `/whatif/baseline`, `/whatif/simulate` | logged cost by model; cost, quality, measured latency and per-model allocation projection |
| GET, POST, PATCH, DELETE | `/providers`, `/providers/:id` | model catalogue |
| GET, PUT | `/vendors`, `/vendors/:vendor/state` | vendor status; simulate `healthy`, `down` or `slow` |
| GET, PUT | `/routing`, `/routing/strategy`, `/routing/rules`, `/routing/policies`, `/routing/languages` | routing configuration |
| POST, GET | `/tests/run`, `/tests/cases`, `/tests/results`, `/tests/runs`, `/alerts` | test suite |
| POST, GET | `/traffic/generate`, `/traffic/status`, `/traffic/clear` | synthetic traffic; clear deletes logged turns only |
| GET, POST | `/config`, `/mode` | demo or live mode (no button in the dashboard); key presence only |
| POST | `/reset` | re-seed your workspace with the demo setup |
| GET | `/me` | signed-in user, their workspace, whether sign-in and Supabase are on |

Every endpoint except `/health` needs `Authorization: Bearer <Supabase access token>` when `SUPABASE_URL` is set, and acts on the caller's workspace only.

## Layout

```
api/src/
  main.ts          loads .env, starts the server (SERVE_WEB, ACCESS_PASSWORD for sharing)
  server.ts        routes, validation, password gate, serving the built dashboard
  chat.ts          /chat: decide → call with failover → log → pin the conversation
  router.ts        filtering, ranking, sticky conversations, policy checks
  classifier.ts    simple vs complex (editable rules)
  breaker.ts       per-vendor circuit breaker
  providers.ts     simulated providers and live OpenAI / Gemini / Anthropic calls
  content.ts       12 test conversations, canned replies, apologies
  evaluation.ts    test runner, judges, alerts, automatic exclusion
  stats.ts         dashboard aggregations and what-if
  traffic.ts       synthetic conversations and incident replay
  auth.ts          verifies Supabase sign-in tokens; live-mode allow-list
  store.ts         workspaces: per-workspace cached config, pins, breaker; save to workspace_settings
  db.ts            Postgres: Supabase (DATABASE_URL) or embedded PGlite; migrations; batched inserts
  seed.ts          demo setup for new workspaces
api/migrations/    SQL schema and row-level security
api/test/          router, failover and end-to-end API tests
web/src/
  App.tsx          shell: sidebar / pill navigation, sample-data note, live-mode warning, page transitions
  pages/           the six dashboard pages
  components/      RoutingVisualiser, TraceTimeline, Kpi, AnimatedNumber, Modal, Tooltip, UI kit
  lib/             API client, motion settings, formatting, theme, mode context
app/src/app/       phone screens (Expo Router)
app/src/components tabs, UI kit, charts, orbs, route trace, outage switches
shared/types.ts    API types shared by api/, web/ and app/
```

## Ad film

The landing page's ad (`web/public/promo.mp4`: 71.8 s, 1920×1080, H.264 with an AAC soundtrack, about 12.5 MB) is rendered from a page in the app: `web/src/pages/AdFilm.tsx`, at **/ad**. Open http://localhost:5173/ad to watch it live (it loops, scales to the window and plays without sound). Everything in it is drawn from a single clock, so it renders identically every time.

**Music:** the soundtrack of the owner's own video `ElevenRoute-showcase.mov` (54.4 s, 110.02 BPM, C major: a short swell, then a four-bar loop with the drums, claps from bar 5, a riser and a final hit). Its rights are the owner's, so the source audio stays out of git: `scripts/ad-music.mjs --source path/to/ElevenRoute-showcase.mov` keeps a copy in `tools/ad-music-source.wav` (gitignored). The script then builds the edit on the bar grid:
- bars 0–19, then bars 12–19 again (two more loops, so the harmony carries on), then the riser and the final hit, which lands under the end card;
- during the outage the music stutters with the glitch, goes muffled (a low-pass filter) while the provider is down, and opens up again as the turn is answered.

**Timing:** the film is written in "story" seconds on a 2-second bar. It plays one bar of the music (a bar is 2.1814 s) per story bar, 9% slower than written, so every scene starts on a bar line. The hook's first line sits on the opening swell and the drums arrive with its second line, the logo drops as the claps come in, and the CFO's reply gets one extra bar while the riser builds into the final hit. `storyAt()`/`realAt()` convert between the two clocks, and `KICKS` drives the beat pulses. Changing the edit in the script means changing those, `FILM_SECONDS` and the script's `LENGTH` together.

To re-render after editing `AdFilm.tsx` or the music:

1. `node scripts/ad-music.mjs` writes `tools/ad-music.wav` (set `FFMPEG` if ffmpeg isn't on your PATH; the first run needs `--source`).
2. Open `/ad?render` in a browser sized exactly 1920×1080 (for example Playwright with headless Chrome).
3. For each frame `f` from 0 to 2153, call `window.__adSetTime(f / 30)` and save a screenshot as `frames/0001.jpg` … `frames/2154.jpg`. Headless Chrome manages about 9 frames a second; four processes on separate ranges take about two minutes.
4. Encode with the music: `ffmpeg -framerate 30 -i frames/%04d.jpg -i tools/ad-music.wav -map 0:v -map 1:a -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart web/public/promo.mp4`
5. Save the poster from `window.__adSetTime(70)` as `web/public/promo-poster.jpg`.

On the landing page the film starts muted (browsers only autoplay muted videos) with a **Sound on** button that restarts it with the music. The MP4 is ready to post as is (X, LinkedIn and others accept H.264/AAC MP4).

## Limits and next steps

- **Live mode** calls the vendor APIs directly but hasn't been run against real keys. Check the model names (`liveModel`) and prices in Providers first.
- **The classifier** is rules-based. A small learned classifier trained on logged turns and judge labels is the next step.
- **In-process state** per workspace (circuit breaker, sticky pins, simulated outage switches, cached config) lives in one API process. Run one instance, or move it to Redis or similar for several.
- **Workspaces are personal.** Inviting teammates into a shared workspace (roles are already in `workspace_members`) is the next step.
- **Supabase emails** use Supabase's built-in sender, limited to a few emails per hour. Add your own SMTP under Authentication → Emails before inviting a team.
- **App icon and splash** are still the Expo defaults. Replace the images in `app/assets/images`.
- **Store builds** need an HTTPS API (`EXPO_PUBLIC_API_URL`). Bundle id and package name are set to `com.elevenroute.app`.
