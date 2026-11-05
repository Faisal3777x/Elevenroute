# ElevenRoute

Model-agnostic routing for voice and chat agents. ElevenRoute sits between customer-service agents and LLM providers (OpenAI, Google Gemini, Anthropic). For every conversation turn it picks the best model, retries on another provider when one fails, tests every model on the same conversations, and shows what it all costs.

| Part | Stack | Where |
|---|---|---|
| Router API | Node.js 24+ and TypeScript, built-in `node:sqlite` and `node:http`, no runtime dependencies | `api/` |
| App (phone + web dashboard) | Expo SDK 58, React Native 0.88, Expo Router, TypeScript, react-native-svg | `app/` |
| Shared types | TypeScript types used by both | `shared/types.ts` |

## Run it

Needs Node.js 24 or later.

```bash
npm run setup      # install api/ and app/ dependencies
npm run dev        # API on :8000 and the Expo dev server (QR code) together
```

Or in two terminals: `npm run api` and `npm run app`.

- **Phone:** install Expo Go, connect the phone to the same Wi-Fi as the computer, and scan the QR code. The app finds the API on your computer automatically (same address as the Expo server, port 8000).
- **Web dashboard:** press `w` in the Expo terminal, or open http://localhost:8081.
- **Fill the dashboard:** tap **Generate traffic** on Overview, or run `npm run traffic`.

On Windows, allow Node.js through the firewall on private networks when prompted, or the phone can't reach the computer.

| Command | What it does |
|---|---|
| `npm test` | API tests (`node --test`), API type-check, app type-check and lint |
| `npm run traffic` | send 500 synthetic conversations through the router |
| `npm run reset` | wipe traffic, tests and edits, then re-seed the demo |
| `npm run web` | Expo dev server with the web dashboard opened |

## Modes

| | Demo (default) | Live |
|---|---|---|
| API keys | none | at least one of `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` in `.env` |
| Providers | simulated cost, latency, error rate, quality, canned replies in English, Spanish and Arabic | direct HTTPS calls to each vendor's API |
| Test judge | simulated from quality settings plus noise | strongest model that has a key |

Copy `.env.example` to `.env`. Switch with `MODE=demo|live` or the Demo / Live toggle on Overview. Keys are read only from the environment and never stored, logged or returned (`/config` reports only true or false per vendor). Synthetic traffic always uses the simulated providers, so it never spends API credit.

Demo prices, latencies and quality scores are illustrative simulation settings, not vendor quotes.

## How routing works

1. **Classify** the turn as simple or complex with editable, weighted rules: long turn +2, very short −1, multi-step +1, dispute/refund keywords +2, confirmation −3, order number or time −1, refund/complaint call +1. Score ≥ 2 means complex. Arabic keywords match inside words.
2. **Filter** models by customer policy (vendors, data region), language support, test-score exclusion, and (in live mode) API key presence.
3. **Rank.** Simple turns go to the cheapest model at or above the quality floor (0.78; Arabic 0.82; a customer can raise it). Complex turns go to the highest-quality model. Quality comes from the latest test scores for that language and turn type when available.
4. **Sticky:** a conversation stays on its first model. Escalating calls upgrade to a stronger model (on by default; switch it off on Routing rules).
5. **Circuit breaker:** after 2 failures in 30 s, a vendor goes to the back of the queue for 20 s.
6. **Failover:** errors or responses slower than the 2,000 ms budget retry on the next ranked model, preferring a different vendor. If everything fails, the caller gets an apology and a human handoff in their language.

Every decision carries a plain-English reason and a full route trace.

## Screens

| Screen | Phone | Web | Purpose |
|---|---|---|---|
| Overview | ✓ | ✓ | requests, cost, cost per conversation, failovers, latency, routing overhead, cost per model over time (chart or table), where turns go, failover history, Demo/Live toggle |
| Playground | ✓ | ✓ | chat with the router; model, cost, latency, routing time, reason and route trace per reply; outage switches inline |
| Providers | ✓ | ✓ | Healthy / Down / Slow per vendor, model catalogue: edit, enable, disable, add, delete |
| Tests | ✓ | ✓ | run the 36-conversation suite, scores against the floor, alerts, heatmap, run history, every scored conversation |
| Routing rules | | ✓ | live classifier preview, strategy, classifier rules, customer policies, language preferences |
| What-if | | ✓ | move a share of logged traffic between models and see the monthly cost and quality change |

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | `{conversation_id, message, language, use_case, customer_id}` → `{reply, model_used, provider, latency_ms, cost_usd, route_reason, failover_used, turn_type, trace}` |
| POST | `/route/preview` | routing decision with no model call and no logging |
| GET | `/stats/overview` | dashboard numbers and time series |
| GET / POST | `/whatif/baseline`, `/whatif/simulate` | logged cost by model; cost and quality projection |
| GET, POST, PATCH, DELETE | `/providers`, `/providers/:id` | model catalogue |
| GET, PUT | `/vendors`, `/vendors/:vendor/state` | vendor status; simulate `healthy`, `down` or `slow` |
| GET, PUT | `/routing`, `/routing/strategy`, `/routing/rules`, `/routing/policies`, `/routing/languages` | routing configuration |
| POST, GET | `/tests/run`, `/tests/cases`, `/tests/results`, `/tests/runs`, `/alerts` | test suite |
| POST, GET | `/traffic/generate`, `/traffic/status` | synthetic traffic |
| GET, POST | `/config`, `/mode` | mode switch; key presence only |
| POST | `/reset` | re-seed the demo |

## Layout

```
api/src/
  main.ts          loads .env, starts the server
  server.ts        routes and validation
  chat.ts          /chat: decide → call with failover → log → pin the conversation
  router.ts        filtering, ranking, sticky conversations, policy checks
  classifier.ts    simple vs complex (editable rules)
  breaker.ts       per-vendor circuit breaker
  providers.ts     simulated providers and live OpenAI / Gemini / Anthropic calls
  content.ts       36 test conversations, canned replies, apologies
  evaluation.ts    test runner, judges, alerts, automatic exclusion
  stats.ts         dashboard aggregations and what-if
  traffic.ts       synthetic conversations and incident replay
  store.ts, seed.ts, db.ts   cached config, seed data, SQLite
api/test/          router, failover and end-to-end API tests
app/src/app/       screens (Expo Router)
app/src/components tabs, UI kit, charts, orbs, route trace, outage switches
shared/types.ts    API types shared by api/ and app/
```

## Limits and next steps

- **Live mode** calls the vendor APIs directly but hasn't been run against real keys. Check the model names (`liveModel`) and prices in Providers first.
- **The classifier** is rules-based. A small learned classifier trained on logged turns and judge labels is the next step.
- **Sticky conversations** that start complex stay on the flagship model for later simple turns. That keeps one voice per call but costs more; consider a "downgrade on simple turns" option if cost matters more.
- **State** (circuit breaker, sticky pins, cached config) lives in one process. Use Redis or similar for multiple instances.
- **No login** on the API or the app. Put both behind single sign-on before exposing them.
- **App icon and splash** are still the Expo defaults. Replace the images in `app/assets/images`.
- **Store builds** need an HTTPS API (`EXPO_PUBLIC_API_URL`). Bundle id and package name are set to `com.elevenroute.app`.
