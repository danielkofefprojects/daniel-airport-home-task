import { fetchRecentDepartures } from "../src/data/opensky.js";

const ICAO = process.argv[2] ?? "PANC";

async function main(): Promise<void> {
  const result = await fetchRecentDepartures(ICAO, 1);
  console.log(`Departures for ${ICAO}: ${result.data.length} flights`);
  console.log("caveats:", result.caveats);
  console.log("sources:", result.sources);
}

main().catch((err) => {
  console.error(`OpenSky check failed for ${ICAO}:`, err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
