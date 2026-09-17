# CLAUDE.md

## Project
Airport Investment Intelligence Agent. Full plan in `PLAN.md`. Work **one phase at a time** and stop after each phase for review.

## Commands
- `npm run dev` — start server (port 3001) and Angular app (port 4200, proxies `/api`)
- `npm test` — vitest
- `npm run seed` — download public data and build `server/data/seed/*.json`
- `npm run tool -- <toolName> '<json args>'` — run a single agent tool from the CLI
- `npm run lint` / `npm run build`

## Hard rules
- TypeScript strict mode, ESM, no `any` (use `unknown` + zod).
- **The LLM never computes numbers.** All metrics, scores, ranks, and confidence come from `server/src/scoring/` (pure functions).
- Every data function and tool returns `{ data, sources, asOf, caveats }`.
- Scoring weights and thresholds live only in `server/src/config/scoring.ts`.
- Tool outputs must stay compact (≤ ~1,500 tokens); summarize, never dump raw flight lists.
- Secrets only from `.env`; never log keys or tokens.
- All network calls go through `data/cache.ts` with a TTL; fall back to seed data on failure and add a caveat.
- Agent is built with **LangChain v1** `createAgent`, which runs on LangGraph (company standard). LLM access only through `ChatGroq` from `@langchain/groq`, with `maxRetries` and `modelFallbackMiddleware`. Do not use the raw `openai` SDK.
- Build the agent with LangChain v1 `createAgent` (see PLAN.md section 4), with middleware for history trimming, focus airports, tool-call limit and model fallback. Do not use the deprecated `createReactAgent`. Check current docs at docs.langchain.com before writing LangChain code.
- Do not use Google Gemini.

## Conventions
- Frontend is **Angular** in `web/`: standalone components, signals, `HttpClient`, plain CSS. Keep it to one chat page with the evidence section and a mic button. No routing, NgRx, SSR, or UI libraries.
- Server is **Express 5**. Routes live in `express.Router()` modules; validate request bodies with zod middleware; all errors go to one error-handling middleware that returns `{ error: { message, code } }`. Do not add Fastify or other frameworks.
- One tool per file in `server/src/agent/tools/`, each a LangChain `tool()` with a zod schema and `responseFormat: "content_and_artifact"` (compact text for the LLM, full structured result as the artifact). Tool functions call scoring/data code; they contain no scoring logic themselves.
- Conversation memory uses the LangGraph `MemorySaver` checkpointer with `thread_id = sessionId`.
- Agent tests use a fake chat model, never the real Groq API.
- Airport codes: IATA for user-facing, ICAO for OpenSky calls (US: `K` + IATA for most airports, but read ICAO from OurAirports, since e.g. Anchorage is `PANC`).
- Distances in km internally; show miles too in answers.
- Write/update tests whenever scoring code changes.
- Before finishing a phase: run `npm run lint && npm test` and report results.
