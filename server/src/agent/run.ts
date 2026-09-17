import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { HttpError } from "../middleware/errorHandler.js";
import { isRateLimitError, rateLimitRetryDelayMs } from "./rateLimit.js";

/** Structural shape used by any compiled createAgent() graph, real or built with a fake model for tests. */
export interface InvokableAgent {
  invoke(
    input: { messages: BaseMessage[] },
    config: { configurable: { thread_id: string } }
  ): Promise<{ messages: BaseMessage[] }>;
  stream(
    input: { messages: BaseMessage[] },
    config: { configurable: { thread_id: string }; streamMode: "messages" }
  ): Promise<AsyncIterable<[BaseMessage, Record<string, unknown>]>>;
  getState(config: { configurable: { thread_id: string } }): Promise<{ values: { messages: BaseMessage[] } }>;
}

export interface EvidenceItem {
  tool: string;
  artifact: unknown;
}

export interface AgentRunResult {
  answer: string;
  evidence: EvidenceItem[];
  toolsUsed: string[];
  model: string | undefined;
}

export type AgentStreamEvent =
  | { type: "token"; text: string }
  | { type: "done"; result: AgentRunResult };

/** Index of the most recent HumanMessage, marking the start of this turn. */
function lastHumanMessageIndex(messages: readonly BaseMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] instanceof HumanMessage) return i;
  }
  return 0;
}

function extractModelName(message: AIMessage | undefined): string | undefined {
  const metadata = message?.response_metadata as Record<string, unknown> | undefined;
  const model = metadata?.["model"] ?? metadata?.["model_name"];
  return typeof model === "string" ? model : undefined;
}

/** Extracts the answer, evidence and tool list for the latest turn (messages since the last HumanMessage). */
export function extractRunResult(messages: readonly BaseMessage[]): AgentRunResult {
  const turnStart = lastHumanMessageIndex(messages);
  const turnMessages = messages.slice(turnStart);

  const evidence: EvidenceItem[] = [];
  const toolsUsed: string[] = [];
  for (const msg of turnMessages) {
    if (msg instanceof ToolMessage) {
      const toolName = typeof msg.name === "string" ? msg.name : "unknown_tool";
      toolsUsed.push(toolName);
      evidence.push({ tool: toolName, artifact: msg.artifact });
    }
  }

  const lastAiMessage = [...turnMessages].reverse().find((m): m is AIMessage => m instanceof AIMessage);

  return {
    answer: typeof lastAiMessage?.content === "string" ? lastAiMessage.content : "",
    evidence,
    toolsUsed,
    model: extractModelName(lastAiMessage)
  };
}

let cachedAgent: InvokableAgent | undefined;

async function getDefaultAgent(): Promise<InvokableAgent> {
  if (!cachedAgent) {
    const { buildAgent } = await import("./agent.js");
    cachedAgent = buildAgent() as unknown as InvokableAgent;
  }
  return cachedAgent;
}

function toRateLimitError(): HttpError {
  return new HttpError(
    429,
    "RATE_LIMITED",
    "The assistant is handling a lot of requests right now. Please try again in a few seconds."
  );
}

/** Runs `fn` once, retrying a single time if it fails with a Groq rate-limit error, waiting Groq's suggested delay. */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRateLimitError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, rateLimitRetryDelayMs(err)));
    try {
      return await fn();
    } catch (retryErr) {
      if (isRateLimitError(retryErr)) throw toRateLimitError();
      throw retryErr;
    }
  }
}

export async function runAgent(sessionId: string, message: string, agent?: InvokableAgent): Promise<AgentRunResult> {
  const activeAgent = agent ?? (await getDefaultAgent());
  const result = await withRateLimitRetry(() =>
    activeAgent.invoke({ messages: [new HumanMessage(message)] }, { configurable: { thread_id: sessionId } })
  );
  return extractRunResult(result.messages);
}

/**
 * Streams the agent's answer token-by-token (final-answer text only, tool-call chunks are skipped since
 * their content is empty), then yields a "done" event with the authoritative answer/evidence/toolsUsed
 * read back from the checkpointed graph state (not reconstructed from streamed chunks).
 */
export async function* streamAgent(
  sessionId: string,
  message: string,
  agent?: InvokableAgent
): AsyncGenerator<AgentStreamEvent> {
  const activeAgent = agent ?? (await getDefaultAgent());
  const config = { configurable: { thread_id: sessionId } };

  async function* run() {
    const stream = await activeAgent.stream({ messages: [new HumanMessage(message)] }, { ...config, streamMode: "messages" });
    for await (const [chunk] of stream) {
      if (chunk instanceof ToolMessage) continue;
      const text = typeof chunk.content === "string" ? chunk.content : "";
      if (text) yield { type: "token", text } as const;
    }
  }

  try {
    yield* run();
  } catch (err) {
    if (!isRateLimitError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, rateLimitRetryDelayMs(err)));
    try {
      yield* run();
    } catch (retryErr) {
      if (isRateLimitError(retryErr)) throw toRateLimitError();
      throw retryErr;
    }
  }

  const state = await activeAgent.getState(config);
  yield { type: "done", result: extractRunResult(state.values.messages) };
}
