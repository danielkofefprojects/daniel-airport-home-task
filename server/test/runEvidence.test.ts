import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { extractRunResult } from "../src/agent/run.js";

describe("extractRunResult", () => {
  it("collects evidence and tool names only from messages after the latest HumanMessage", () => {
    const messages = [
      new HumanMessage("earlier question"),
      new ToolMessage({ content: "old", tool_call_id: "1", name: "resolve_airports", artifact: { data: "old" } }),
      new AIMessage("old answer"),
      new HumanMessage("Compare LAX and SNA"),
      new ToolMessage({
        content: "resolved",
        tool_call_id: "2",
        name: "resolve_airports",
        artifact: { data: { matches: [{ iata: "LAX" }, { iata: "SNA" }] } }
      }),
      new ToolMessage({
        content: "compared",
        tool_call_id: "3",
        name: "compare_airports",
        artifact: { data: { rows: [{ iata: "LAX" }, { iata: "SNA" }] } }
      }),
      new AIMessage("LAX is more congested than SNA.")
    ];

    const result = extractRunResult(messages);

    expect(result.answer).toBe("LAX is more congested than SNA.");
    expect(result.toolsUsed).toEqual(["resolve_airports", "compare_airports"]);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]).toEqual({
      tool: "resolve_airports",
      artifact: { data: { matches: [{ iata: "LAX" }, { iata: "SNA" }] } }
    });
  });

  it("returns an empty answer and no evidence when the model produced no tool calls", () => {
    const messages = [new HumanMessage("hi"), new AIMessage("Hello!")];
    const result = extractRunResult(messages);
    expect(result.answer).toBe("Hello!");
    expect(result.evidence).toEqual([]);
    expect(result.toolsUsed).toEqual([]);
  });

  it("extracts the model name from the final AIMessage response metadata", () => {
    const messages = [
      new HumanMessage("hi"),
      new AIMessage({ content: "hello", response_metadata: { model: "llama-3.3-70b-versatile" } })
    ];
    const result = extractRunResult(messages);
    expect(result.model).toBe("llama-3.3-70b-versatile");
  });
});
