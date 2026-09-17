import { cachedFetch } from "./cache.js";
import type { DataEnvelope, OpenSkyFlight } from "../types.js";

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const API_BASE = "https://opensky-network.org/api";
const ONE_DAY_S = 24 * 60 * 60;

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

let tokenState: TokenState | null = null;

async function getAccessToken(): Promise<string> {
  const clientId = process.env["OPENSKY_CLIENT_ID"];
  const clientSecret = process.env["OPENSKY_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("OpenSky credentials missing: set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET");
  }

  if (tokenState && tokenState.expiresAt > Date.now() + 30_000) {
    return tokenState.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    throw new Error(`OpenSky token request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenState = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000
  };
  return tokenState.accessToken;
}

/** Unix seconds for the start of `daysAgo` full UTC days ago through the end of that day. */
function dayWindow(daysAgo: number): { begin: number; end: number } {
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Math.floor(dayStart / 1000) - (daysAgo - 1) * ONE_DAY_S;
  const begin = end - ONE_DAY_S;
  return { begin, end };
}

async function fetchDeparturesForWindow(icao: string, begin: number, end: number): Promise<OpenSkyFlight[]> {
  const token = await getAccessToken();
  const url = `${API_BASE}/flights/departure?airport=${icao}&begin=${begin}&end=${end}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`OpenSky departures request failed for ${icao}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as OpenSkyFlight[];
}

/**
 * Fetches departures for `icao` over the last `days` fully-ended UTC days (1-day windows, cached).
 * Falls back to a stale cache per-window on failure; a fully failed window is dropped with a caveat.
 */
export async function fetchRecentDepartures(
  icao: string,
  days: number
): Promise<DataEnvelope<OpenSkyFlight[]>> {
  const caveats: string[] = [];
  const flights: OpenSkyFlight[] = [];
  const sources: string[] = [];

  for (let daysAgo = 1; daysAgo <= days; daysAgo++) {
    const { begin, end } = dayWindow(daysAgo);
    const key = `opensky-departures-${icao}-${begin}-${end}`;
    try {
      const result = await cachedFetch(key, 7 * 24 * 60 * 60 * 1000, () =>
        fetchDeparturesForWindow(icao, begin, end)
      );
      if (result.stale) caveats.push(`OpenSky departures for ${icao} on window ${begin}-${end} from stale cache.`);
      flights.push(...result.value);
      sources.push(`${API_BASE}/flights/departure?airport=${icao}&begin=${begin}&end=${end}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      caveats.push(`OpenSky departures unavailable for ${icao} window ${begin}-${end}: ${message}`);
    }
  }

  return {
    data: flights,
    sources,
    asOf: new Date().toISOString(),
    caveats
  };
}
