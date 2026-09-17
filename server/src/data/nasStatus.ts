import { XMLParser } from "fast-xml-parser";
import { cachedFetch } from "./cache.js";
import type { DataEnvelope, NasAirportStatus, NasStatusSnapshot } from "../types.js";

const NAS_STATUS_URL = "https://nasstatus.faa.gov/api/airport-status-information";
const TEN_MINUTES_MS = 10 * 60 * 1000;

async function fetchXml(): Promise<string> {
  const res = await fetch(NAS_STATUS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${NAS_STATUS_URL}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

interface ParsedNas {
  AIRPORT_STATUS_INFORMATION?: {
    Update_Time?: string;
    Delay_type?:
      | {
          Name?: string;
          Ground_Stop_List?: { Program?: unknown | unknown[] };
          Ground_Delay_List?: { Ground_Delay?: unknown | unknown[] };
          Arrival_Departure_Delay_List?: { Delay?: unknown | unknown[] };
        }
      | Array<{
          Name?: string;
          Ground_Stop_List?: { Program?: unknown | unknown[] };
          Ground_Delay_List?: { Ground_Delay?: unknown | unknown[] };
          Arrival_Departure_Delay_List?: { Delay?: unknown | unknown[] };
        }>;
  };
}

function parseNasXml(xml: string): NasStatusSnapshot {
  const parser = new XMLParser();
  const parsed = parser.parse(xml) as ParsedNas;
  const root = parsed.AIRPORT_STATUS_INFORMATION;

  const groundStops: string[] = [];
  const groundDelays: string[] = [];
  const generalDelays: string[] = [];

  for (const delayType of toArray(root?.Delay_type)) {
    for (const program of toArray(delayType.Ground_Stop_List?.Program) as Array<{ ARPT?: string }>) {
      if (program.ARPT) groundStops.push(program.ARPT);
    }
    for (const delay of toArray(delayType.Ground_Delay_List?.Ground_Delay) as Array<{ ARPT?: string }>) {
      if (delay.ARPT) groundDelays.push(delay.ARPT);
    }
    for (const delay of toArray(delayType.Arrival_Departure_Delay_List?.Delay) as Array<{ ARPT?: string }>) {
      if (delay.ARPT) generalDelays.push(delay.ARPT);
    }
  }

  return {
    updateTime: root?.Update_Time ?? new Date().toISOString(),
    groundStops,
    groundDelays,
    generalDelays
  };
}

export async function fetchNasStatus(): Promise<DataEnvelope<NasStatusSnapshot>> {
  const caveats: string[] = [];
  const result = await cachedFetch("nas-status", TEN_MINUTES_MS, fetchXml);
  if (result.stale) caveats.push("FAA NAS status served from stale cache (fetch failed).");
  caveats.push("FAA NAS status is a live snapshot, not a historical delay rate.");

  return {
    data: parseNasXml(result.value),
    sources: [NAS_STATUS_URL],
    asOf: new Date().toISOString(),
    caveats
  };
}

export function statusForAirport(snapshot: NasStatusSnapshot, iata: string): NasAirportStatus {
  if (snapshot.groundStops.includes(iata)) {
    return { iata, level: "ground_stop", reasons: ["Ground stop in effect"] };
  }
  if (snapshot.groundDelays.includes(iata) || snapshot.generalDelays.includes(iata)) {
    return { iata, level: "delay", reasons: ["Delays reported"] };
  }
  return { iata, level: "none", reasons: [] };
}
