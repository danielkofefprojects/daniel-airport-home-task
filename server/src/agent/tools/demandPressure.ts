import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { findByIata, loadAirports } from "../../data/airportRepository.js";
import { statusForAirport } from "../../data/nasStatus.js";
import { computeMetricsForPeerSet } from "./airportMetrics.js";
import { buildMetricsContext } from "./buildMetricsContext.js";

export interface DemandPressureResult {
  iata: string;
  unmetDemandIndex: number;
  demandScore: number;
  congestionScore: number;
  drivers: { name: string; contribution: number }[];
  nasStatus: { level: string; reasons: string[] };
  confidence: string;
  confidenceReasons: string[];
}

function summarize(result: DemandPressureResult): string {
  const topDriver = result.drivers[0];
  const driverNote = topDriver
    ? ` Most of the index comes from ${topDriver.name} (contribution ${topDriver.contribution.toFixed(1)}).`
    : "";
  return (
    `${result.iata} unmet demand index: ${result.unmetDemandIndex.toFixed(1)} ` +
    `(demand ${result.demandScore.toFixed(1)}, congestion ${result.congestionScore.toFixed(1)}). ` +
    `NAS status: ${result.nasStatus.level}.${driverNote} Confidence: ${result.confidence}.`
  );
}

export const demandPressureTool = tool(
  async ({ iata }: { iata: string }) => {
    const airportsEnvelope = await loadAirports();
    const airport = findByIata(airportsEnvelope.data, iata);

    if (!airport) {
      const content = `Unknown airport code "${iata}". Use resolve_airports first to find a valid IATA code.`;
      return [content, { data: null, sources: [], asOf: new Date().toISOString(), caveats: [content] }] as const;
    }

    const { context, sources, caveats: contextCaveats } = await buildMetricsContext(
      airportsEnvelope.caveats.length > 0
    );
    const metricsById = computeMetricsForPeerSet(airportsEnvelope.data, context);
    const metrics = metricsById.get(airport.iata);

    if (!metrics) {
      const content = `Metrics unavailable for "${airport.iata}".`;
      return [content, { data: null, sources, caveats: [...contextCaveats, content], asOf: airportsEnvelope.asOf }] as const;
    }

    const nasAirportStatus = statusForAirport(context.nasStatus, airport.iata);

    const result: DemandPressureResult = {
      iata: airport.iata,
      unmetDemandIndex: metrics.unmetDemandIndex,
      demandScore: metrics.demandScore,
      congestionScore: metrics.congestionScore,
      drivers: metrics.unmetDemandDrivers,
      nasStatus: { level: nasAirportStatus.level, reasons: nasAirportStatus.reasons },
      confidence: metrics.confidence,
      confidenceReasons: metrics.confidenceReasons
    };

    const content = summarize(result);
    const artifact = {
      data: result,
      sources: [...airportsEnvelope.sources, ...sources],
      asOf: airportsEnvelope.asOf,
      caveats: [...airportsEnvelope.caveats, ...contextCaveats]
    };
    return [content, artifact] as const;
  },
  {
    name: "demand_pressure",
    description:
      "Computes the unmet flight demand index for one airport (how much capacity pressure combines with " +
      "unmet growth demand), a driver breakdown explaining why, and the current FAA NAS delay status.",
    schema: z.object({
      iata: z.string().length(3).describe("IATA code of the airport")
    }),
    responseFormat: "content_and_artifact"
  }
);
