# DESIGN.md — Airport Investment Intelligence Agent

## 1. Problem & scope

Analysts evaluating where terminal/capacity renovation is likely to pay off need to combine passenger demand
trends with capacity pressure signals across dozens of US airports. This agent is a chat interface over a
deterministic scoring engine: it answers questions like "which New England airports are strong candidates for
terminal expansion?", compares airports, breaks down flight mix, and explains unmet demand — always citing the
underlying data and its vintage.

**In scope:** ranking/scoring US large+medium hub airports on demand and congestion proxies, comparisons,
flight-mix analysis (haul length, cargo heuristic), unmet-demand attribution, conversational follow-ups, voice
input.

**Out of scope:** financial modeling (IRR/NPV), construction cost estimates, gate-level terminal capacity (no
free national dataset), authentication, deployment/hosting, non-US airports.

## 2. Architecture

```
┌──────────────┐  POST /api/chat(/stream)      ┌────────────────────────────────────────┐
│ Angular chat │ ──────────────────────────────►│ Express 5 server                       │
│  + mic input │ ◄────────────────────────────── │  └─ createAgent (LangChain/LangGraph)  │
│              │  token / done / error events   │      ├─ MemorySaver (thread = session) │
└──────────────┘                                │      └─ 6 tools (deterministic)        │
                                                 │      Scoring engine (pure functions)   │
                                                 │      Data layer + file cache (TTL)     │
                                                 └───────────┬────────────────────────────┘
                                                             │
                     OurAirports · FAA enplanements · OpenSky · FAA NAS Status
```

**Request flow:** the browser posts `{sessionId, message}`. `run.ts` invokes the LangChain `createAgent` graph,
which lets the model pick and call tools (each a pure wrapper around `scoring/` and `data/`), then produces a
natural-language answer. `run.ts` extracts this turn's `ToolMessage` artifacts as `evidence` (plain code, no AI)
and returns `{answer, evidence, toolsUsed, model}`. The streaming endpoint (`/api/chat/stream`) does the same
over SSE, emitting `token` events as the final answer is generated and one `done` event with the authoritative
state read back from the checkpointer.

**Middleware chain:** `trimHistoryMiddleware` (keeps system + recent turns, bounding token usage) →
`focusAirportsMiddleware` (injects IATA codes from the most recent tool artifacts so follow-ups like "why is the
second one ranked lower?" resolve without re-stating airport names) → `toolCallLimitMiddleware` (caps tool calls
per run) → `modelFallbackMiddleware` (switches to the fallback Groq model on error/429).

**Rate-limit handling:** two layers absorb Groq failures before they reach the user. `ChatGroq` itself retries
transient/network errors (`maxRetries: 3`). Separately, `withRateLimitRetry` in `run.ts` catches a 429 specifically,
waits the delay Groq's error reports, and retries the whole agent invocation once; only a second consecutive 429
is surfaced as a `429 RATE_LIMITED` HTTP error. This exists because Groq's free tier rate-limits are hit often
enough in normal use that failing on the first 429 would make the demo flaky; one bounded, server-guided retry
smooths over most blips at the cost of one extra round-trip of latency on the unlucky requests that hit it.

## 3. Scoring methodology

All formulas and weights live in `server/src/config/scoring.ts`; the functions in `server/src/scoring/` are pure
(no I/O, no LLM calls) so they're independently unit-testable and auditable.

**Raw KPIs per airport** (from FAA enplanements, OurAirports, OpenSky, FAA NAS Status):
`enplanements`, `growthCagr` (vs. 2019 baseline), `recoveryRatio` (latest / 2019), `paxPerRunway`, `dailyOps`,
`opsPerRunway`, `delaySignal` (0 / 0.5 / 1), `longHaulShare`, `unknownDestShare`.

**Normalization:** each KPI is percentile-ranked (0–100) against a fixed national peer set of US large+medium
hub airports, so a regional query (e.g. "New England") doesn't inflate weak airports relative to each other.

