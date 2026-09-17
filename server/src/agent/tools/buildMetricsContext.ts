import { loadPeerFlightStats } from "../../data/airportRepository.js";
import { fetchNasStatus } from "../../data/nasStatus.js";
import type { MetricsContext } from "./airportMetrics.js";

export interface MetricsContextResult {
  context: MetricsContext;
  sources: string[];
  caveats: string[];
}

/** Assembles the shared context (NAS status + peer-set OpenSky stats) needed to score the national peer set. */
export async function buildMetricsContext(usedStaleAirportData: boolean): Promise<MetricsContextResult> {
  const [nasEnvelope, flightStatsEnvelope] = await Promise.all([fetchNasStatus(), loadPeerFlightStats()]);

  const flightStatsByIata = new Map(Object.entries(flightStatsEnvelope.data));

  return {
    context: {
      nasStatus: nasEnvelope.data,
      currentYear: new Date().getUTCFullYear(),
      usedStaleFallback: usedStaleAirportData,
      flightStatsByIata
    },
    sources: [...nasEnvelope.sources, ...flightStatsEnvelope.sources],
    caveats: [...nasEnvelope.caveats, ...flightStatsEnvelope.caveats]
  };
}
