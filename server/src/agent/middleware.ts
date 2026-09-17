import { createMiddleware } from "langchain";
import { SystemMessage, ToolMessage } from "@langchain/core/messages";

const MAX_HISTORY_MESSAGES = 16;

/**
 * Finds the latest cut point at or after `minIndex` that doesn't start on a ToolMessage, so a trimmed
 * window never opens with a tool result whose triggering AIMessage.tool_calls got cut, which Groq rejects.
 */
function safeTrimStart(messages: readonly unknown[], minIndex: number): number {
  let i = minIndex;
  while (i < messages.length && messages[i] instanceof ToolMessage) {
    i += 1;
  }
  return i;
}

/** Keeps the system prompt plus the most recent turns so Groq's tight token limits aren't exceeded. */
export const trimHistoryMiddleware = createMiddleware({
  name: "trimHistoryMiddleware",
  beforeModel: (state) => {
    if (state.messages.length <= MAX_HISTORY_MESSAGES) {
      return;
    }
    const start = safeTrimStart(state.messages, state.messages.length - MAX_HISTORY_MESSAGES);
    return { messages: state.messages.slice(start) };
  }
});

/** Recursively collects IATA codes (values of any "iata" key) from a tool artifact. */
function collectIataCodes(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectIataCodes(item, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === "iata" && typeof val === "string" && /^[A-Z]{3}$/.test(val)) {
        into.add(val);
      } else {
        collectIataCodes(val, into);
      }
    }
  }
}

/** Extracts the IATA codes referenced by this turn's tool artifacts, most recent tool call last. */
export function extractFocusAirports(messages: readonly { getType?: () => string }[]): string[] {
  const codes = new Set<string>();
  for (const message of messages) {
    if (message instanceof ToolMessage) {
      collectIataCodes(message.artifact, codes);
    }
  }
  return [...codes];
}

/**
 * Adds the airports referenced by the most recent tool results to the system prompt, so follow-ups like
 * "why is the second one ranked lower?" or "what about Boston only?" resolve against the right airports.
 */
export const focusAirportsMiddleware = createMiddleware({
  name: "focusAirportsMiddleware",
  wrapModelCall: async (request, handler) => {
    const focusAirports = extractFocusAirports(request.state.messages);
    if (focusAirports.length === 0) {
      return handler(request);
    }
    // Only override systemMessage, leaving systemPrompt as-is: the agent loop forbids changing both
    // in the same request (it can't tell whether systemPrompt or systemMessage should win).
    const baseText = request.systemMessage?.text ?? request.systemPrompt ?? "";
    const augmented = new SystemMessage(
      `${baseText}\n\nAirports in focus from the most recent tool results: ${focusAirports.join(", ")}.`
    );
    return handler({ ...request, systemMessage: augmented });
  }
});
