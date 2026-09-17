import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFaaEnplanements } from "./faaEnplanements.js";
import { fetchOurAirports } from "./ourairports.js";
import type { AirportRecord, DataEnvelope, FlightSampleSummary, SeedData } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, "../../data/seed/airports.json");

let seedCache: SeedData | undefined;

async function loadSeed(): Promise<SeedData> {
  if (seedCache) return seedCache;
  const raw = await readFile(SEED_PATH, "utf-8");
  seedCache = JSON.parse(raw) as SeedData;
  return seedCache;
}

function fromSeed(seed: SeedData, caveats: string[]): DataEnvelope<AirportRecord[]> {
  return {
    data: seed.airports,
    sources: seed.sources,
    asOf: seed.generatedAt,
    caveats
  };
}

/**
 * Loads the national peer set of US large + medium hub airports: live OurAirports + FAA data by
 * default, or the bundled seed when `USE_SEED_ONLY=true` or a live fetch fails.
 */
export async function loadAirports(): Promise<DataEnvelope<AirportRecord[]>> {
  const seed = await loadSeed();

  if (process.env["USE_SEED_ONLY"] === "true") {
    return fromSeed(seed, ["Using bundled seed data (USE_SEED_ONLY=true)."]);
  }

  try {
    const [airportsEnvelope, enplanementsEnvelope] = await Promise.all([
      fetchOurAirports(),
      fetchFaaEnplanements()
    ]);

    const caveats = [...airportsEnvelope.caveats, ...enplanementsEnvelope.caveats];
    const airports: AirportRecord[] = [];

    for (const [iata, faa] of enplanementsEnvelope.data) {
      if (faa.hubSize !== "L" && faa.hubSize !== "M") continue;
      const meta = airportsEnvelope.data.get(iata);
      if (!meta) continue;

      airports.push({
        iata,
        icao: meta.icao,
        name: meta.name,
        city: meta.city,
        state: faa.state || meta.state,
        latitude: meta.latitude,
        longitude: meta.longitude,
        hubSize: faa.hubSize,
        activeRunwayCount: meta.runways.filter((r) => !r.closed).length,
        runways: meta.runways,
        enplanements: faa.enplanementsByYear
      });
    }

    if (airports.length === 0) {
      throw new Error("Live airport data resolved to zero large/medium hub airports.");
    }

    return {
      data: airports,
      sources: [...airportsEnvelope.sources, ...enplanementsEnvelope.sources],
      asOf: new Date().toISOString(),
      caveats
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fromSeed(seed, [`Live airport data unavailable, using bundled seed: ${message}`]);
  }
}

export function findByIata(airports: AirportRecord[], iata: string): AirportRecord | undefined {
  const upper = iata.toUpperCase();
  return airports.find((a) => a.iata === upper);
}

/**
 * Peer-set OpenSky flight sample stats (ops/runway percentile inputs) for every national peer airport,
 * precomputed at seed time by `scripts/build-seed.ts`. Fetching this live for all ~60 peer airports on
 * every request would be slow and risks OpenSky's rate limit, so ranking/comparison tools use this
 * snapshot; a caveat is added noting its vintage.
 */
export async function loadPeerFlightStats(): Promise<DataEnvelope<Record<string, FlightSampleSummary>>> {
  const seed = await loadSeed();
  const hasSamples = Object.keys(seed.flightStats).length > 0;
  return {
    data: seed.flightStats,
    sources: ["OpenSky Network (seed snapshot)"],
    asOf: seed.generatedAt,
    caveats: hasSamples
      ? [`Ops/runway percentiles use an OpenSky sample captured at seed time (${seed.generatedAt}).`]
      : ["No OpenSky sample data in seed; ops/runway percentiles are unavailable for ranking."]
  };
}
