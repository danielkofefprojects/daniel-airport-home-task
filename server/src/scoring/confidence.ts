import { CONFIDENCE_THRESHOLDS } from "../config/scoring.js";

export type ConfidenceLevel = "High" | "Medium" | "Low";

const LEVELS: ConfidenceLevel[] = ["High", "Medium", "Low"];

export interface ConfidenceInputs {
  openSkySampleSize: number;
  unknownDestShare: number;
  enplanementDataYear: number | undefined;
  currentYear: number;
  usedStaleFallback: boolean;
  delaySignalAvailable: boolean;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  reasons: string[];
}

/** Starts at High and downgrades one level per triggered condition, floored at Low. */
export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const reasons: string[] = [];
  let levelIndex = 0;

  const downgrade = (reason: string): void => {
    reasons.push(reason);
    levelIndex = Math.min(levelIndex + 1, LEVELS.length - 1);
  };

  if (
    inputs.openSkySampleSize < CONFIDENCE_THRESHOLDS.minOpenSkySample ||
    inputs.unknownDestShare > CONFIDENCE_THRESHOLDS.maxUnknownDestShare
  ) {
    downgrade("OpenSky sample is small or has a high unknown-destination share.");
  }

  if (
    inputs.enplanementDataYear === undefined ||
    inputs.currentYear - inputs.enplanementDataYear > CONFIDENCE_THRESHOLDS.maxEnplanementAgeYears
  ) {
    downgrade("Enplanement data is older than 2 years.");
  }

  if (inputs.usedStaleFallback) {
    downgrade("A data source fell back to seed/cache older than its TTL.");
  }

  if (!inputs.delaySignalAvailable) {
    downgrade("Delay signal unavailable.");
  }

  return { level: LEVELS[levelIndex] ?? "Low", reasons };
}
