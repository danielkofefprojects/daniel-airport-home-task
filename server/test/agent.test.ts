import { describe, expect, it } from "vitest";
import { createAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { runAgent } from "../src/agent/run.js";

const echoTool = tool(
  async ({ text }: { text: string }) => {
    const artifact = { data: { iata: "SFO", echoed: text }, sources: ["test"], asOf: "2026-01-01", caveats: [] };
    return [`echoed: ${text}`, artifact] as const;
  },
  {
    name: "echo",
    description: "Echoes the given text back, for testing.",
    schema: z.object({ text: z.string() }),
    responseFormat: "content_and_artifact"
  }
);

describe("agent (fake chat model, no network)", () => {
  it("returns the answer, evidence and toolsUsed from a tool-calling turn", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "echo", args: { text: "hello" } }])
      .respond(new AIMessage("Done echoing."));

    const agent = createAgent({ model, tools: [echoTool], checkpointer: new MemorySaver() });

    const result = await runAgent("session-1", "please echo hello", agent);

    expect(result.answer).toBe("Done echoing.");
    expect(result.toolsUsed).toEqual(["echo"]);
    expect(result.evidence).toEqual([
      { tool: "echo", artifact: { data: { iata: "SFO", echoed: "hello" }, sources: ["test"], asOf: "2026-01-01", caveats: [] } }
    ]);
  });

  it("persists conversation memory across turns via the same thread_id", async () => {
    const model = fakeModel()
      .respond(new AIMessage("First answer."))
      .respond(new AIMessage("Second answer, building on the first."));

    const agent = createAgent({ model, tools: [echoTool], checkpointer: new MemorySaver() });

    await runAgent("session-2", "first question", agent);
    await runAgent("session-2", "follow-up question", agent);

    expect(model.callCount).toBe(2);
    const secondCall = model.calls[1];
    expect(secondCall).toBeDefined();
    // The follow-up call should include the earlier human + AI turn in history.
    expect(
      secondCall?.messages.some((m) => typeof m.content === "string" && m.content === "first question")
    ).toBe(true);
  });
});
