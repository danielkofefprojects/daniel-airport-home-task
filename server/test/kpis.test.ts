import { describe, expect, it } from "vitest";
import {
  activeRunwayCount,
  delaySignal,
  growthCagr,
  latestEnplanements,
  opsPerRunway,
  paxPerRunway,
  recoveryRatio,
  summarizeFlightSample
} from "../src/scoring/kpis.js";
import type { AirportRecord, NasAirportStatus, OpenSkyFlight } from "../src/types.js";

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
      { lengthFt: 8000, surface: "ASP", closed: false },
      { lengthFt: 6000, surface: "ASP", closed: true }
    ],
    enplanements: { "2019": 10_000_000, "2024": 15_000_000 },
    ...overrides
  };
}

describe("activeRunwayCount", () => {
  it("excludes closed runways", () => {
    expect(activeRunwayCount(airport())).toBe(2);
  });
});

describe("latestEnplanements", () => {
  it("picks the latest year present", () => {
    expect(latestEnplanements(airport())).toBe(15_000_000);
  });

  it("returns undefined when there is no enplanement data", () => {
    expect(latestEnplanements(airport({ enplanements: {} }))).toBeUndefined();
  });
});

describe("growthCagr", () => {
  it("matches the hand-computed worked example (10M -> 15M over 5 years)", () => {
    expect(growthCagr(airport())).toBeCloseTo(0.08447177119769855, 10);
  });

  it("returns undefined without a base year", () => {
    expect(growthCagr(airport({ enplanements: { "2024": 15_000_000 } }))).toBeUndefined();
  });
});

describe("recoveryRatio", () => {
  it("matches the hand-computed worked example (15M / 10M = 1.5)", () => {
    expect(recoveryRatio(airport())).toBeCloseTo(1.5, 10);
  });
});

describe("paxPerRunway", () => {
  it("matches the hand-computed worked example (15M * 2 / 2 runways)", () => {
    expect(paxPerRunway(airport())).toBeCloseTo(15_000_000, 5);
  });

  it("returns undefined with zero active runways", () => {
    const closedOnly = airport({
      runways: [{ lengthFt: 10000, surface: "ASP", closed: true }]
    });
    expect(paxPerRunway(closedOnly)).toBeUndefined();
  });
});

describe("opsPerRunway", () => {
  it("divides daily ops by active runway count", () => {
    expect(opsPerRunway(100, airport())).toBe(50);
  });
});

describe("delaySignal", () => {
  it("maps NAS status levels to numeric signals", () => {
    const none: NasAirportStatus = { iata: "AAA", level: "none", reasons: [] };
    const delay: NasAirportStatus = { iata: "AAA", level: "delay", reasons: [] };
    const groundStop: NasAirportStatus = { iata: "AAA", level: "ground_stop", reasons: [] };
    expect(delaySignal(none)).toBe(0);
    expect(delaySignal(delay)).toBe(0.5);
    expect(delaySignal(groundStop)).toBe(1);
  });
});

function flight(overrides: Partial<OpenSkyFlight> = {}): OpenSkyFlight {
  return {
    icao24: "abc123",
    callsign: "TST123",
    firstSeen: 0,
    estDepartureAirport: "KAAA",
    lastSeen: 100,
    estArrivalAirport: "KBBB",
    estDepartureAirportHorizDistance: null,
    estDepartureAirportVertDistance: null,
    estArrivalAirportHorizDistance: null,
    estArrivalAirportVertDistance: null,
    departureAirportCandidatesCount: 0,
    arrivalAirportCandidatesCount: 0,
    ...overrides
  };
}

describe("summarizeFlightSample", () => {
  const origin = { latitude: 37.6213, longitude: -122.379 }; // SFO
  const nearby = { latitude: 34.0522, longitude: -118.2437 }; // LAX ~ short haul (~550 km)
  const far = { latitude: 35.5494, longitude: 139.7798 }; // HND (Tokyo) ~ long haul (~8,270 km)
  const airportByIcao = new Map([
    ["KLAX", nearby],
    ["RJTT", far]
  ]);

  it("returns zeros for an empty sample", () => {
    expect(summarizeFlightSample([], 3, origin, airportByIcao)).toEqual({
      dailyOps: 0,
      sampleSize: 0,
      unknownDestShare: 0,
      longHaulShare: 0
    });
  });

  it("computes ops/day, unknown share, and long-haul share", () => {
    const departures = [
      flight({ estArrivalAirport: "KLAX" }),
      flight({ estArrivalAirport: "RJTT" }),
      flight({ estArrivalAirport: null }),
      flight({ estArrivalAirport: "KZZZ" }) // unknown coordinates
    ];
    const stats = summarizeFlightSample(departures, 2, origin, airportByIcao);
    expect(stats.sampleSize).toBe(4);
    expect(stats.dailyOps).toBe(4); // (4 * 2) / 2
    expect(stats.unknownDestShare).toBeCloseTo(0.5, 10); // 2 of 4 unresolved
    expect(stats.longHaulShare).toBeCloseTo(0.25, 10); // 1 of 4 (HND)
  });
});
