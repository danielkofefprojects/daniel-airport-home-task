import { describe, expect, it } from "vitest";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { extractFocusAirports } from "../src/agent/middleware.js";

describe("extractFocusAirports", () => {
  it("collects unique IATA codes from tool artifacts, ignoring non-iata fields", () => {
    const messages = [
      new HumanMessage("Compare LA and Santa Ana"),
      new ToolMessage({
        content: "resolved",
        tool_call_id: "1",
        name: "resolve_airports",
        artifact: { data: { matches: [{ iata: "LAX", state: "CA" }, { iata: "SNA", state: "CA" }] } }
      }),
      new ToolMessage({
        content: "compared",
        tool_call_id: "2",
        name: "compare_airports",
        artifact: { data: { rows: [{ iata: "LAX" }, { iata: "SNA" }], mostCongested: { iata: "LAX" } } }
      })
    ];

    expect(extractFocusAirports(messages)).toEqual(["LAX", "SNA"]);
  });

  it("returns an empty list when there are no tool messages", () => {
    expect(extractFocusAirports([new HumanMessage("hello")])).toEqual([]);
  });

  it("ignores non-airport-code string values under an iata key", () => {
    const messages = [
      new ToolMessage({
        content: "no match",
        tool_call_id: "1",
        name: "resolve_airports",
        artifact: { data: { matches: [], resolvedAs: "no_match" } }
      })
    ];
    expect(extractFocusAirports(messages)).toEqual([]);
  });
});
