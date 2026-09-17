import { describe, expect, it } from "vitest";
import { statusForAirport } from "../src/data/nasStatus.js";
import type { NasStatusSnapshot } from "../src/types.js";

describe("statusForAirport", () => {
  const snapshot: NasStatusSnapshot = {
    updateTime: "now",
    groundStops: ["MDW"],
    groundDelays: ["SFO", "BOS"],
    generalDelays: ["ORD"]
  };

  it("reports a ground stop when the airport has one", () => {
    expect(statusForAirport(snapshot, "MDW")).toEqual({
      iata: "MDW",
      level: "ground_stop",
      reasons: ["Ground stop in effect"]
    });
  });

  it("reports a delay when the airport has a ground delay", () => {
    expect(statusForAirport(snapshot, "SFO").level).toBe("delay");
  });

  it("reports a delay when the airport has a general delay", () => {
    expect(statusForAirport(snapshot, "ORD").level).toBe("delay");
  });

  it("reports no delay for an unaffected airport", () => {
    expect(statusForAirport(snapshot, "LAX")).toEqual({ iata: "LAX", level: "none", reasons: [] });
  });
});
