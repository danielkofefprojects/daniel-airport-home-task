import { describe, expect, it } from "vitest";
import { percentileRank } from "../src/scoring/normalize.js";
import {
  congestionScore,
  demandScore,
  driverBreakdown,
  opportunityScore,
  tierFor,
  unmetDemandIndex
} from "../src/scoring/scores.js";

describe("tierFor", () => {
  it("classifies scores per the configured thresholds", () => {
    expect(tierFor(70)).toBe("Strong");
    expect(tierFor(69.9)).toBe("Moderate");
    expect(tierFor(50)).toBe("Moderate");
    expect(tierFor(49.9)).toBe("Weak");
  });
});

describe("driverBreakdown", () => {
  it("sorts contributions descending", () => {
    const drivers = driverBreakdown({
      paxPerRunway: { weight: 0.5, percentile: 80 },
      opsPerRunway: { weight: 0.35, percentile: 20 },
      delay: { weight: 0.15, percentile: 100 }
    });
    expect(drivers.map((d) => d.name)).toEqual(["paxPerRunway", "delay", "opsPerRunway"]);
    expect(drivers[0]?.contribution).toBeCloseTo(40, 10);
  });
});

/**
 * Worked example from PLAN.md section 5.6: two airports with hand-computed inputs.
 *
 * Airport A: 10M (2019) -> 15M (2024) enplanements, 2 active runways.
 * Airport B: 20M (2019) -> 22M (2024) enplanements, 4 active runways.
 * Peer set for percentiles is just {A, B}. opsPerRunway percentiles and delay signals are given directly.
 *
 * Hand-computed (see PLAN.md 5.1-5.3):
 *   A: cagr=8.447%, recovery=1.5, paxPerRunway=15,000,000
 *   B: cagr=1.924%, recovery=1.1, paxPerRunway=11,000,000
 * Percentiles within {A, B} (higher value -> 75, lower -> 25):
 *   A: growthCagrPct=75, enplanementsPct=25, paxPerRunwayPct=75, recoveryRatioPct=75
 *   B: growthCagrPct=25, enplanementsPct=75, paxPerRunwayPct=25, recoveryRatioPct=25
 * opsPerRunwayPct given as A=60, B=40. delaySignal: A=0 (none), B=0.5 (delay reported).
 */
describe("worked example: opportunity and unmet demand ranking", () => {
  const aEnplanements2024 = 15_000_000;
  const bEnplanements2024 = 22_000_000;

  const aCagrPct = percentileRank(0.08447177119769855, [0.08447177119769855, 0.019244876491456564]);
  const bCagrPct = percentileRank(0.019244876491456564, [0.08447177119769855, 0.019244876491456564]);
  const aEnplPct = percentileRank(aEnplanements2024, [aEnplanements2024, bEnplanements2024]);
  const bEnplPct = percentileRank(bEnplanements2024, [aEnplanements2024, bEnplanements2024]);
  const aPprPct = percentileRank(15_000_000, [15_000_000, 11_000_000]);
  const bPprPct = percentileRank(11_000_000, [15_000_000, 11_000_000]);
  const aRecoveryPct = percentileRank(1.5, [1.5, 1.1]);
  const bRecoveryPct = percentileRank(1.1, [1.5, 1.1]);

  const aOpsPct = 60;
  const bOpsPct = 40;
  const aDelay = 0;
  const bDelay = 0.5;

  it("computes percentiles matching the hand-computed worked example", () => {
    expect(aCagrPct).toBeCloseTo(75, 5);
    expect(bCagrPct).toBeCloseTo(25, 5);
    expect(aEnplPct).toBeCloseTo(25, 5);
    expect(bEnplPct).toBeCloseTo(75, 5);
    expect(aPprPct).toBeCloseTo(75, 5);
    expect(bPprPct).toBeCloseTo(25, 5);
  });

  it("computes DemandScore, CongestionScore, OpportunityScore and ranks A above B", () => {
    const aDemand = demandScore({ growthCagrPct: aCagrPct, enplanementsPct: aEnplPct });
    const bDemand = demandScore({ growthCagrPct: bCagrPct, enplanementsPct: bEnplPct });
    expect(aDemand).toBeCloseTo(55, 5);
    expect(bDemand).toBeCloseTo(45, 5);

    const aCongestion = congestionScore({ paxPerRunwayPct: aPprPct, opsPerRunwayPct: aOpsPct, delaySignal: aDelay });
    const bCongestion = congestionScore({ paxPerRunwayPct: bPprPct, opsPerRunwayPct: bOpsPct, delaySignal: bDelay });
    expect(aCongestion).toBeCloseTo(58.5, 5);
    expect(bCongestion).toBeCloseTo(34, 5);

    const aOpportunity = opportunityScore(aDemand, aCongestion, aRecoveryPct);
    const bOpportunity = opportunityScore(bDemand, bCongestion, bRecoveryPct);
    expect(aOpportunity).toBeCloseTo(59.4, 5);
    expect(bOpportunity).toBeCloseTo(37.6, 5);

    // Airport A is the stronger candidate despite lower absolute enplanements.
    expect(aOpportunity).toBeGreaterThan(bOpportunity);
    expect(tierFor(aOpportunity)).toBe("Moderate");
    expect(tierFor(bOpportunity)).toBe("Weak");

    const aUnmet = unmetDemandIndex(aDemand, aCongestion);
    const bUnmet = unmetDemandIndex(bDemand, bCongestion);
    expect(aUnmet).toBeCloseTo(32.175, 5);
    expect(bUnmet).toBeCloseTo(15.3, 5);
    expect(aUnmet).toBeGreaterThan(bUnmet);
  });
});
