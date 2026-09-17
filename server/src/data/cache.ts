import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface CacheEntry<T> {
  storedAt: number;
  value: T;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = path.resolve(__dirname, "../../data/cache");
const CACHE_DIR = process.env["CACHE_DIR"] ?? DEFAULT_CACHE_DIR;

function cacheFilePath(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return path.join(CACHE_DIR, `${safeKey}-${hash}.json`);
}

async function readCacheFile<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await readFile(cacheFilePath(key), "utf-8");
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

async function writeCacheFile<T>(key: string, value: T): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const entry: CacheEntry<T> = { storedAt: Date.now(), value };
  await writeFile(cacheFilePath(key), JSON.stringify(entry), "utf-8");
}

export interface CachedFetchResult<T> {
  value: T;
  fromCache: boolean;
  stale: boolean;
}

/**
 * Fetches `key` via `fetcher`, caching the result to disk for `ttlMs`.
 * On fetcher failure, falls back to a stale cache entry if one exists (marked `stale: true`).
 */
export async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<CachedFetchResult<T>> {
  const cached = await readCacheFile<T>(key);
  const isFresh = cached !== null && Date.now() - cached.storedAt < ttlMs;

  if (isFresh && cached) {
    return { value: cached.value, fromCache: true, stale: false };
  }

  try {
    const value = await fetcher();
    await writeCacheFile(key, value);
    return { value, fromCache: false, stale: false };
  } catch (err) {
    if (cached) {
      return { value: cached.value, fromCache: true, stale: true };
    }
    throw err;
  }
}
