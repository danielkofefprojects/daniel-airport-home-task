# Airport Investment Intelligence Agent

A chat agent that helps analysts find US airports where terminal/capacity renovation is likely to pay off, based
on passenger demand and capacity-pressure signals. See [DESIGN.md](./DESIGN.md) for architecture, scoring
methodology, and tradeoffs.

## Prerequisites

- Node.js 22+ (see `.nvmrc`)
- A free [Groq](https://console.groq.com) API key
- (Optional, for live flight data) an [OpenSky Network](https://opensky-network.org) API client ID/secret from
  your account page — without it the agent falls back to seed data with a caveat

## Setup

```bash
npm install
cp .env.example .env
# edit .env and set at least GROQ_API_KEY
npm run seed   # downloads public data and builds server/data/seed/*.json
npm run dev    # starts the Express server (:3001) and Angular app (:4200)
```

Open http://localhost:4200. The Angular dev server proxies `/api` to the Express server.

## Environment variables (`.env`)

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | Yes | From console.groq.com |
| `GROQ_MODEL_PRIMARY` | No | Defaults to `openai/gpt-oss-120b` |
| `GROQ_MODEL_FALLBACK` | No | Used automatically on error/429 |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | No | Live departures/arrivals; omit to use seed flight samples |
| `PORT` | No | Express port, default 3001 |
| `CACHE_DIR` | No | File cache location, resolved relative to `server/` |
| `USE_SEED_ONLY` | No | Set `true` to force fully offline mode |
| `LANGSMITH_*` | No | Optional tracing |

Secrets are only ever read from `.env` and are never logged.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start server (3001) and Angular app (4200, proxies `/api`) |
| `npm test` | Run the vitest suite (scoring, agent, data layer) |
| `npm run seed` | Download public data and rebuild `server/data/seed/*.json` |
| `npm run tool -- <toolName> '<json args>'` | Run a single agent tool from the CLI, e.g. `npm run tool -- resolve_airports '{"query":"New England"}'` |
| `npm run lint` | ESLint across server and web |
| `npm run build` | Build both workspaces |

## Demo script

1. "Which airports in New England are strong candidates for terminal expansion?"
2. Follow-up: "Why is Boston ranked where it is?"
3. "Compare LA and Santa Ana airport congestion levels."
4. "What is the percentage of long-haul flights out of Anchorage airport?"
5. Follow-up: "And excluding cargo?"
6. "What is the unmet flight demand in SFO and why?"
7. "How do you calculate the opportunity score?"
8. Ask one question by voice (Chrome, click the mic button).

Each answer is followed by an evidence panel with the scores table, data sources with dates, caveats, and a
confidence level — every number there is traceable to `server/src/scoring/` and `server/src/data/`, never
invented by the model.

## Project structure

See `.claude/PLAN.md` section 8 for the full layout. Key entry points:

- `server/src/agent/agent.ts` — LangChain `createAgent` wiring (model, tools, middleware, checkpointer)
- `server/src/agent/tools/` — one LangChain tool per file (`resolve_airports`, `rank_airports`,
  `compare_airports`, `flight_mix`, `demand_pressure`, `explain_methodology`)
- `server/src/scoring/` — pure scoring functions; weights/thresholds in `server/src/config/scoring.ts`
- `server/src/data/` — data sources (OurAirports, FAA, OpenSky, NAS Status) with a shared TTL file cache
- `web/src/app/chat/` — Angular chat page, evidence panel, mic button

## Testing

```bash
npm test
```

Scoring, confidence, geo/haul classification, normalization, cache TTL behavior, agent evidence extraction, and
focus-airport follow-up logic are all covered. Agent tests use a fake chat model — no network calls, no Groq
API key required to run the suite.
