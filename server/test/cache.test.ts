import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "cache-test-"));
  process.env["CACHE_DIR"] = cacheDir;
  vi.resetModules();
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  delete process.env["CACHE_DIR"];
});

describe("cachedFetch", () => {
  it("calls the fetcher and caches the result on first call", async () => {
    const { cachedFetch } = await import("../src/data/cache.js");
    const fetcher = vi.fn().mockResolvedValue("value-1");

    const result = await cachedFetch("key-a", 60_000, fetcher);

    expect(result).toEqual({ value: "value-1", fromCache: false, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns the cached value without calling the fetcher within the TTL", async () => {
    const { cachedFetch } = await import("../src/data/cache.js");
    const fetcher = vi.fn().mockResolvedValue("value-1");

    await cachedFetch("key-b", 60_000, fetcher);
    const second = await cachedFetch("key-b", 60_000, fetcher);

    expect(second).toEqual({ value: "value-1", fromCache: true, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has expired", async () => {
    const { cachedFetch } = await import("../src/data/cache.js");
    const fetcher = vi.fn().mockResolvedValueOnce("value-1").mockResolvedValueOnce("value-2");

    await cachedFetch("key-c", 1, fetcher);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await cachedFetch("key-c", 1, fetcher);

    expect(second).toEqual({ value: "value-2", fromCache: false, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to a stale cached value when the fetcher fails", async () => {
    const { cachedFetch } = await import("../src/data/cache.js");
    const fetcher = vi.fn().mockResolvedValueOnce("value-1").mockRejectedValueOnce(new Error("network down"));

    await cachedFetch("key-d", 1, fetcher);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await cachedFetch("key-d", 1, fetcher);

    expect(second).toEqual({ value: "value-1", fromCache: true, stale: true });
  });

  it("throws when the fetcher fails and there is no cached value", async () => {
    const { cachedFetch } = await import("../src/data/cache.js");
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(cachedFetch("key-e", 60_000, fetcher)).rejects.toThrow("network down");
  });
});
