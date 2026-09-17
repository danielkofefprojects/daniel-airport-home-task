import { describe, expect, it } from "vitest";
import { classifyHaul, haversineDistanceKm, kmToMiles } from "../src/scoring/geo.js";
import { LONG_HAUL_KM, SHORT_HAUL_KM } from "../src/config/scoring.js";

describe("haversineDistanceKm", () => {
  it("computes SFO-JFK distance to within 1%", () => {
    const sfo = { latitude: 37.6213, longitude: -122.379 };
    const jfk = { latitude: 40.6413, longitude: -73.7781 };
    const distance = haversineDistanceKm(sfo, jfk);
    expect(distance).toBeGreaterThan(4150 * 0.99);
    expect(distance).toBeLessThan(4150 * 1.01);
  });

  it("returns 0 for identical coordinates", () => {
    const point = { latitude: 51.5, longitude: -0.12 };
    expect(haversineDistanceKm(point, point)).toBeCloseTo(0, 6);
  });
});

describe("kmToMiles", () => {
  it("converts km to miles", () => {
    expect(kmToMiles(1.609344)).toBeCloseTo(1, 6);
  });
});

describe("classifyHaul", () => {
  it("classifies distances just below the short/medium boundary as short", () => {
    expect(classifyHaul(SHORT_HAUL_KM - 1)).toBe("short");
  });

  it("classifies distances at the short/medium boundary as medium", () => {
    expect(classifyHaul(SHORT_HAUL_KM)).toBe("medium");
  });

  it("classifies distances just below the medium/long boundary as medium", () => {
    expect(classifyHaul(LONG_HAUL_KM - 1)).toBe("medium");
  });

  it("classifies distances at the long-haul boundary as long", () => {
    expect(classifyHaul(LONG_HAUL_KM)).toBe("long");
  });
});
