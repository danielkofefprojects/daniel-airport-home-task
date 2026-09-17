import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { loadAirports } from "../../data/airportRepository.js";
import { computeMetricsForPeerSet, type AirportMetrics } from "./airportMetrics.js";
import { buildMetricsContext } from "./buildMetricsContext.js";

export interface CompareAirportsResult {
  airports: AirportMetrics[];
  mostCongested: { iata: string; marginPoints: number } | undefined;
}

function summarize(result: CompareAirportsResult): string {
  if (result.airports.length === 0) return "None of the requested airports were found in the peer set.";
  const rows = result.airports
    .map(
      (a) =>
        `${a.iata} (${a.name}): congestion ${a.congestionScore.toFixed(1)}, demand ${a.demandScore.toFixed(1)}, ` +
        `opportunity ${a.opportunityScore.toFixed(1)} (${a.tier}), paxPerRunway ${
          a.paxPerRunway ? Math.round(a.paxPerRunway).toLocaleString() : "n/a"
        }, confidence ${a.confidence}`
    )
    .join("\n");
  const margin = result.mostCongested
    ? `\n${result.mostCongested.iata} is the most congested, by ${result.mostCongested.marginPoints.toFixed(1)} congestion points over the next closest.`
    : "";
  return `Comparing ${result.airports.length} airport(s):\n${rows}${margin}`;
}

export const compareAirportsTool = tool(
  async ({ iatas }: { iatas: string[] }) => {
    const airportsEnvelope = await loadAirports();
    const peerSet = airportsEnvelope.data;

    const { context, sources, caveats: contextCaveats } = await buildMetricsContext(
      airportsEnvelope.caveats.length > 0
    );
    const metricsById = computeMetricsForPeerSet(peerSet, context);

    const wanted = iatas.map((i) => i.toUpperCase());
    const airports = wanted
      .map((iata) => metricsById.get(iata))
      .filter((m): m is AirportMetrics => m !== undefined);

    const sortedByCongestion = [...airports].sort((a, b) => b.congestionScore - a.congestionScore);
    const mostCongested =
      sortedByCongestion.length >= 2 && sortedByCongestion[0] && sortedByCongestion[1]
        ? {
            iata: sortedByCongestion[0].iata,
            marginPoints: sortedByCongestion[0].congestionScore - sortedByCongestion[1].congestionScore
          }
        : undefined;

    const result: CompareAirportsResult = { airports, mostCongested };

    const content = summarize(result);
    const artifact = {
      data: result,
      sources: [...airportsEnvelope.sources, ...sources],
      asOf: airportsEnvelope.asOf,
      caveats: [
        ...airportsEnvelope.caveats,
        ...contextCaveats,
        ...(wanted.length !== airports.length ? ["Some requested IATA codes were not found in the peer set."] : [])
      ]
    };
    return [content, artifact] as const;
  },
  {
    name: "compare_airports",
    description:
      "Side-by-side comparison of 2-4 airports' KPIs and composite scores (demand, congestion, opportunity), " +
      "including which is most congested and by how much.",
    schema: z.object({
      iatas: z.array(z.string().length(3)).min(2).max(4).describe("2-4 IATA codes to compare")
    }),
    responseFormat: "content_and_artifact"
  }
);
