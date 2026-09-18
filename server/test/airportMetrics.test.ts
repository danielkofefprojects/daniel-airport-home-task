import { describe, expect, it } from "vitest";
import { computeMetricsForPeerSet, type MetricsContext } from "../src/agent/tools/airportMetrics.js";
import { CONGESTION_SCORE_WEIGHTS } from "../src/config/scoring.js";
import type { AirportRecord, NasStatusSnapshot } from "../src/types.js";

function airport(overrides: Partial<AirportRecord> = {}): AirportRecord {
  return {
    iata: "AAA",
    icao: "KAAA",
    name: "Test Airport",
    city: "Test City",
    state: "TS",
    latitude: 0,
    longitude: 0,
    hubSize: "M",
    activeRunwayCount: 2,
    runways: [
      { lengthFt: 10000, surface: "ASP", closed: false },
      { lengthFt: 8000, surface: "ASP", closed: false }
    ],
    enplanements: { "2019": 10_000_000, "2024": 15_000_000 },
    ...overrides
  };
}

const emptyNasStatus: NasStatusSnapshot = {
  updateTime: "2026-01-01T00:00:00Z",
  groundStops: [],
  groundDelays: [],
  generalDelays: []
};

function context(overrides: Partial<MetricsContext> = {}): MetricsContext {
  return {
    nasStatus: emptyNasStatus,
    currentYear: 2026,
    usedStaleFallback: false,
    flightStatsByIata: new Map(),
    ...overrides
  };
}

