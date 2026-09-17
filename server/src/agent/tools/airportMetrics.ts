import { statusForAirport } from "../../data/nasStatus.js";
import type { ConfidenceLevel } from "../../scoring/confidence.js";
import { computeConfidence } from "../../scoring/confidence.js";
import {
  activeRunwayCount,
  delaySignal,
  growthCagr,
  latestEnplanements,
  opsPerRunway,
  paxPerRunway,
  recoveryRatio
} from "../../scoring/kpis.js";
import { percentileRankAll } from "../../scoring/normalize.js";
import {
  congestionScore,
  demandScore,
  driverBreakdown,
  opportunityScore,
  tierFor,
  unmetDemandIndex,
  type ScoreDriver,
  type Tier
} from "../../scoring/scores.js";
import type { AirportRecord, NasStatusSnapshot } from "../../types.js";

export interface AirportMetrics {
  iata: string;
  name: string;
  state: string;
  enplanements: number | undefined;
  growthCagr: number | undefined;
  recoveryRatio: number | undefined;
  paxPerRunway: number | undefined;
  activeRunwayCount: number;
  demandScore: number;
  congestionScore: number;
  opportunityScore: number;
  unmetDemandIndex: number;
  tier: Tier;
  opportunityDrivers: ScoreDriver[];
  unmetDemandDrivers: ScoreDriver[];
  confidence: ConfidenceLevel;
  confidenceReasons: string[];
}

export interface MetricsContext {
  nasStatus: NasStatusSnapshot;
  currentYear: number;
  usedStaleFallback: boolean;
  /** Per-airport OpenSky sample stats; airports with no sample are treated as unavailable (opsPerRunway undefined). */
  flightStatsByIata: Map<string, { dailyOps: number; sampleSize: number; unknownDestShare: number }>;
}

/** Computes raw KPIs, percentile-normalized scores, tier, drivers and confidence for every airport in the national peer set. */
export function computeMetricsForPeerSet(
  peerSet: AirportRecord[],
  context: MetricsContext
): Map<string, AirportMetrics> {
  const growthCagrById = new Map<string, number | undefined>();
  const enplanementsById = new Map<string, number | undefined>();
  const paxPerRunwayById = new Map<string, number | undefined>();
  const opsPerRunwayById = new Map<string, number | undefined>();
  const recoveryRatioById = new Map<string, number | undefined>();

  for (const airport of peerSet) {
    growthCagrById.set(airport.iata, growthCagr(airport));
    enplanementsById.set(airport.iata, latestEnplanements(airport));
    paxPerRunwayById.set(airport.iata, paxPerRunway(airport));
    recoveryRatioById.set(airport.iata, recoveryRatio(airport));

    const stats = context.flightStatsByIata.get(airport.iata);
    opsPerRunwayById.set(airport.iata, stats ? opsPerRunway(stats.dailyOps, airport) : undefined);
  }

  const growthCagrPct = percentileRankAll(growthCagrById);
  const enplanementsPct = percentileRankAll(enplanementsById);
  const paxPerRunwayPct = percentileRankAll(paxPerRunwayById);
  const opsPerRunwayPct = percentileRankAll(opsPerRunwayById);
  const recoveryRatioPct = percentileRankAll(recoveryRatioById);

  const result = new Map<string, AirportMetrics>();

  for (const airport of peerSet) {
    const nasAirportStatus = statusForAirport(context.nasStatus, airport.iata);
    const delay = delaySignal(nasAirportStatus);

    const gPct = growthCagrPct.get(airport.iata) ?? 0;
    const ePct = enplanementsPct.get(airport.iata) ?? 0;
    const pPct = paxPerRunwayPct.get(airport.iata) ?? 0;
    const oPct = opsPerRunwayPct.get(airport.iata) ?? 0;
    const rPct = recoveryRatioPct.get(airport.iata) ?? 0;

    const demand = demandScore({ growthCagrPct: gPct, enplanementsPct: ePct });
    const congestion = congestionScore({ paxPerRunwayPct: pPct, opsPerRunwayPct: oPct, delaySignal: delay });
    const opportunity = opportunityScore(demand, congestion, rPct);
    const unmet = unmetDemandIndex(demand, congestion);

    const opportunityDrivers = driverBreakdown({
      demand: { weight: 0.45, percentile: demand },
      congestion: { weight: 0.4, percentile: congestion },
      recovery: { weight: 0.15, percentile: rPct }
    });
    const unmetDemandDrivers = driverBreakdown({
      paxPerRunway: { weight: 0.5, percentile: pPct },
      opsPerRunway: { weight: 0.35, percentile: oPct },
      delaySignal: { weight: 0.15, percentile: delay * 100 }
    });

    const stats = context.flightStatsByIata.get(airport.iata);
    const enplanementYears = Object.keys(airport.enplanements)
      .map(Number)
      .filter((y) => !Number.isNaN(y));
    const enplanementDataYear = enplanementYears.length > 0 ? Math.max(...enplanementYears) : undefined;

    const confidence = computeConfidence({
      openSkySampleSize: stats?.sampleSize ?? 0,
      unknownDestShare: stats?.unknownDestShare ?? 1,
      enplanementDataYear,
      currentYear: context.currentYear,
      usedStaleFallback: context.usedStaleFallback,
      delaySignalAvailable: true
    });

    result.set(airport.iata, {
      iata: airport.iata,
      name: airport.name,
      state: airport.state,
      enplanements: enplanementsById.get(airport.iata),
      growthCagr: growthCagrById.get(airport.iata),
      recoveryRatio: recoveryRatioById.get(airport.iata),
      paxPerRunway: paxPerRunwayById.get(airport.iata),
      activeRunwayCount: activeRunwayCount(airport),
      demandScore: demand,
      congestionScore: congestion,
      opportunityScore: opportunity,
      unmetDemandIndex: unmet,
      tier: tierFor(opportunity),
      opportunityDrivers,
      unmetDemandDrivers,
      confidence: confidence.level,
      confidenceReasons: confidence.reasons
    });
  }

  return result;
}