**Composite scores:**
```
DemandScore      = 0.6·pct(growthCagr) + 0.4·pct(enplanements)
CongestionScore  = 0.5·pct(paxPerRunway) + 0.35·pct(opsPerRunway) + 0.15·delaySignal·100
OpportunityScore = 0.45·DemandScore + 0.40·CongestionScore + 0.15·pct(recoveryRatio)
UnmetDemandIndex = CongestionScore × (DemandScore / 100)
```
Opportunity tiers: ≥70 Strong · 50–69 Moderate · <50 Weak (`SCORE_TIERS` in config).

**Confidence** starts at High and is downgraded one level per failing check: OpenSky sample <100 flights or
unknown-destination share >25%, enplanement data older than 2 years, any source fell back to seed/cache past its
TTL, or the delay signal was unavailable. This is fully deterministic (`scoring/confidence.ts`).

**Why these proxies:** there's no free, national, gate-level terminal capacity dataset, so passengers-per-runway
and ops-per-runway stand in for physical capacity pressure. Parallel runways too close to operate independently
aren't distinguishable from OurAirports data alone — a known limitation surfaced in caveats.

## 4. Where AI is used — and where it isn't

**AI (LangChain `createAgent` / Groq):** understanding user intent, resolving ambiguous place names via
`resolve_airports` (with an LLM fallback if the alias table misses), choosing which tool(s) to call and filling
their arguments, writing the natural-language explanation, and carrying conversational context for follow-ups.

**Never AI — always deterministic code:** every number, score, percentile, rank, tier, and confidence level. The
system prompt explicitly forbids the model from inventing metrics, and every tool response is a compact
LLM-facing summary plus a full structured `artifact` that the UI's evidence panel renders directly from tool
output — so a user can verify any number against its source without trusting the model's prose.

## 5. Key tradeoffs

- **Proxies instead of true gate/terminal capacity** — no free national dataset exists; passengers/ops per
  runway are the best available signal, disclosed as a limitation.
- **National percentile normalization vs. within-query normalization** — stable and comparable across queries,
  but a regional cluster of uniformly strong or weak airports loses some relative nuance.
- **OpenSky sampling of a few recent days** — current and free, but small samples and ADS-B coverage gaps lower
  confidence; reflected in the confidence downgrade rules.
- **NAS Status is a live snapshot**, not a historical delay rate — the `delaySignal` KPI reflects "right now,"
  not a trend.
- **Groq free tier token limits** — drove compact (~1,500 token) tool outputs and history trimming middleware,
  at some cost to how much conversational context the model sees.
- **Seed data fallback** — guarantees an offline-capable demo at the cost of freshness; every response that used
  seed/cache data says so via `caveats` and a downgraded confidence.
- **`createAgent` vs. a custom LangGraph `StateGraph`** — much less code and faster to build for six
  independent tools; a custom graph (e.g. research → score → write memo) is the natural next step if the
  workflow grows multi-stage, and the existing tools would move over unchanged.
- **In-memory `MemorySaver`** — conversations are lost on server restart; a Postgres/SQLite checkpointer is the
  production path, same LangGraph interface.
- **Single active session, no session history** — the client only ever holds one `sessionId` and there's no UI or
  API to list or reopen past sessions; closing/refreshing effectively starts a new conversation with no way back
  to the old one. A durable checkpointer (above) plus a session-list endpoint are both needed before multi-session
  history is possible.

## 6. Assumptions & uncertainty

Every data function and tool returns `{data, sources, asOf, caveats}`. The evidence panel in the UI surfaces
`sources` (with dates), `caveats`, and the deterministic `confidence` level for every answer, so uncertainty is
never hidden in prose. The system prompt requires the model to state data vintage for every number it cites and
to explicitly label any general background knowledge (e.g. weather-related arrival-rate context) as distinct
from computed data.

## 7. Future work

- BTS T-100 load factors and on-time performance history for a real historical delay rate (vs. the live NAS
  snapshot).
- FAA ASPM delay data for a richer congestion signal.
- Airport CIP (Capital Improvement Program) and cost data to move toward actual investment sizing.
- Financial modeling (IRR/NPV) once cost data is available.
- Persistent checkpointer (Postgres/SQLite) for durable conversation history.
- Automated evals for tool selection and answer quality against the section-1 example questions.