describe("computeMetricsForPeerSet", () => {
  it("ranks a stronger airport above a weaker one on every composite score", () => {
    const strong = airport({
      iata: "BIG",
      enplanements: { "2019": 10_000_000, "2024": 20_000_000 },
      runways: [
        { lengthFt: 10000, surface: "ASP", closed: false },
        { lengthFt: 10000, surface: "ASP", closed: false }
      ]
    });
    const weak = airport({
      iata: "SML",
      enplanements: { "2019": 10_000_000, "2024": 10_500_000 },
      runways: [
        { lengthFt: 8000, surface: "ASP", closed: false },
        { lengthFt: 8000, surface: "ASP", closed: false },
        { lengthFt: 8000, surface: "ASP", closed: false },
        { lengthFt: 8000, surface: "ASP", closed: false }
      ]
    });

    const result = computeMetricsForPeerSet([strong, weak], context());
    const bigMetrics = result.get("BIG")!;
    const smlMetrics = result.get("SML")!;

    expect(bigMetrics.demandScore).toBeGreaterThan(smlMetrics.demandScore);
    expect(bigMetrics.congestionScore).toBeGreaterThan(smlMetrics.congestionScore);
    expect(bigMetrics.opportunityScore).toBeGreaterThan(smlMetrics.opportunityScore);
  });

  it("computes unmetDemandIndex as congestion * (demand / 100)", () => {
    const a = airport({ iata: "AAA" });
    const b = airport({
      iata: "BBB",
      enplanements: { "2019": 10_000_000, "2024": 11_000_000 },
      runways: [
        { lengthFt: 8000, surface: "ASP", closed: false },
        { lengthFt: 8000, surface: "ASP", closed: false },
        { lengthFt: 8000, surface: "ASP", closed: false }
      ]
    });

    const result = computeMetricsForPeerSet([a, b], context());
    for (const m of result.values()) {
      expect(m.unmetDemandIndex).toBeCloseTo(m.congestionScore * (m.demandScore / 100), 10);
    }
  });

  it("assigns a NAS ground stop to congestion via the delaySignal driver", () => {
    const a = airport({ iata: "AAA" });
    const b = airport({ iata: "BBB" });
    const nasStatus: NasStatusSnapshot = { ...emptyNasStatus, groundStops: ["AAA"] };

    const result = computeMetricsForPeerSet([a, b], context({ nasStatus }));
    const aMetrics = result.get("AAA")!;
    const bMetrics = result.get("BBB")!;

    // Only delaySignal differs between otherwise-identical airports, so AAA's congestion
    // score should exceed BBB's by exactly the delaySignal weight's contribution.
    expect(aMetrics.congestionScore).toBeGreaterThan(bMetrics.congestionScore);
    const delayDriver = aMetrics.unmetDemandDrivers.find((d) => d.name === "delaySignal");
    expect(delayDriver?.contribution).toBeCloseTo(CONGESTION_SCORE_WEIGHTS.delaySignal * 100, 10);
  });

  it("sorts opportunityDrivers by contribution descending using OPPORTUNITY_SCORE_WEIGHTS keys", () => {
    const a = airport({ iata: "AAA" });
    const result = computeMetricsForPeerSet([a], context());
    const drivers = result.get("AAA")!.opportunityDrivers;

    expect(drivers.map((d) => d.name).sort()).toEqual(["congestion", "demand", "recovery"].sort());
    for (let i = 1; i < drivers.length; i++) {
      expect(drivers[i - 1].contribution).toBeGreaterThanOrEqual(drivers[i].contribution);
    }
  });

  it("gives a lone airport the 50th percentile on KPIs it has data for (single-point population)", () => {
    const a = airport({ iata: "AAA" });
    const result = computeMetricsForPeerSet([a], context());
    const m = result.get("AAA")!;

    // percentileRank ties everything with itself -> 50th percentile for growth/enplanements/paxPerRunway.
    // opsPerRunway has no flight-stats entry at all, so it's excluded and its percentile defaults to 0.
    expect(m.demandScore).toBeCloseTo(50, 10);
    expect(m.congestionScore).toBeCloseTo(CONGESTION_SCORE_WEIGHTS.paxPerRunway * 100 * 0.5, 10);
  });

  it("falls back opsPerRunway to undefined (percentile 0) when an airport has no flight stats", () => {
    const withStats = airport({ iata: "AAA" });
    const withoutStats = airport({ iata: "BBB" });
    const flightStatsByIata = new Map([["AAA", { dailyOps: 200, sampleSize: 500, unknownDestShare: 0.1 }]]);

    const result = computeMetricsForPeerSet([withStats, withoutStats], context({ flightStatsByIata }));
    const bMetrics = result.get("BBB")!;
    const opsDriver = bMetrics.unmetDemandDrivers.find((d) => d.name === "opsPerRunway");
    expect(opsDriver?.contribution).toBe(0);
  });

  it("downgrades confidence when an airport has no flight sample or stale enplanement data", () => {
    const noSample = airport({ iata: "AAA", enplanements: { "2019": 10_000_000, "2020": 11_000_000 } });
    const result = computeMetricsForPeerSet([noSample], context({ currentYear: 2026 }));
    const m = result.get("AAA")!;

    expect(m.confidence).not.toBe("High");
    expect(m.confidenceReasons.length).toBeGreaterThan(0);
  });

  it("stays High confidence with a large recent sample and fresh enplanement data", () => {
    const a = airport({ iata: "AAA", enplanements: { "2019": 10_000_000, "2025": 15_000_000 } });
    const flightStatsByIata = new Map([["AAA", { dailyOps: 200, sampleSize: 500, unknownDestShare: 0.1 }]]);
    const result = computeMetricsForPeerSet([a], context({ flightStatsByIata, currentYear: 2026 }));
    const m = result.get("AAA")!;

    expect(m.confidence).toBe("High");
    expect(m.confidenceReasons).toEqual([]);
  });

  it("defaults every KPI percentile to 0 when an airport has no enplanement data at all", () => {
    const noData = airport({ iata: "AAA", enplanements: {} });
    const hasData = airport({ iata: "BBB" });

    const result = computeMetricsForPeerSet([noData, hasData], context());
    const m = result.get("AAA")!;

    expect(m.demandScore).toBe(0);
    expect(m.enplanements).toBeUndefined();
    expect(m.growthCagr).toBeUndefined();
    expect(m.recoveryRatio).toBeUndefined();
    // No valid enplanement years -> enplanementDataYear undefined -> confidence downgraded.
    expect(m.confidence).not.toBe("High");
  });

  it("assigns tier Weak/Moderate/Strong consistent with tierFor thresholds", () => {
    const a = airport({ iata: "AAA" });
    const b = airport({ iata: "BBB" });
    const result = computeMetricsForPeerSet([a, b], context());
    for (const m of result.values()) {
      expect(["Strong", "Moderate", "Weak"]).toContain(m.tier);
    }
  });
});
