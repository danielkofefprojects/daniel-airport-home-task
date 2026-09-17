import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFaaEnplanements } from "../src/data/faaEnplanements.js";
import { fetchOurAirports } from "../src/data/ourairports.js";
import { fetchRecentDepartures } from "../src/data/opensky.js";
import { summarizeFlightSample } from "../src/scoring/kpis.js";
import type { AirportRecord, FlightSampleSummary, SeedData } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, "../data/seed");
const OPENSKY_SAMPLE_DAYS = 3;
const OPENSKY_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main(): Promise<void> {
  console.log("Fetching OurAirports metadata...");
  const airportsEnvelope = await fetchOurAirports();
  console.log(`  ${airportsEnvelope.data.size} US airports with IATA codes.`);
  if (airportsEnvelope.caveats.length) console.log("  Caveats:", airportsEnvelope.caveats);

  console.log("Fetching FAA enplanement data...");
  const enplanementsEnvelope = await fetchFaaEnplanements();
  console.log(`  ${enplanementsEnvelope.data.size} airports with enplanement data.`);
  if (enplanementsEnvelope.caveats.length) console.log("  Caveats:", enplanementsEnvelope.caveats);

  const airports: AirportRecord[] = [];
  for (const [iata, faa] of enplanementsEnvelope.data) {
    if (faa.hubSize !== "L" && faa.hubSize !== "M") continue;

    const meta = airportsEnvelope.data.get(iata);
    if (!meta) {
      console.warn(`  Skipping ${iata}: no OurAirports metadata found.`);
      continue;
    }

    const activeRunways = meta.runways.filter((r) => !r.closed);
    airports.push({
      iata,
      icao: meta.icao,
      name: meta.name,
      city: meta.city,
      state: faa.state || meta.state,
      latitude: meta.latitude,
      longitude: meta.longitude,
      hubSize: faa.hubSize,
      activeRunwayCount: activeRunways.length,
      runways: meta.runways,
      enplanements: faa.enplanementsByYear
    });
  }

  airports.sort((a, b) => a.iata.localeCompare(b.iata));

  console.log(`Fetching OpenSky flight samples for ${airports.length} peer airports (${OPENSKY_SAMPLE_DAYS} days each)...`);
  const flightStats: Record<string, FlightSampleSummary> = {};
  const openSkySources = new Set<string>();
  let openSkyFailures = 0;

  await mapWithConcurrency(airports, OPENSKY_CONCURRENCY, async (airport) => {
    try {
      const departuresEnvelope = await fetchRecentDepartures(airport.icao, OPENSKY_SAMPLE_DAYS);
      departuresEnvelope.sources.forEach((s) => openSkySources.add(s));
      if (departuresEnvelope.caveats.length) {
        console.warn(`  ${airport.iata}:`, departuresEnvelope.caveats.join(" "));
      }

      const airportByIcao = new Map(airports.map((a) => [a.icao, { latitude: a.latitude, longitude: a.longitude }]));
      const stats = summarizeFlightSample(
        departuresEnvelope.data,
        OPENSKY_SAMPLE_DAYS,
        { latitude: airport.latitude, longitude: airport.longitude },
        airportByIcao
      );
      flightStats[airport.iata] = { ...stats, days: OPENSKY_SAMPLE_DAYS, asOf: new Date().toISOString() };
    } catch (err) {
      openSkyFailures++;
      console.warn(`  ${airport.iata}: OpenSky fetch failed —`, err instanceof Error ? err.message : err);
    }
  });
  console.log(`  Got flight samples for ${Object.keys(flightStats).length}/${airports.length} airports (${openSkyFailures} failed).`);

  const seed: SeedData = {
    generatedAt: new Date().toISOString(),
    sources: [...airportsEnvelope.sources, ...enplanementsEnvelope.sources, ...openSkySources],
    airports,
    flightStats
  };

  await mkdir(SEED_DIR, { recursive: true });
  const outPath = path.join(SEED_DIR, "airports.json");
  await writeFile(outPath, JSON.stringify(seed, null, 2), "utf-8");

  console.log(`\nWrote ${airports.length} large/medium hub airports to ${outPath}`);
}

main().catch((err) => {
  console.error("Seed build failed:", err);
  process.exitCode = 1;
});
