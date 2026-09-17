import { describe, expect, it } from "vitest";
import { computeConfidence } from "../src/scoring/confidence.js";

const baseInputs = {
  openSkySampleSize: 500,
  unknownDestShare: 0.1,
  enplanementDataYear: 2024,
  currentYear: 2026,
  usedStaleFallback: false,
  delaySignalAvailable: true
};

describe("computeConfidence", () => {
  it("stays High when nothing triggers a downgrade", () => {
    expect(computeConfidence(baseInputs)).toEqual({ level: "High", reasons: [] });
  });

  it("downgrades once for a small OpenSky sample", () => {
    const result = computeConfidence({ ...baseInputs, openSkySampleSize: 50 });
    expect(result.level).toBe("Medium");
    expect(result.reasons).toHaveLength(1);
  });

  it("downgrades once for a high unknown-destination share", () => {
    const result = computeConfidence({ ...baseInputs, unknownDestShare: 0.5 });
    expect(result.level).toBe("Medium");
  });

  it("does not double-downgrade for both sample-size and unknown-share issues at once", () => {
    const result = computeConfidence({ ...baseInputs, openSkySampleSize: 50, unknownDestShare: 0.5 });
    expect(result.level).toBe("Medium");
    expect(result.reasons).toHaveLength(1);
  });

  it("downgrades for stale enplanement data", () => {
    const result = computeConfidence({ ...baseInputs, enplanementDataYear: 2020 });
    expect(result.level).toBe("Medium");
  });

  it("downgrades for missing enplanement data", () => {
    const result = computeConfidence({ ...baseInputs, enplanementDataYear: undefined });
    expect(result.level).toBe("Medium");
  });

  it("downgrades for a stale fallback source", () => {
    const result = computeConfidence({ ...baseInputs, usedStaleFallback: true });
    expect(result.level).toBe("Medium");
  });

  it("downgrades for unavailable delay signal", () => {
    const result = computeConfidence({ ...baseInputs, delaySignalAvailable: false });
    expect(result.level).toBe("Medium");
  });

  it("floors at Low even when every condition triggers", () => {
    const result = computeConfidence({
      openSkySampleSize: 10,
      unknownDestShare: 0.9,
      enplanementDataYear: undefined,
      currentYear: 2026,
      usedStaleFallback: true,
      delaySignalAvailable: false
    });
    expect(result.level).toBe("Low");
    expect(result.reasons).toHaveLength(4);
  });
});
