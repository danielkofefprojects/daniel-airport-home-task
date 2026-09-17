/** Weights and thresholds for the scoring engine. Change values here only — never in scoring/*.ts. */

/** Base year for CAGR / recovery-ratio calculations (pre-COVID baseline). */
export const CAGR_BASE_YEAR = 2019;

/** Long-haul threshold in km (~3,000 mi). */
export const LONG_HAUL_KM = 4800;
/** Short-haul upper bound in km. Medium-haul is [SHORT_HAUL_KM, LONG_HAUL_KM). */
export const SHORT_HAUL_KM = 1500;

/** Earth radius in km, used by the haversine formula. */
export const EARTH_RADIUS_KM = 6371;
export const KM_PER_MILE = 1.609344;

export const DEMAND_SCORE_WEIGHTS = {
  growthCagr: 0.6,
  enplanements: 0.4
};

export const CONGESTION_SCORE_WEIGHTS = {
  paxPerRunway: 0.5,
  opsPerRunway: 0.35,
  delaySignal: 0.15
};

export const OPPORTUNITY_SCORE_WEIGHTS = {
  demandScore: 0.45,
  congestionScore: 0.4,
  recoveryRatio: 0.15
};

/** delaySignal values: 0 = no delay, 0.5 = delays reported, 1 = ground stop / GDP. */
export const DELAY_SIGNAL = {
  none: 0,
  delay: 0.5,
  ground_stop: 1
} as const;

export const SCORE_TIERS = {
  strong: 70,
  moderate: 50
};

export const CONFIDENCE_THRESHOLDS = {
  minOpenSkySample: 100,
  maxUnknownDestShare: 0.25,
  maxEnplanementAgeYears: 2
};
