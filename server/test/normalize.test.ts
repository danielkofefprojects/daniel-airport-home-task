import { describe, expect, it } from "vitest";
import { percentileRank, percentileRankAll } from "../src/scoring/normalize.js";

describe("percentileRank", () => {
  it("gives the lowest value a percentile near 0 and highest near 100", () => {
    const population = [10, 20, 30, 40];
    expect(percentileRank(10, population)).toBeCloseTo(12.5, 5);
    expect(percentileRank(40, population)).toBeCloseTo(87.5, 5);
  });

  it("gives tied values the same, averaged percentile", () => {
    const population = [10, 20, 20, 30];
    // Two values equal 20: below=1, equal=2 -> rank = 1 + 2/2 = 2 -> 2/4*100 = 50
    expect(percentileRank(20, population)).toBeCloseTo(50, 5);
  });

  it("returns 0 for an empty population", () => {
    expect(percentileRank(5, [])).toBe(0);
  });

  it("handles a population of identical values", () => {
    expect(percentileRank(5, [5, 5, 5])).toBeCloseTo(50, 5);
  });
});

describe("percentileRankAll", () => {
  it("excludes undefined values from the population and the output", () => {
    const input = new Map<string, number | undefined>([
      ["A", 10],
      ["B", undefined],
      ["C", 30]
    ]);
    const result = percentileRankAll(input);
    expect(result.has("B")).toBe(false);
    expect(result.get("A")).toBeCloseTo(25, 5);
    expect(result.get("C")).toBeCloseTo(75, 5);
  });
});
