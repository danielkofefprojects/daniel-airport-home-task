import { describe, expect, it } from "vitest";
import { isRateLimitError, rateLimitRetryDelayMs } from "../src/agent/rateLimit.js";

const GROQ_429 =
  '429 {"error":{"message":"Rate limit reached for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7868, Requested 1680. Please try again in 11.61s.","type":"tokens","code":"rate_limit_exceeded"}}';

describe("isRateLimitError", () => {
  it("recognizes a Groq rate-limit error by its error code", () => {
    expect(isRateLimitError(new Error(GROQ_429))).toBe(true);
  });

  it("does not flag unrelated errors", () => {
    expect(isRateLimitError(new Error("network timeout"))).toBe(false);
    expect(isRateLimitError("not an Error instance")).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe("rateLimitRetryDelayMs", () => {
  it("parses Groq's suggested wait time and adds a small buffer", () => {
    expect(rateLimitRetryDelayMs(new Error(GROQ_429))).toBe(11_610 + 250);
  });

  it("falls back to a default delay when no wait time is present", () => {
    expect(rateLimitRetryDelayMs(new Error('{"code":"rate_limit_exceeded"}'))).toBe(5_000);
  });

  it("caps the delay at the maximum", () => {
    const longWait = new Error('{"code":"rate_limit_exceeded"} Please try again in 120s.');
    expect(rateLimitRetryDelayMs(longWait)).toBe(20_000);
  });
});
