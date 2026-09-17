import { describe, expect, it } from "vitest";
import { resolveQuery } from "../src/agent/tools/resolveAirports.js";
import type { AirportRecord } from "../src/types.js";

function airport(overrides: Partial<AirportRecord>): AirportRecord {
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
    runways: [],
    enplanements: {},
    ...overrides
  };
}

const airports: AirportRecord[] = [
  airport({ iata: "BOS", name: "Boston Logan International Airport", city: "Boston", state: "MA" }),
  airport({ iata: "BDL", name: "Bradley International Airport", city: "Windsor Locks", state: "CT" }),
  airport({ iata: "LAX", name: "Los Angeles International Airport", city: "Los Angeles", state: "CA" }),
  airport({ iata: "SNA", name: "John Wayne Orange County International Airport", city: "Santa Ana", state: "CA" }),
  airport({ iata: "ANC", name: "Ted Stevens Anchorage International Airport", city: "Anchorage", state: "AK" })
];

describe("resolveQuery", () => {
  it("resolves a bare IATA code", () => {
    const result = resolveQuery("LAX", airports);
    expect(result.resolvedAs).toBe("iata_code");
    expect(result.matches).toEqual([{ iata: "LAX", icao: "KAAA", name: "Los Angeles International Airport", state: "CA" }]);
  });

  it("resolves a city alias to one or more airports", () => {
    const result = resolveQuery("Santa Ana", airports);
    expect(result.resolvedAs).toBe("city_alias");
    expect(result.matches.map((m) => m.iata)).toEqual(["SNA"]);
  });

  it("resolves a region alias to every airport in the covered states", () => {
    const result = resolveQuery("New England", airports);
    expect(result.resolvedAs).toBe("region_alias");
    expect(result.matches.map((m) => m.iata).sort()).toEqual(["BDL", "BOS"]);
  });

  it("falls back to a case-insensitive name/city search", () => {
    const result = resolveQuery("logan", airports);
    expect(result.resolvedAs).toBe("name_search");
    expect(result.matches.map((m) => m.iata)).toEqual(["BOS"]);
  });

  it("returns no_match with an empty list when nothing matches", () => {
    const result = resolveQuery("Nowhereville", airports);
    expect(result.resolvedAs).toBe("no_match");
    expect(result.matches).toEqual([]);
  });
});
