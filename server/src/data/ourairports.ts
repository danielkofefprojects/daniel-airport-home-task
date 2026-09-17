import { parse } from "csv-parse/sync";
import { cachedFetch } from "./cache.js";
import type { DataEnvelope, RunwayInfo } from "../types.js";

const AIRPORTS_URL = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv";
const RUNWAYS_URL = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface OurAirportsRecord {
  icao: string;
  iata: string;
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  runways: RunwayInfo[];
}

interface RawAirportRow {
  icao_code: string;
  iata_code: string;
  name: string;
  municipality: string;
  iso_region: string;
  iso_country: string;
  latitude_deg: string;
  longitude_deg: string;
  type: string;
}

interface RawRunwayRow {
  airport_ident: string;
  length_ft: string;
  surface: string;
  closed: string;
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function parseAirportsCsv(csv: string): RawAirportRow[] {
  return parse(csv, { columns: true, skip_empty_lines: true }) as RawAirportRow[];
}

function parseRunwaysCsv(csv: string): RawRunwayRow[] {
  return parse(csv, { columns: true, skip_empty_lines: true }) as RawRunwayRow[];
}

/**
 * Fetches OurAirports airport + runway data (US airports with an IATA code and scheduled service)
 * and returns them keyed by IATA code, with runway info attached per airport.
 */
export async function fetchOurAirports(): Promise<DataEnvelope<Map<string, OurAirportsRecord>>> {
  const caveats: string[] = [];

  const airportsResult = await cachedFetch("ourairports-airports", 7 * ONE_DAY_MS, () => fetchCsv(AIRPORTS_URL));
  const runwaysResult = await cachedFetch("ourairports-runways", 7 * ONE_DAY_MS, () => fetchCsv(RUNWAYS_URL));

  if (airportsResult.stale) caveats.push("OurAirports airport data served from stale cache (fetch failed).");
  if (runwaysResult.stale) caveats.push("OurAirports runway data served from stale cache (fetch failed).");

  const airportRows = parseAirportsCsv(airportsResult.value);
  const runwayRows = parseRunwaysCsv(runwaysResult.value);

  const runwaysByIdent = new Map<string, RunwayInfo[]>();
  for (const row of runwayRows) {
    const list = runwaysByIdent.get(row.airport_ident) ?? [];
    list.push({
      lengthFt: Number(row.length_ft) || 0,
      surface: row.surface || "unknown",
      closed: row.closed === "1"
    });
    runwaysByIdent.set(row.airport_ident, list);
  }

  const byIata = new Map<string, OurAirportsRecord>();
  for (const row of airportRows) {
    if (row.iso_country !== "US") continue;
    if (!row.iata_code) continue;
    const icao = row.icao_code || row.iata_code;
    const runways = runwaysByIdent.get(icao) ?? runwaysByIdent.get(row.iata_code) ?? [];

    byIata.set(row.iata_code, {
      icao,
      iata: row.iata_code,
      name: row.name,
      city: row.municipality ?? "",
      state: (row.iso_region ?? "").replace("US-", ""),
      latitude: Number(row.latitude_deg),
      longitude: Number(row.longitude_deg),
      runways
    });
  }

  return {
    data: byIata,
    sources: [AIRPORTS_URL, RUNWAYS_URL],
    asOf: new Date().toISOString(),
    caveats
  };
}
