import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { findByIata, loadAirports } from "../../data/airportRepository.js";
import { fetchRecentDepartures } from "../../data/opensky.js";
import { classifyHaul, haversineDistanceKm, type HaulBand } from "../../scoring/geo.js";
import type { AirportRecord, OpenSkyFlight } from "../../types.js";

/** Cargo carriers' typical ICAO callsign prefixes. Heuristic only — not a definitive cargo/passenger split. */
const CARGO_CALLSIGN_PREFIXES = ["FDX", "UPS", "GTI", "ABX", "CLX", "GEC", "ATN", "CKS", "PAC"];

function isCargoCallsign(callsign: string | null): boolean {
  if (!callsign) return false;
  const trimmed = callsign.trim().toUpperCase();
  return CARGO_CALLSIGN_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

interface HaulCounts {
  short: number;
  medium: number;
  long: number;
  unknown: number;
}

function emptyCounts(): HaulCounts {
  return { short: 0, medium: 0, long: 0, unknown: 0 };
}

function toShare(counts: HaulCounts, total: number): Record<HaulBand | "unknown", number> {
  if (total === 0) return { short: 0, medium: 0, long: 0, unknown: 0 };
  return {
    short: counts.short / total,
    medium: counts.medium / total,
    long: counts.long / total,
    unknown: counts.unknown / total
  };
}

export interface FlightMixResult {
  iata: string;
  days: number;
  sampleSize: number;
  haulCounts: HaulCounts;
  haulShare: Record<HaulBand | "unknown", number>;
  haulShareExcludingCargo: Record<HaulBand | "unknown", number>;
  cargoShare: number;
  topDestinations: { icao: string; count: number }[];
  isKnownCargoHub: boolean;
}

function summarize(result: FlightMixResult): string {
  const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;
  const base =
    `Flight mix for ${result.iata} over ${result.days} day(s), ${result.sampleSize} sampled departures: ` +
    `short ${pct(result.haulShare.short)}, medium ${pct(result.haulShare.medium)}, long ${pct(result.haulShare.long)} ` +
    `(unknown destination ${pct(result.haulShare.unknown)}). Cargo share (callsign heuristic): ${pct(result.cargoShare)}.`;
  const cargoNote = result.isKnownCargoHub
    ? ` ${result.iata} is a major cargo hub, so excluding likely cargo flights, long-haul share is ${pct(
        result.haulShareExcludingCargo.long
      )}.`
    : "";
  const top = result.topDestinations.length
    ? ` Top destinations: ${result.topDestinations.map((d) => `${d.icao} (${d.count})`).join(", ")}.`
    : "";
  return base + cargoNote + top;
}

export const flightMixTool = tool(
  async ({ iata, days }: { iata: string; days?: number }) => {
    const sampleDays = days ?? 3;
    const airportsEnvelope = await loadAirports();
    const airport = findByIata(airportsEnvelope.data, iata);

    if (!airport) {
      const content = `Unknown airport code "${iata}". Use resolve_airports first to find a valid IATA code.`;
      return [content, { data: null, sources: [], asOf: new Date().toISOString(), caveats: [content] }] as const;
    }

    const departuresEnvelope = await fetchRecentDepartures(airport.icao, sampleDays);
    const airportByIcao = new Map(
      airportsEnvelope.data.map((a: AirportRecord) => [a.icao, { latitude: a.latitude, longitude: a.longitude }])
    );

    const counts = emptyCounts();
    const countsExcludingCargo = emptyCounts();
    let cargoCount = 0;
    const destCounts = new Map<string, number>();

    for (const flight of departuresEnvelope.data as OpenSkyFlight[]) {
      const cargo = isCargoCallsign(flight.callsign);
      if (cargo) cargoCount++;

      const arrivalCoords = flight.estArrivalAirport ? airportByIcao.get(flight.estArrivalAirport) : undefined;
      if (flight.estArrivalAirport) {
        destCounts.set(flight.estArrivalAirport, (destCounts.get(flight.estArrivalAirport) ?? 0) + 1);
      }

      const band: HaulBand | "unknown" = arrivalCoords
        ? classifyHaul(
            haversineDistanceKm(
              { latitude: airport.latitude, longitude: airport.longitude },
              arrivalCoords
            )
          )
        : "unknown";

      counts[band]++;
      if (!cargo) countsExcludingCargo[band]++;
    }

    const sampleSize = departuresEnvelope.data.length;
    const nonCargoTotal = sampleSize - cargoCount;
    const topDestinations = [...destCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([icao, count]) => ({ icao, count }));

    const result: FlightMixResult = {
      iata: airport.iata,
      days: sampleDays,
      sampleSize,
      haulCounts: counts,
      haulShare: toShare(counts, sampleSize),
      haulShareExcludingCargo: toShare(countsExcludingCargo, nonCargoTotal),
      cargoShare: sampleSize > 0 ? cargoCount / sampleSize : 0,
      topDestinations,
      isKnownCargoHub: airport.iata === "ANC" || airport.iata === "MEM" || airport.iata === "SDF"
    };

    const content = summarize(result);
    const artifact = {
      data: result,
      sources: [...airportsEnvelope.sources, ...departuresEnvelope.sources],
      asOf: departuresEnvelope.asOf,
      caveats: [
        ...airportsEnvelope.caveats,
        ...departuresEnvelope.caveats,
        "Cargo-vs-passenger split is a heuristic based on callsign prefixes, not confirmed operation type.",
        ...(sampleSize === 0 ? ["No OpenSky departures found for this window."] : [])
      ]
    };
    return [content, artifact] as const;
  },
  {
    name: "flight_mix",
    description:
      "Recent departure mix for one airport: counts and share of short/medium/long-haul flights, top " +
      "destinations, sample size, unknown-destination share, and a cargo-vs-passenger split heuristic. " +
      "For Anchorage and other cargo hubs, also reports the mix excluding likely cargo flights.",
    schema: z.object({
      iata: z.string().length(3).describe("IATA code of the airport"),
      days: z.number().int().min(1).max(7).optional().describe("Days of recent departures to sample (default 3)")
    }),
    responseFormat: "content_and_artifact"
  }
);
