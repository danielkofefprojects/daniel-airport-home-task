# Airport Investment Intelligence Agent: Build Plan

> **How to use this file with Claude Code**
> 1. Create an empty folder, put this file and `CLAUDE.md` in its root.
> 2. Run `claude` in that folder.
> 3. Say: *"Read PLAN.md and CLAUDE.md. Execute Phase 0 only, then stop and show me the result."*
> 4. After each phase passes its acceptance checks, say *"Proceed to Phase N."*
>
> Doing one phase at a time keeps Claude Code focused and lets you verify each step.

---

## 1. Goal and scope

Build a chat agent (Node.js + TypeScript) that helps analysts find US airports where terminal/capacity
renovation is likely to pay off, based on passenger demand and capacity pressure.

It must answer questions like:

| Example question | What the agent does |
|---|---|
| Which airports in New England are strong candidates for terminal expansion? | Filter airports by state (ME, NH, VT, MA, RI, CT), score, rank, explain |
| Compare LA and Santa Ana airport congestion levels. | Resolve LAX + SNA, compute congestion KPIs, side-by-side |
| What is the percentage of long-haul flights out of Anchorage? | Pull recent ANC departures, compute great-circle distances, classify |
| What is the unmet flight demand in SFO and why? | Compute demand-pressure KPIs, attribute to drivers (runway limits, delays) |

**In scope (1 day):** deterministic scoring engine, tool-calling LLM agent, web chat UI with voice input (bonus item),
caching, clear caveats, design doc, unit tests for scoring.

**Out of scope:** financial modeling (IRR/NPV), construction cost data, gate-level terminal data, auth, deployment.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22+, TypeScript (strict), ESM | Required (LangGraph v1 needs Node 22+) |
| Server | Express 5 (+ `@types/express`, `cors`), run with `tsx` in dev | Familiar, minimal, huge ecosystem. Express 5 forwards errors from async handlers automatically |
| Agent framework | **LangChain v1 `createAgent`** (`langchain`, `@langchain/core`), which runs on **LangGraph** (`@langchain/langgraph`) | Company standard. Handles the tool loop; middleware for fallback, limits and context; `MemorySaver` checkpointer for follow-ups |
| LLM | **Groq** (free tier) via `@langchain/groq` (`ChatGroq`) | Free, very fast, native LangChain integration with tool calling |
| Tracing (optional) | LangSmith (free developer tier) | Shows every model and tool call; useful when explaining the agent |
| Primary model | `openai/gpt-oss-120b` | Strong tool calling and reasoning |
| Fallback model | `llama-3.3-70b-versatile` | Used automatically on 429 / error |
| Voice (bonus) | Browser Web Speech API (`SpeechRecognition`) for voice input only | Free, frontend only, no backend or API changes |
| Frontend | **Angular** (latest, created with Angular CLI): standalone components, signals, `HttpClient`, plain CSS, no UI library | Kept minimal: one chat page. Dev server proxies `/api` to Express via `proxy.conf.json` |
| Validation | `zod` | Validate tool args and API responses |
| Tests | `vitest` | Fast unit tests for scoring |
| Spreadsheet parsing | `xlsx` (SheetJS) | FAA enplanement files are Excel |
| CSV parsing | `csv-parse` | OurAirports data |

> **Note on Groq free tier:** limits are per model and fairly tight on tokens per minute. Keep tool outputs
> compact (summaries, not raw flight lists), trim history, and use the fallback model plus retries.
> Model IDs change; Claude Code should check `GET https://api.groq.com/openai/v1/models` at startup and log a warning if a configured model is missing.

> **Note on LangChain versions:** use `createAgent` from the `langchain` package. The older LangGraph
> `createReactAgent` is deprecated in v1. Claude Code should install the latest v1 packages and check the current
> docs (docs.langchain.com) rather than relying on older examples.

---

## 3. Data sources (all free and public)

| Source | Used for | Access | Notes |
|---|---|---|---|
| **OurAirports** (`airports.csv`, `runways.csv`) | Airport metadata, IATA/ICAO codes, state, coordinates, runway count and length | Raw CSV from `https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/` | Public domain, updated nightly |
| **FAA Passenger Boarding (Enplanement) Data** | Annual enplanements per airport, hub size, multi-year growth | Excel files on faa.gov (Airports → Planning & Capacity → Passenger & All-Cargo Data) | Download several years in a seed script. Claude Code should find the current URLs |
| **OpenSky Network REST API** | Recent departures/arrivals per airport (flight counts, destinations) | `GET https://opensky-network.org/api/flights/departure?airport=KSFO&begin=..&end=..` | OAuth2 client-credentials required (basic auth was retired in 2026). Token lasts ~30 min. Query in 1-day windows, for days that have fully ended. Rate limited, so cache |
| **FAA NAS Status API** | Current delays, ground stops, ground delay programs | `https://nasstatus.faa.gov/api/airport-status-information` (XML) | Real-time snapshot only, not historical |
| **Bundled seed file** (fallback) | Guarantees the demo works offline | `data/seed/*.json` generated by the seed script | Every answer that uses it states the data year |

