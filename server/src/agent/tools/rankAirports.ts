import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { loadAirports } from "../../data/airportRepository.js";
import type { AirportRecord } from "../../types.js";
import { computeMetricsForPeerSet, type AirportMetrics } from "./airportMetrics.js";
import { buildMetricsContext } from "./buildMetricsContext.js";

const METRICS = ["opportunity", "congestion", "demand", "unmet_demand"] as const;
type Metric = (typeof METRICS)[number];

function scoreFor(metrics: AirportMetrics, metric: Metric): number {
  switch (metric) {
    case "opportunity":
      return metrics.opportunityScore;
    case "congestion":
      return metrics.congestionScore;
    case "demand":
      return metrics.demandScore;
    case "unmet_demand":
      return metrics.unmetDemandIndex;
  }
}

function driversFor(metrics: AirportMetrics, metric: Metric) {
  const drivers = metric === "unmet_demand" ? metrics.unmetDemandDrivers : metrics.opportunityDrivers;
  return drivers.slice(0, 2);
}

export interface RankedAirport {
  iata: string;
  name: string;
  state: string;
  score: number;
  tier: string;
  topDrivers: { name: string; contribution: number }[];
  confidence: string;
}

export interface RankAirportsResult {
  metric: Metric;
  filter: { states?: string[]; iatas?: string[] };
  ranked: RankedAirport[];
}

function summarize(result: RankAirportsResult): string {
  if (result.ranked.length === 0) {
    return `No airports matched the filter for the "${result.metric}" ranking.`;
  }
  const lines = result.ranked
    .map((r, i) => `${i + 1}. ${r.iata} (${r.name}, ${r.state}) — score ${r.score.toFixed(1)}, ${r.tier}`)
    .join("\n");
  return `Ranked ${result.ranked.length} airport(s) by ${result.metric}:\n${lines}`;
}

export const rankAirportsTool = tool(
  async ({ states, iatas, metric, limit }: { states?: string[]; iatas?: string[]; metric: Metric; limit?: number }) => {
    const airportsEnvelope = await loadAirports();
    const peerSet = airportsEnvelope.data;

    const { context, sources, caveats: contextCaveats } = await buildMetricsContext(
      airportsEnvelope.caveats.length > 0
    );
    const metricsById = computeMetricsForPeerSet(peerSet, context);

    let candidates: AirportRecord[] = peerSet;
    if (iatas && iatas.length > 0) {
      const wanted = new Set(iatas.map((i) => i.toUpperCase()));
      candidates = peerSet.filter((a) => wanted.has(a.iata));
    } else if (states && states.length > 0) {
      const wanted = new Set(states.map((s) => s.toUpperCase()));
      candidates = peerSet.filter((a) => wanted.has(a.state));
    }

    const effectiveLimit = limit ?? 10;
    const ranked: RankedAirport[] = candidates
      .map((airport) => metricsById.get(airport.iata))
      .filter((m): m is AirportMetrics => m !== undefined)
      .sort((a, b) => scoreFor(b, metric) - scoreFor(a, metric))
      .slice(0, effectiveLimit)
      .map((m) => ({
        iata: m.iata,
        name: m.name,
        state: m.state,
        score: scoreFor(m, metric),
        tier: m.tier,
        topDrivers: driversFor(m, metric),
        confidence: m.confidence
      }));

    const result: RankAirportsResult = {
      metric,
      filter: { states, iatas },
      ranked
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
    name: "rank_airports",
    description:
      "Rank US large/medium hub airports by opportunity, congestion, demand, or unmet-demand score, " +
      "optionally filtered to specific states or IATA codes. Percentiles are computed against the full " +
      "national peer set even when filtered, so a regional query does not inflate weak airports.",
    schema: z.object({
      states: z.array(z.string().length(2)).optional().describe("Two-letter US state codes to filter to, e.g. ['MA','CT']"),
      iatas: z.array(z.string().length(3)).optional().describe("IATA codes to filter to"),
      metric: z.enum(METRICS).describe("Which composite score to rank by"),
      limit: z.number().int().min(1).max(30).optional().describe("Max airports to return (default 10)")
    }),
    responseFormat: "content_and_artifact"
  }
);
