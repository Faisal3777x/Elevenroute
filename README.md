# ElevenRoute

Model-agnostic routing for voice and chat agents. ElevenRoute sits between customer-service agents and LLM providers (OpenAI, Google Gemini, Anthropic). For every conversation turn it picks the best model, retries on another provider when one fails, tests every model on the same conversations, and shows what it all costs.

| Part | Stack | Where |
|---|---|---|
| Router API | Node.js 24+ and TypeScript, built-in `node:sqlite` and `node:http`, no runtime dependencies | `api/` |
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
| `npm run web` | Expo dev server with the web dashboard opened |
| `npm run share` | share the dashboard with your team on your network, password protected (see below) |
| `npm run share:public` | the same, plus a public HTTPS link anyone can open with the password |

## Share with your team

`npm run dev` only works on your own computer. To let teammates open the dashboard:

1. Close the "ElevenRoute API" window or stop `npm run dev`. Sharing runs its own copy of the API on port 8000.
2. Run `npm run share:public` for teammates anywhere, or `npm run share` for teammates on the same Wi-Fi or office network.
3. Send them the link and password printed in the window. Their browser asks for a username (anything) and the password.

| | `npm run share` | `npm run share:public` |
|---|---|---|
| Who can open it | people on your network | anyone with the link and password |
| Link | `http://<your-ip>:8000` | `https://<random>.trycloudflare.com` (new each run) |
| Needs | Windows firewall allowing Node.js | internet; `cloudflared` (downloaded to `tools/` on first run on Windows) |

- The dashboard is built (`web/dist`) and served by the API itself on one port. It calls the API under `/api/...`.
- **Password:** set `SHARE_PASSWORD` (8+ characters) in `.env` to keep the same one; otherwise each run prints a new random password. Every request except `/health` needs it (HTTP Basic auth).
- **Your computer must stay on**, with the share window open. Closing it stops sharing.
- **Everyone shares one demo.** Teammates can generate or reset traffic, edit models and rules, and switch to Live mode, which spends API credit if keys are in `.env`.
- **While sharing**, the phone app and the `npm run dev` dashboard on :5173 can't reach the API (they don't send the password). Stop sharing and run `npm run dev` again to go back.
- For a permanent link, deploy the API with `SERVE_WEB=1` and `ACCESS_PASSWORD` set to a host such as Render, Railway or Fly.io (needs a persistent disk for `api/data/`), and put single sign-on in front of it before using real keys or data.

## Modes

| | Demo (default) | Live |
|---|---|---|
| API keys | none | at least one of `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` in `.env` |
| Providers | simulated cost, latency, error rate, quality, canned replies in English and Spanish | direct HTTPS calls to each vendor's API |
| Test judge | simulated from quality settings plus noise | strongest model that has a key |

Copy `.env.example` to `.env`. Switch with `MODE=demo|live` or the Demo / Live toggle on Overview. Keys are read only from the environment and never stored, logged or returned (`/config` reports only true or false per vendor). Synthetic traffic always uses the simulated providers, so it never spends API credit.

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
| What-if | traffic-share slider, simulated savings headline, current vs optimised allocation chart, quality / latency / policy trade-offs |

**Routing visualiser.** Replays one real routing trace step by step: request → classification → policy, language and quality checks → each provider attempt (failed attempts turn red and fail over) → selected model → response back to the customer. It only draws what the API returned (`/chat` traces, or `/route/preview` dry runs, which are labelled as such). Play, pause and replay controls; with reduced motion it shows the final route as a static diagram plus a written step list.

**Honesty rules.** Demo mode is flagged on every page. Savings are labelled *Estimate* (Overview) or *Simulated* (What-if). Simulated outages are labelled as test switches.

**Motion.** Shared settings in `web/src/lib/motion.ts` (150–400 ms for interface motion, springs for presses and layout). `MotionConfig reducedMotion="user"` plus a CSS fallback respect `prefers-reduced-motion`. Animations use transform and opacity.

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
| GET, POST | `/config`, `/mode` | mode switch; key presence only |
| POST | `/reset` | re-seed the demo |

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
  content.ts       24 test conversations, canned replies, apologies
  evaluation.ts    test runner, judges, alerts, automatic exclusion
  stats.ts         dashboard aggregations and what-if
  traffic.ts       synthetic conversations and incident replay
  store.ts, seed.ts, db.ts   cached config, seed data, SQLite
api/test/          router, failover and end-to-end API tests
web/src/
  App.tsx          shell: sidebar / pill navigation, mode banner and switch, page transitions
  pages/           the six dashboard pages
  components/      RoutingVisualiser, TraceTimeline, Kpi, AnimatedNumber, Modal, Tooltip, UI kit
  lib/             API client, motion settings, formatting, theme, mode context
app/src/app/       phone screens (Expo Router)
app/src/components tabs, UI kit, charts, orbs, route trace, outage switches
shared/types.ts    API types shared by api/, web/ and app/
```

## Limits and next steps

- **Live mode** calls the vendor APIs directly but hasn't been run against real keys. Check the model names (`liveModel`) and prices in Providers first.
- **The classifier** is rules-based. A small learned classifier trained on logged turns and judge labels is the next step.
- **Sticky conversations** that start complex stay on the flagship model for later simple turns. That keeps one voice per call but costs more; consider a "downgrade on simple turns" option if cost matters more.
- **State** (circuit breaker, sticky pins, cached config) lives in one process. Use Redis or similar for multiple instances.
- **Login** is one shared password when sharing (`npm run share`), none in development. Use single sign-on for real deployments.
- **App icon and splash** are still the Expo defaults. Replace the images in `app/assets/images`.
- **Store builds** need an HTTPS API (`EXPO_PUBLIC_API_URL`). Bundle id and package name are set to `com.elevenroute.app`.
