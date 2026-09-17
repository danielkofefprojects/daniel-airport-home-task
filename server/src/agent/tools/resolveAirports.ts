import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { CITY_ALIASES, REGION_ALIASES } from "../../data/aliases.js";
import { loadAirports } from "../../data/airportRepository.js";
import type { AirportRecord } from "../../types.js";

export interface ResolvedAirport {
  iata: string;
  icao: string;
  name: string;
  state: string;
}

export interface ResolveAirportsResult {
  query: string;
  matches: ResolvedAirport[];
  resolvedAs: "iata_code" | "city_alias" | "region_alias" | "name_search" | "no_match";
}

function toResolved(airport: AirportRecord): ResolvedAirport {
  return { iata: airport.iata, icao: airport.icao, name: airport.name, state: airport.state };
}

/** Resolves a free-text place/airport query against the national airport set using aliases and name search. */
export function resolveQuery(query: string, airports: AirportRecord[]): ResolveAirportsResult {
  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();

  if (/^[a-zA-Z]{3}$/.test(trimmed)) {
    const byCode = airports.find((a) => a.iata === trimmed.toUpperCase());
    if (byCode) {
      return { query, matches: [toResolved(byCode)], resolvedAs: "iata_code" };
    }
  }

  const cityMatch = CITY_ALIASES[normalized];
  if (cityMatch) {
    const matches = cityMatch
      .map((iata) => airports.find((a) => a.iata === iata))
      .filter((a): a is AirportRecord => a !== undefined)
      .map(toResolved);
    return { query, matches, resolvedAs: "city_alias" };
  }

  const regionStates = REGION_ALIASES[normalized];
  if (regionStates) {
    const matches = airports
      .filter((a) => regionStates.includes(a.state))
      .map(toResolved)
      .sort((a, b) => a.iata.localeCompare(b.iata));
    return { query, matches, resolvedAs: "region_alias" };
  }

  const byName = airports
    .filter(
      (a) =>
        a.name.toLowerCase().includes(normalized) ||
        a.city.toLowerCase().includes(normalized)
    )
    .map(toResolved);
  if (byName.length > 0) {
    return { query, matches: byName, resolvedAs: "name_search" };
  }

  return { query, matches: [], resolvedAs: "no_match" };
}

function summarize(result: ResolveAirportsResult): string {
  if (result.matches.length === 0) {
    return `No airports matched "${result.query}". Try an IATA code, a major city, or a US region (e.g. "New England").`;
  }
  const list = result.matches.map((m) => `${m.iata} (${m.name}, ${m.state})`).join("; ");
  return `Resolved "${result.query}" via ${result.resolvedAs} to ${result.matches.length} airport(s): ${list}`;
}

export const resolveAirportsTool = tool(
  async ({ query }: { query: string }) => {
    const airportsEnvelope = await loadAirports();
    const result = resolveQuery(query, airportsEnvelope.data);
    const content = summarize(result);
    const artifact = {
      data: result,
      sources: airportsEnvelope.sources,
      asOf: airportsEnvelope.asOf,
      caveats: airportsEnvelope.caveats
    };
    return [content, artifact] as const;
  },
  {
    name: "resolve_airports",
    description:
      "Resolve a free-text place or airport reference (IATA code, city, or US region like 'New England') " +
      "to one or more specific airports with IATA/ICAO codes. Use this first whenever a question names a " +
      "place rather than an explicit airport code.",
    schema: z.object({
      query: z.string().describe("The place, city, or airport reference to resolve, e.g. 'LA', 'Santa Ana', 'New England'")
    }),
    responseFormat: "content_and_artifact"
  }
);