**Rule:** every tool response carries `sources[]`, `asOf`, and `caveats[]` so the agent can cite them.

---

## 4. Architecture

```
┌──────────────┐  POST /api/chat/stream (SSE)  ┌────────────────────────────────────────┐
│ Angular chat │ ──────────────────────────────►│ Express server                         │
│  + mic input │ ◄────────────────────────────── │  └─ createAgent (LangChain/LangGraph)  │
│              │  token / done / error events   │      ├─ MemorySaver (thread = session) │
└──────────────┘                                │      └─ Tools (deterministic)          │
                                                 │          ├─ resolve_airports           │
                                                 │          ├─ rank_airports              │
                                                 │          ├─ compare_airports           │
                                                 │          ├─ flight_mix                 │
                                                 │          └─ demand_pressure            │
                                                 │      Scoring engine (pure functions)   │
                                                 │      Data layer + file cache (TTL)     │
                                                 └───────────┬────────────────────────────┘
                                                             │
                     OurAirports · FAA enplanements · OpenSky · FAA NAS Status
```

`POST /api/chat` (non-streaming JSON, same `{answer, evidence, toolsUsed, model}` shape) is kept alongside the
stream endpoint for tests and any non-browser client (e.g. `npm run tool`-style scripting).

**Key design principle:** the LLM **never computes numbers**. It picks tools, fills arguments, and writes the
explanation. All metrics, scores, ranks, and confidence levels come from deterministic TypeScript code.

### Agent design (LangChain `createAgent`)

```
user message ─► createAgent loop ─► model picks tools ─► tools run ─► model ... ─► final answer
                  │  middleware: trim history · focus airports · tool-call limit · model fallback
                  └─ MemorySaver checkpointer (thread_id = sessionId)
```

```ts
const agent = createAgent({
  model: primaryModel,                     // ChatGroq, maxRetries: 3
  tools,                                   // six tools from ./tools
  systemPrompt: SYSTEM_PROMPT,
  checkpointer: new MemorySaver(),
  middleware: [
    trimHistoryMiddleware,                 // custom beforeModel: keep system + last ~8 turns
    focusAirportsMiddleware,               // custom wrapModelCall: add "Airports in focus: SFO, OAK" to the prompt
    toolCallLimitMiddleware({ runLimit: 6 }),
    modelFallbackMiddleware(fallbackModel) // llama-3.3-70b-versatile on Groq errors / 429
  ],
});
```

**Tools** are built with `tool()` from `@langchain/core/tools`, a zod schema, and
`responseFormat: 'content_and_artifact'`: the **content** is a compact text summary for the LLM (saves Groq tokens),
the **artifact** is the full structured result for the UI evidence panel.

**Per request (`run.ts`):**
1. `agent.invoke({ messages: [{ role: "user", content }] }, { configurable: { thread_id: sessionId } })` (or `agent.stream(..., { streamMode: "messages" })` for the streaming endpoint — see below).
2. **Evidence:** take the `ToolMessage`s after the latest user message and collect their `artifact`s (tables, scores, sources, caveats). Plain code, no AI.
3. **Focus airports** (for follow-ups like *"what about Boston only?"* or *"why is the second one ranked lower?"*): `focusAirportsMiddleware` reads the IATA codes from the most recent tool artifacts in the conversation state and adds them to the prompt.
4. Return `{ answer, evidence, toolsUsed, model }`.

### Streaming (`POST /api/chat/stream`)

The chat UI streams the answer token-by-token instead of waiting for the full response:

