import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  CAGR_BASE_YEAR,
  CONFIDENCE_THRESHOLDS,
  CONGESTION_SCORE_WEIGHTS,
  DEMAND_SCORE_WEIGHTS,
  LONG_HAUL_KM,
  OPPORTUNITY_SCORE_WEIGHTS,
  SCORE_TIERS,
  SHORT_HAUL_KM
} from "../../config/scoring.js";

export interface MethodologyResult {
  cagrBaseYear: number;
  haulBandsKm: { shortUnder: number; mediumRange: [number, number]; longAtOrAbove: number };
  weights: {
    demand: typeof DEMAND_SCORE_WEIGHTS;
    congestion: typeof CONGESTION_SCORE_WEIGHTS;
    opportunity: typeof OPPORTUNITY_SCORE_WEIGHTS;
  };
  formulas: string[];
  tiers: typeof SCORE_TIERS;
  confidenceThresholds: typeof CONFIDENCE_THRESHOLDS;
}

function buildResult(): MethodologyResult {
  return {
    cagrBaseYear: CAGR_BASE_YEAR,
    haulBandsKm: { shortUnder: SHORT_HAUL_KM, mediumRange: [SHORT_HAUL_KM, LONG_HAUL_KM], longAtOrAbove: LONG_HAUL_KM },
    weights: {
      demand: DEMAND_SCORE_WEIGHTS,
      congestion: CONGESTION_SCORE_WEIGHTS,
      opportunity: OPPORTUNITY_SCORE_WEIGHTS
    },
    formulas: [
      "growthCagr = (E_latest / E_base)^(1/years) - 1, base year " + CAGR_BASE_YEAR,
      "recoveryRatio = E_latest / E_base",
      "paxPerRunway = enplanements * 2 / activeRunwayCount",
      "opsPerRunway = dailyOps / activeRunwayCount",
      `DemandScore = ${DEMAND_SCORE_WEIGHTS.growthCagr}*pct(growthCagr) + ${DEMAND_SCORE_WEIGHTS.enplanements}*pct(enplanements)`,
      `CongestionScore = ${CONGESTION_SCORE_WEIGHTS.paxPerRunway}*pct(paxPerRunway) + ${CONGESTION_SCORE_WEIGHTS.opsPerRunway}*pct(opsPerRunway) + ${CONGESTION_SCORE_WEIGHTS.delaySignal}*delaySignal*100`,
      `OpportunityScore = ${OPPORTUNITY_SCORE_WEIGHTS.demandScore}*DemandScore + ${OPPORTUNITY_SCORE_WEIGHTS.congestionScore}*CongestionScore + ${OPPORTUNITY_SCORE_WEIGHTS.recoveryRatio}*pct(recoveryRatio)`,
      "UnmetDemandIndex = CongestionScore * (DemandScore / 100)",
      "Percentiles are computed against the fixed national peer set of US large + medium hub airports."
    ],
    tiers: SCORE_TIERS,
    confidenceThresholds: CONFIDENCE_THRESHOLDS
  };
}

function summarize(result: MethodologyResult): string {
  return (
    `Opportunity score = ${result.weights.opportunity.demandScore}*Demand + ` +
    `${result.weights.opportunity.congestionScore}*Congestion + ${result.weights.opportunity.recoveryRatio}*Recovery. ` +
    `Tiers: Strong >= ${result.tiers.strong}, Moderate >= ${result.tiers.moderate}, else Weak. ` +
    `Long-haul >= ${result.haulBandsKm.longAtOrAbove} km, short-haul < ${result.haulBandsKm.shortUnder} km. ` +
    "See the artifact for full formulas, weights, and confidence rules."
  );
}

export const explainMethodologyTool = tool(
  async () => {
    const result = buildResult();
    const content = summarize(result);
    const artifact = {
      data: result,
      sources: ["server/src/config/scoring.ts"],
      asOf: new Date().toISOString(),
      caveats: []
    };
    return [content, artifact] as const;
  },
  {
    name: "explain_methodology",
    description:
      "Returns the scoring formulas, weights, thresholds, and haul-band definitions used by the other tools, " +
      "so the agent can explain how a score or ranking was computed.",
    schema: z.object({}),
    responseFormat: "content_and_artifact"
  }
);
