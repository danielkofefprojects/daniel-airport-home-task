import { Component, computed, input, signal } from '@angular/core';
import { EvidenceItem } from '../models';

interface EvidenceRow {
  label: string;
  score?: number;
  tier?: string;
  confidence?: string;
  drivers: { name: string; contribution: number }[];
  fields: { key: string; value: string }[];
}

interface EvidenceView {
  tool: string;
  sources: string[];
  asOf: string;
  caveats: string[];
  rows: EvidenceRow[];
}

const SCORE_KEYS = ['score', 'opportunityScore', 'congestionScore', 'demandScore', 'unmetDemandIndex'];
const DRIVER_KEYS = ['topDrivers', 'opportunityDrivers', 'unmetDemandDrivers'];
const SKIP_KEYS = new Set([
  'iata',
  'name',
  'state',
  'tier',
  'confidence',
  'confidenceReasons',
  ...DRIVER_KEYS
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDriverArray(value: unknown): value is { name: string; contribution: number }[] {
  return (
    Array.isArray(value) &&
    value.every((v) => isPlainObject(v) && typeof v['name'] === 'string' && typeof v['contribution'] === 'number')
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  return JSON.stringify(value);
}

function rowFromRecord(record: Record<string, unknown>): EvidenceRow {
  const label = [record['iata'], record['name']].filter(Boolean).join(' — ') || 'Result';
  const scoreKey = SCORE_KEYS.find((k) => typeof record[k] === 'number');
  const driverKey = DRIVER_KEYS.find((k) => isDriverArray(record[k]));
  const fields = Object.entries(record)
    .filter(([key, value]) => !SKIP_KEYS.has(key) && key !== scoreKey && value !== undefined && !isPlainObject(value))
    .map(([key, value]) => ({ key, value: formatValue(value) }));

  return {
    label,
    score: scoreKey ? (record[scoreKey] as number) : undefined,
    tier: typeof record['tier'] === 'string' ? (record['tier'] as string) : undefined,
    confidence: typeof record['confidence'] === 'string' ? (record['confidence'] as string) : undefined,
    drivers: driverKey ? (record[driverKey] as { name: string; contribution: number }[]) : [],
    fields
  };
}

/** Best-effort extraction of airport-like rows from a tool's `data`, whatever its exact shape. */
function extractRows(data: unknown): EvidenceRow[] {
  if (Array.isArray(data)) {
    return data.filter(isPlainObject).map(rowFromRecord);
  }
  if (!isPlainObject(data)) return [];

  if (Array.isArray(data['ranked'])) return (data['ranked'] as unknown[]).filter(isPlainObject).map(rowFromRecord);
  if (Array.isArray(data['airports'])) return (data['airports'] as unknown[]).filter(isPlainObject).map(rowFromRecord);
  if (Array.isArray(data['results'])) return (data['results'] as unknown[]).filter(isPlainObject).map(rowFromRecord);

  const looksLikeRow = 'iata' in data || 'score' in data || 'opportunityScore' in data || 'tier' in data;
  if (looksLikeRow) return [rowFromRecord(data)];

  return [];
}

@Component({
  selector: 'app-evidence',
  standalone: true,
  templateUrl: './evidence.component.html',
  styleUrl: './evidence.component.css'
})
export class EvidenceComponent {
  readonly evidence = input.required<EvidenceItem[]>();
  readonly expanded = signal(false);

  readonly views = computed<EvidenceView[]>(() =>
    this.evidence().map((item) => ({
      tool: item.tool,
      sources: item.artifact.sources,
      asOf: item.artifact.asOf,
      caveats: item.artifact.caveats,
      rows: extractRows(item.artifact.data)
    }))
  );

  toggle(): void {
    this.expanded.set(!this.expanded());
  }
}
