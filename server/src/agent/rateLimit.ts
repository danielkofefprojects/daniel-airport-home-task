const RATE_LIMIT_PATTERN = /"code"\s*:\s*"rate_limit_exceeded"/;
const RETRY_AFTER_PATTERN = /try again in ([\d.]+)s/i;
const DEFAULT_RETRY_MS = 5_000;
const MAX_RETRY_MS = 20_000;

export function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && RATE_LIMIT_PATTERN.test(err.message);
}

/** Parses Groq's "Please try again in 11.61s" hint out of a 429 error message, in ms. */
export function rateLimitRetryDelayMs(err: unknown): number {
  if (!(err instanceof Error)) return DEFAULT_RETRY_MS;
  const match = RETRY_AFTER_PATTERN.exec(err.message);
  if (!match?.[1]) return DEFAULT_RETRY_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_MS;
  return Math.min(Math.ceil(seconds * 1000) + 250, MAX_RETRY_MS);
}
