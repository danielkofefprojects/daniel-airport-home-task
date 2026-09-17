// NOTE: npm's `xlsx` (SheetJS) has known unpatched advisories (prototype pollution, ReDoS);
// SheetJS only ships fixed builds via their own CDN, not npm. Accepted here because this
// parses trusted, fixed-URL FAA files at seed time, never user-supplied input. See DESIGN.md.
import * as xlsx from "xlsx";
import { cachedFetch } from "./cache.js";
import type { DataEnvelope } from "../types.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface FaaYearFile {
  year: number;
  url: string;
  /** Column header prefix for the target year's enplanement column, e.g. "CY 24". */
  yearColumnPrefix: string;
}

/**
 * Each file's sheet carries the target year and the prior year's enplanements in one row,
 * so two files (latest + a base year) cover base-year through latest-year comparisons.
 */
export const FAA_ENPLANEMENT_FILES: FaaYearFile[] = [
  {
    year: 2024,
    url: "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/ARP-cy2024-all-enplanements.xlsx",
    yearColumnPrefix: "CY 24"
  },
  {
    year: 2019,
    url: "https://www.faa.gov/sites/faa.gov/files/airports/planning_capacity/passenger_allcargo_stats/passenger/cy19-all-enplanements.xlsx",
    yearColumnPrefix: "CY 19"
  }
];

export interface FaaEnplanementRecord {
  iata: string;
  state: string;
  hubSize: "L" | "M" | "S" | "N" | "nonhub";
  enplanementsByYear: Record<string, number>;
}

const HUB_CODES = new Set(["L", "M", "S", "N"]);

function normalizeHub(raw: unknown): "L" | "M" | "S" | "N" | "nonhub" {
  const value = String(raw ?? "").trim().toUpperCase();
  return HUB_CODES.has(value) ? (value as "L" | "M" | "S" | "N") : "nonhub";
}

async function fetchXlsxBuffer(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

function findColumnIndex(header: unknown[], prefix: string): number {
  return header.findIndex((cell) => typeof cell === "string" && cell.trim().startsWith(prefix));
}

/**
 * Fetches the FAA "all enplanements" workbooks for the configured years and returns
 * per-airport enplanement figures by year, plus state and hub-size classification.
 */
export async function fetchFaaEnplanements(): Promise<DataEnvelope<Map<string, FaaEnplanementRecord>>> {
  const caveats: string[] = [];
  const byIata = new Map<string, FaaEnplanementRecord>();
  const sources: string[] = [];

  for (const file of FAA_ENPLANEMENT_FILES) {
    const result = await cachedFetch(`faa-enplanements-${file.year}`, 30 * ONE_DAY_MS, () =>
      fetchXlsxBuffer(file.url)
    );
    if (result.stale) caveats.push(`FAA CY${file.year} enplanement data served from stale cache (fetch failed).`);
    sources.push(file.url);

    const buf = Buffer.from(result.value, "base64");
    const workbook = xlsx.read(buf, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      caveats.push(`FAA CY${file.year} workbook had no sheets; skipped.`);
      continue;
    }
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      caveats.push(`FAA CY${file.year} workbook missing sheet data; skipped.`);
      continue;
    }
    const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

    const header = rows[0] ?? [];
    const locidIdx = header.findIndex((c) => c === "Locid");
    const stateIdx = header.findIndex((c) => c === "ST");
    const hubIdx = header.findIndex((c) => c === "Hub");
    const yearColIdx = findColumnIndex(header, file.yearColumnPrefix);

    if (locidIdx === -1 || yearColIdx === -1) {
      caveats.push(`FAA CY${file.year} workbook column layout unrecognized; skipped.`);
      continue;
    }

    for (const row of rows.slice(1)) {
      const iata = row[locidIdx];
      if (typeof iata !== "string" || !iata) continue;
      const enplanements = Number(row[yearColIdx]);
      if (!Number.isFinite(enplanements)) continue;

      const existing = byIata.get(iata);
      const record: FaaEnplanementRecord = existing ?? {
        iata,
        state: typeof row[stateIdx] === "string" ? (row[stateIdx] as string) : "",
        hubSize: normalizeHub(row[hubIdx]),
        enplanementsByYear: {}
      };
      record.enplanementsByYear[String(file.year)] = enplanements;
      byIata.set(iata, record);
    }
  }

  return {
    data: byIata,
    sources,
    asOf: new Date().toISOString(),
    caveats
  };
}