1. `run.ts` exposes `streamAgent(sessionId, message)`, an async generator over `agent.stream(input, { streamMode: "messages" })`. Each yielded `[chunk, metadata]` is a token from *any* LLM call in the turn, including tool-selection calls — those have empty string content, so filtering on non-empty `chunk.content` naturally isolates the final natural-language answer.
2. It yields `{ type: "token", text }` for each answer token.
3. Once the stream ends, it reads the turn's authoritative final state via `agent.getState({ configurable: { thread_id } })` (not reconstructed from the streamed chunks — those are display-only) and yields one `{ type: "done", result: { answer, evidence, toolsUsed, model } }`.
4. `routes/chat.ts`'s `/chat/stream` handler writes each event as a Server-Sent Event (`event: token|done|error`, `data: <json>`) directly on the Express `Response`, no extra SSE package needed — Express 5 + raw `res.write` is enough for this one-directional stream.
5. The Angular `ChatService` reads the SSE body with the native `fetch` + `ReadableStream` API (not `HttpClient`, which doesn't expose raw streaming chunks) and calls `onToken`/`onDone` as events arrive. `ChatComponent` appends tokens to the last message as they land and swaps in the authoritative `answer`/`evidence` on `done`.

### Rate-limit handling

Groq's free tier is tight (8,000 tokens/minute on the fallback model used in testing), and a 429 from either the
primary or fallback model was previously surfacing as a raw 500 with Groq's JSON body in it. `agent/rateLimit.ts`
parses Groq's `"code":"rate_limit_exceeded"` errors and the `"try again in Ns"` hint in the message; `run.ts` wraps
both `runAgent` and `streamAgent` in `withRateLimitRetry`, which retries **once** after waiting Groq's suggested
delay (capped at 20s) before giving up. If the retry also rate-limits, it throws `HttpError(429, "RATE_LIMITED", ...)`
with a short user-facing message instead of the raw provider error; the SSE route emits this as an `error` event
and the chat UI shows it inline instead of the generic "something went wrong" fallback.

---

## 5. Scoring methodology (deterministic)

All KPIs live in `src/scoring/`. Weights and thresholds live in `src/config/scoring.ts` so they are easy to change and explain.

### 5.1 Raw KPIs per airport

| KPI | Formula | Source |
|---|---|---|
| `enplanements` | Latest year annual boardings | FAA |
| `growthCagr` | `(E_latest / E_base)^(1/years) − 1` (base year configurable, default 2019 to capture post-COVID recovery vs. pre-COVID) | FAA |
| `recoveryRatio` | `E_latest / E_2019` | FAA |
| `paxPerRunway` | `enplanements × 2 / activeRunwayCount` (×2 approximates total passengers) | FAA + OurAirports |
| `dailyOps` | Average (departures + arrivals) per day over the sampled days | OpenSky |
| `opsPerRunway` | `dailyOps / activeRunwayCount` | OpenSky + OurAirports |
| `delaySignal` | 0 = no delay, 0.5 = delays reported, 1 = ground stop / GDP (current snapshot) | FAA NAS Status |
| `longHaulShare` | Share of departures with great-circle distance ≥ `LONG_HAUL_KM` (default 4,800 km ≈ 3,000 mi) | OpenSky + OurAirports coords |
| `unknownDestShare` | Share of sampled departures with no estimated arrival airport | OpenSky |

Active runways = runways not marked closed. Parallel runways that are too close to operate independently
are not detectable from this data; this is listed as a known limitation.

### 5.2 Normalization
- Percentile rank of each KPI against **all US large + medium hub airports** (a fixed national peer set), so a
  regional query does not inflate weak airports.
- Output in 0–100.

### 5.3 Composite scores

```
DemandScore     = 0.6·pct(growthCagr) + 0.4·pct(enplanements)
CongestionScore = 0.5·pct(paxPerRunway) + 0.35·pct(opsPerRunway) + 0.15·delaySignal·100
OpportunityScore (terminal expansion)
                = 0.45·DemandScore + 0.40·CongestionScore + 0.15·pct(recoveryRatio)
```

Interpretation: high demand growth **and** high pressure on existing capacity means expansion is more likely to
translate into more flights and passengers, which is the revenue driver.

**Unmet demand index (for "unmet demand at SFO"):**
```
UnmetDemandIndex = CongestionScore × (DemandScore / 100)
```
Plus a **driver breakdown**: each component's contribution, sorted, so the agent can explain *why*
(e.g. "most of the index comes from passengers per runway and active ground delay programs").
The LLM may add well-known structural context (for example, weather-related arrival-rate reductions) but must
label it as general background knowledge, not computed data.

### 5.4 Tiers
`≥ 70` Strong candidate · `50–69` Moderate · `< 50` Weak. Thresholds in config.

### 5.5 Confidence (deterministic)
Start at High, downgrade one level for each of:
- OpenSky sample < 100 flights, or `unknownDestShare` > 25%
- Enplanement data older than 2 years
- Any source fell back to seed/cache older than its TTL
- Delay signal unavailable

### 5.6 Worked example the tests must cover
Two airports with hand-computed inputs → assert exact scores and ranking order.

---

## 6. Tools (LLM function definitions)

| Tool | Args (zod) | Returns (compact) |
|---|---|---|
| `resolve_airports` | `{ query: string }` e.g. "LA", "Santa Ana", "New England" | List of `{iata, icao, name, state}` + how it was resolved. Alias table: LA→LAX, Santa Ana/Orange County→SNA, Bay Area→SFO/OAK/SJC; region table: New England = ME, NH, VT, MA, RI, CT |
| `rank_airports` | `{ states?: string[], iatas?: string[], metric: "opportunity"\|"congestion"\|"demand"\|"unmet_demand", limit?: number }` | Ranked rows with score, tier, top 2 drivers, confidence |
| `compare_airports` | `{ iatas: string[] (2–4) }` | Side-by-side KPI table + scores + which one is more congested and by how much |
| `flight_mix` | `{ iata: string, days?: number (1–7, default 3) }` | Counts and % short/medium/long-haul, top destinations, sample size, unknown share, cargo-vs-passenger split by callsign prefix (heuristic, flagged) |
| `demand_pressure` | `{ iata: string }` | UnmetDemandIndex, driver breakdown, current NAS status, caveats |
| `explain_methodology` | `{}` | Formulas, weights, thresholds, data vintages |

Haul bands (configurable): short < 1,500 km, medium 1,500–4,799 km, long ≥ 4,800 km.
For Anchorage specifically the answer should note that it is a major cargo hub, so the long-haul share is
heavily influenced by freighter traffic; report both "all departures" and "excluding likely cargo".

---

## 7. System prompt (put in `src/agent/systemPrompt.ts`)

Key rules to encode:
- You are an analyst assistant for a US airport modernization investor.
- Always use tools for any number, ranking, or comparison. Never invent metrics.
- Resolve place names with `resolve_airports` first when ambiguous.
- Structure answers: **Answer → Key numbers → Why (drivers) → Assumptions & caveats → Confidence**.
- Clearly separate *computed data* from *general background knowledge*.
- State data vintage (e.g. "FAA CY2024 boardings; OpenSky sample Sep 13–15, 2026").
- If a question is out of scope (costs, IRR, non-US airports), say so and offer what you can do.
- Use conversation context for follow-ups ("those airports", "the second one").
- Keep answers concise.

---

## 8. Project structure

```
airport-agent/
├─ CLAUDE.md
├─ PLAN.md
├─ DESIGN.md                    # deliverable
├─ README.md
├─ .env.example
├─ package.json                 # npm workspaces: server, web
├─ server/
│  ├─ src/
│  │  ├─ index.ts               # Express app bootstrap (json, cors, routes, error handler)
│  │  ├─ routes/chat.ts         # express.Router: POST /api/chat, POST /api/chat/stream (SSE), GET /api/health
│  │  ├─ middleware/            # validate.ts (zod body validation), errorHandler.ts
│  │  ├─ agent/
│  │  │  ├─ agent.ts            # createAgent + MemorySaver + middleware list
│  │  │  ├─ middleware.ts       # trimHistoryMiddleware, focusAirportsMiddleware
│  │  │  ├─ model.ts            # ChatGroq primary (maxRetries) + fallback model
│  │  │  ├─ rateLimit.ts        # Groq 429 detection + suggested-delay parsing
│  │  │  ├─ systemPrompt.ts
│  │  │  ├─ run.ts              # runAgent(...) and streamAgent(...) → { answer, evidence, ... }
│  │  │  └─ tools/              # one LangChain tool() per file + index.ts array
│  │  ├─ scoring/
│  │  │  ├─ kpis.ts
│  │  │  ├─ normalize.ts
│  │  │  ├─ scores.ts
│  │  │  ├─ confidence.ts
│  │  │  └─ geo.ts              # haversine, haul classification
│  │  ├─ data/
│  │  │  ├─ ourairports.ts
│  │  │  ├─ faaEnplanements.ts
│  │  │  ├─ opensky.ts          # OAuth2 token manager + flights
│  │  │  ├─ nasStatus.ts
│  │  │  ├─ cache.ts            # file cache with TTL
│  │  │  └─ aliases.ts          # city/region → airports
│  │  ├─ config/scoring.ts
│  │  └─ types.ts
│  ├─ scripts/build-seed.ts     # downloads + builds data/seed/*.json
│  ├─ data/seed/                # committed seed JSON
│  └─ test/                     # vitest
└─ web/                          # Angular CLI project
   ├─ proxy.conf.json             # /api → http://localhost:3001
   └─ src/app/
      ├─ app.component.ts         # hosts the chat page
      ├─ chat/chat.component.ts   # messages, input, send, loading, mic button
      ├─ chat/evidence.component.ts  # scores table, sources, caveats, confidence
      ├─ services/chat.service.ts    # HttpClient POST /api/chat, sessionId
      ├─ services/voice.service.ts   # Web Speech API wrapper
      └─ models.ts                # ChatResponse / Evidence types (mirror the server)
```

---

## 9. Environment variables (`.env.example`)

```
GROQ_API_KEY=
GROQ_MODEL_PRIMARY=openai/gpt-oss-120b
GROQ_MODEL_FALLBACK=llama-3.3-70b-versatile
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
PORT=3001
CACHE_DIR=./server/data/cache
USE_SEED_ONLY=false          # true = fully offline demo
# Optional LangSmith tracing
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=airport-agent
```

Setup links for the README: Groq key at console.groq.com; OpenSky API client on your opensky-network.org Account page.

---

## 10. Build phases (give these to Claude Code one at a time)

### Phase 0 — Scaffold (≈30 min)
**Prompt:** "Scaffold the monorepo per PLAN.md section 8: npm workspaces, strict TS, ESM, Express 5 server with `express.json()`, `cors`, a central error-handling middleware, and `/api/health`, an Angular app in `web/` created with the Angular CLI (standalone components, no routing, no SSR, plain CSS) with `proxy.conf.json` for `/api`, `concurrently` to run both, vitest, eslint + prettier, `.env.example`, root scripts `dev`, `test`, `seed`, `build`."
**Done when:** `npm run dev` starts both apps; `/api/health` returns `{ok:true}`; `npm test` runs.

### Phase 1 — Data layer + seed (≈1.5 h)
**Prompt:** "Implement `server/src/data/*` and `scripts/build-seed.ts` per PLAN.md section 3. Find current FAA enplanement Excel URLs for the latest available year plus 2019. Build `data/seed/airports.json` for US large+medium hub airports with codes, state, coords, active runway count, and enplanements by year. Implement the file cache with TTL, OpenSky OAuth2 token manager, and NAS Status XML parsing. All functions return `{data, sources, asOf, caveats}`."
**Done when:** `npm run seed` produces the seed file; a small script prints SFO, LAX, SNA, ANC, BOS records; OpenSky returns departures for PANC (Anchorage’s ICAO code) (or a clear error if credentials are missing, with seed fallback).

### Phase 2 — Scoring engine + tests (≈1.5 h)
**Prompt:** "Implement `server/src/scoring/*` exactly per PLAN.md section 5 with weights in `config/scoring.ts`. Pure functions only. Write vitest tests including the hand-computed worked example, haversine accuracy (SFO–JFK ≈ 4,150 km), haul classification boundaries, percentile ties, and confidence downgrades."
**Done when:** all tests pass; coverage of `scoring/` ≥ 90%.

### Phase 3 — Tools (≈1 h)
**Prompt:** "Implement the six tools in PLAN.md section 6 as LangChain `tool()` objects with zod schemas and `responseFormat: 'content_and_artifact'`, the alias/region table, and compact outputs (≤ 1,500 tokens each). Add a CLI `npm run tool -- <name> '<json>'` for manual testing."
**Done when:** CLI works for: `resolve_airports {"query":"New England"}`, `compare_airports {"iatas":["LAX","SNA"]}`, `flight_mix {"iata":"ANC"}`, `demand_pressure {"iata":"SFO"}`.

### Phase 4 — Agent with createAgent (≈1 h)
**Prompt:** "Implement the agent per PLAN.md section 4 ('Agent design') and the system prompt per section 7, using LangChain v1 `createAgent` with `@langchain/groq`. Add the MemorySaver checkpointer keyed by sessionId, the two custom middleware (trim history, focus airports) using `createMiddleware`, plus the built-in `toolCallLimitMiddleware` and `modelFallbackMiddleware`. In `run.ts`, extract evidence from this turn's ToolMessage artifacts. Wire it to `POST /api/chat {sessionId, message}` returning `{answer, evidence, toolsUsed, model}`. Add unit tests for evidence extraction and the focus-airports logic, and one agent test using a fake chat model (no network)."
**Done when:** the four example questions from section 1 return grounded answers via curl, and a follow-up like "Why is the second one ranked lower?" works in the same session (memory via the checkpointer).

### Phase 5 — Chat UI (≈1 h)
**Prompt:** "Build the Angular chat per PLAN.md section 8, keeping it simple: one page with a message list, a text input with send button (Enter to send), and a loading indicator. `ChatService` posts to `/api/chat` with a sessionId generated once per page load. Under each agent answer, `EvidenceComponent` shows a collapsible section with the scores table, sources with dates, caveats, and the confidence level. Use signals for state and plain CSS. No routing, no UI library, no extra features."
**Done when:** all four example questions and a follow-up work end-to-end in the browser.

### Phase 5b — Voice input (≈20 min)
**Prompt:** "Add voice input, frontend only: `VoiceService` wraps the browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`, lang `en-US`). Add a mic button next to send in `ChatComponent`: click to start, shows 'Listening…', puts the final transcript in the input and sends it. If the browser doesn't support it, hide the mic button. Nothing else."
**Done when:** in Chrome, speaking "Compare LA and Santa Ana airport congestion levels" sends the question and returns an answer; in unsupported browsers the text chat still works normally.

### Phase 6 — Docs + polish (≈1 h)
**Prompt:** "Write DESIGN.md (1–2 pages) covering: architecture diagram, scoring methodology with formulas and weights, key tradeoffs, where/how AI is used, assumptions, limitations, and future work. Write README with setup, env vars, and demo script. Run lint and tests, fix issues."
**Done when:** a fresh clone runs with `npm i && npm run seed && npm run dev`.

---

## 11. DESIGN.md outline (deliverable)

1. **Problem & scope** — what the agent does and does not do.
2. **Architecture** — diagram from section 4; request flow.
3. **Scoring methodology** — KPIs, normalization, weights, tiers, confidence rules, why these proxies.
4. **Where AI is used** — intent understanding, entity resolution fallback, tool selection, argument filling,
   natural-language explanation, follow-up handling, all orchestrated by LangChain `createAgent` (which runs on LangGraph). **Where it is not used** — any number, score, rank, or confidence.
5. **Key tradeoffs**
   - Proxies (passengers per runway) instead of true terminal/gate capacity: no free national gate dataset.
   - National percentile normalization vs. within-query normalization: stable and comparable, but regional nuance is lost.
   - OpenSky sampling of a few recent days: current and free, but small samples and ADS-B coverage gaps.
   - NAS Status is a live snapshot, not a historical delay rate.
   - Groq free tier: fast and free, but tight token limits, which drove compact tool outputs.
   - Seed data fallback: reliable demo, at the cost of freshness (always disclosed).
   - `createAgent` vs. a custom LangGraph `StateGraph`: less code and faster to build; a custom graph is the next step if the workflow grows (e.g. research → score → write memo), and the tools move over unchanged.
   - In-memory `MemorySaver`: simple, but conversations are lost on restart (a Postgres/SQLite checkpointer is the production path).
6. **Assumptions & uncertainty** — how caveats and confidence are surfaced.
7. **Future work** — BTS T-100 load factors and on-time history, FAA ASPM delays, airport CIP/cost data,
   financial modeling, persistent storage, evals.

---

## 12. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| OpenSky auth/rate limit fails | Cached results → seed sample → answer with lowered confidence and explicit caveat |
| FAA Excel format changes | Seed script with column auto-detection; committed seed JSON |
| Groq 429 / model removed | Fallback model, startup model check, plus explicit rate-limit retry with Groq's suggested delay in `agent/rateLimit.ts` (single retry, then a clean `RATE_LIMITED` error surfaced to the UI instead of a raw 500) |
| LLM hallucinates numbers | System prompt rule + UI shows the evidence panel from tool output, so users can verify |
| Ambiguous names ("LA", "Santa Ana") | Alias table + `resolve_airports` states its interpretation in the answer |

---

## 13. Demo script (for the review)
1. "Which airports in New England are strong candidates for terminal expansion?"
2. Follow-up: "Why is Boston ranked where it is?"
3. "Compare LA and Santa Ana airport congestion levels."
4. "What is the percentage of long-haul flights out of Anchorage airport?"
5. Follow-up: "And excluding cargo?"
6. "What is the unmet flight demand in SFO and why?"
7. "How do you calculate the opportunity score?"
8. Ask one question by voice.
