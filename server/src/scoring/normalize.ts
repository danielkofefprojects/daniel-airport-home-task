/**
 * Percentile rank of `value` within `population` (0-100), using the mean-rank method so ties
 * receive the same, averaged percentile instead of being ordered arbitrarily.
 * `population` should be the fixed national peer set (all US large + medium hub airports),
 * not just the airports in the current query, so a regional query cannot inflate weak airports.
 */
export function percentileRank(value: number, population: number[]): number {
  if (population.length === 0) return 0;

  let countBelow = 0;
  let countEqual = 0;
  for (const p of population) {
    if (p < value) countBelow++;
    else if (p === value) countEqual++;
  }

  // Average rank of all values equal to `value`, treated as the midpoint of their tied block.
  const rank = countBelow + countEqual / 2;
  return (rank / population.length) * 100;
}

/**
 * Builds a lookup of id -> percentile rank for a KPI, given a map of id -> value (undefined values
 * are excluded from both the population and the output).
 */
export function percentileRankAll(valuesById: Map<string, number | undefined>): Map<string, number> {
  const population: number[] = [];
  for (const value of valuesById.values()) {
    if (value !== undefined) population.push(value);
  }

  const result = new Map<string, number>();
  for (const [id, value] of valuesById) {
    if (value !== undefined) {
      result.set(id, percentileRank(value, population));
    }
  }
  return result;
}
