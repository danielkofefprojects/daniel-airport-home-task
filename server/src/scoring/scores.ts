import {
  CONGESTION_SCORE_WEIGHTS,
  DEMAND_SCORE_WEIGHTS,
  OPPORTUNITY_SCORE_WEIGHTS,
  SCORE_TIERS
} from "../config/scoring.js";

export type Tier = "Strong" | "Moderate" | "Weak";

export interface PercentileInputs {
  growthCagrPct: number;
  enplanementsPct: number;
  paxPerRunwayPct: number;
  opsPerRunwayPct: number;
  delaySignal: number;
  recoveryRatioPct: number;
}

export function demandScore(pct: Pick<PercentileInputs, "growthCagrPct" | "enplanementsPct">): number {
  return (
    DEMAND_SCORE_WEIGHTS.growthCagr * pct.growthCagrPct +
    DEMAND_SCORE_WEIGHTS.enplanements * pct.enplanementsPct
  );
}

export function congestionScore(
  pct: Pick<PercentileInputs, "paxPerRunwayPct" | "opsPerRunwayPct" | "delaySignal">
): number {
  return (
    CONGESTION_SCORE_WEIGHTS.paxPerRunway * pct.paxPerRunwayPct +
    CONGESTION_SCORE_WEIGHTS.opsPerRunway * pct.opsPerRunwayPct +
    CONGESTION_SCORE_WEIGHTS.delaySignal * pct.delaySignal * 100
  );
}

export function opportunityScore(demand: number, congestion: number, recoveryRatioPct: number): number {
  return (
    OPPORTUNITY_SCORE_WEIGHTS.demandScore * demand +
    OPPORTUNITY_SCORE_WEIGHTS.congestionScore * congestion +
    OPPORTUNITY_SCORE_WEIGHTS.recoveryRatio * recoveryRatioPct
  );
}

export function tierFor(score: number): Tier {
  if (score >= SCORE_TIERS.strong) return "Strong";
  if (score >= SCORE_TIERS.moderate) return "Moderate";
  return "Weak";
}

/** UnmetDemandIndex = CongestionScore * (DemandScore / 100) */
export function unmetDemandIndex(demand: number, congestion: number): number {
  return congestion * (demand / 100);
}

export interface ScoreDriver {
  name: string;
  contribution: number;
}

/** Contribution of each weighted component to a composite score, sorted descending. */
export function driverBreakdown(components: Record<string, { weight: number; percentile: number }>): ScoreDriver[] {
  const drivers = Object.entries(components).map(([name, { weight, percentile }]) => ({
    name,
    contribution: weight * percentile
  }));
  return drivers.sort((a, b) => b.contribution - a.contribution);
}
