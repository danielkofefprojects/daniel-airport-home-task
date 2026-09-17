import { describe, expect, it } from "vitest";
import { createAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { streamAgent } from "../src/agent/run.js";

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

describe("streamAgent (fake chat model, no network)", () => {
  it("streams answer tokens and finishes with a done event carrying evidence and toolsUsed", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "echo", args: { text: "hello" } }])
      .respond(new AIMessage("Done echoing."));

    const agent = createAgent({ model, tools: [echoTool], checkpointer: new MemorySaver() });

    const events = [];
    for await (const event of streamAgent("stream-session-1", "please echo hello", agent)) {
      events.push(event);
    }

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type !== "done") throw new Error("expected a done event");
    expect(doneEvent.result.answer).toBe("Done echoing.");
    expect(doneEvent.result.toolsUsed).toEqual(["echo"]);
    expect(doneEvent.result.evidence).toEqual([
      { tool: "echo", artifact: { data: { iata: "SFO", echoed: "hello" }, sources: ["test"], asOf: "2026-01-01", caveats: [] } }
    ]);
  });
});
