import { CAGR_BASE_YEAR, DELAY_SIGNAL } from "../config/scoring.js";
import type { AirportRecord, NasAirportStatus, OpenSkyFlight } from "../types.js";
import { classifyHaul, haversineDistanceKm } from "./geo.js";

export function activeRunwayCount(airport: AirportRecord): number {
  return airport.runways.filter((r) => !r.closed).length;
}

function latestEnplanementYear(airport: AirportRecord): number | undefined {
  const years = Object.keys(airport.enplanements)
    .map(Number)
    .filter((y) => !Number.isNaN(y));
  if (years.length === 0) return undefined;
  return Math.max(...years);
}

export function latestEnplanements(airport: AirportRecord): number | undefined {
  const year = latestEnplanementYear(airport);
  return year === undefined ? undefined : airport.enplanements[String(year)];
}

/** (E_latest / E_base)^(1/years) - 1, using CAGR_BASE_YEAR as the base. */
export function growthCagr(airport: AirportRecord): number | undefined {
  const latestYear = latestEnplanementYear(airport);
  const base = airport.enplanements[String(CAGR_BASE_YEAR)];
  if (latestYear === undefined || base === undefined || base <= 0) return undefined;
  const latest = airport.enplanements[String(latestYear)];
  if (latest === undefined) return undefined;
  const years = latestYear - CAGR_BASE_YEAR;
  if (years <= 0) return undefined;
  return (latest / base) ** (1 / years) - 1;
}

/** E_latest / E_2019 */
export function recoveryRatio(airport: AirportRecord): number | undefined {
  const latestYear = latestEnplanementYear(airport);
  const base = airport.enplanements[String(CAGR_BASE_YEAR)];
  if (latestYear === undefined || base === undefined || base <= 0) return undefined;
  const latest = airport.enplanements[String(latestYear)];
  if (latest === undefined) return undefined;
  return latest / base;
}

/** enplanements * 2 / activeRunwayCount (x2 approximates total passengers, i.e. enplaning + deplaning). */
export function paxPerRunway(airport: AirportRecord): number | undefined {
  const enplanements = latestEnplanements(airport);
  const runways = activeRunwayCount(airport);
  if (enplanements === undefined || runways <= 0) return undefined;
  return (enplanements * 2) / runways;
}

export interface FlightSampleStats {
  dailyOps: number;
  sampleSize: number;
  unknownDestShare: number;
  longHaulShare: number;
}

/**
 * Aggregates a sample of departures into ops/day, unknown-destination share and long-haul share.
 * `days` is the number of calendar days the sample spans (for the dailyOps average).
 */
export function summarizeFlightSample(
  departures: OpenSkyFlight[],
  days: number,
  originCoordinates: { latitude: number; longitude: number },
  airportByIcao: Map<string, { latitude: number; longitude: number }>
): FlightSampleStats {
  const sampleSize = departures.length;
  if (sampleSize === 0 || days <= 0) {
    return { dailyOps: 0, sampleSize: 0, unknownDestShare: 0, longHaulShare: 0 };
  }

  let unknownCount = 0;
  let longHaulCount = 0;

  for (const flight of departures) {
    const arrivalCoords = flight.estArrivalAirport
      ? airportByIcao.get(flight.estArrivalAirport)
      : undefined;
    if (!arrivalCoords) {
      unknownCount++;
      continue;
    }
    const distanceKm = haversineDistanceKm(originCoordinates, arrivalCoords);
    if (classifyHaul(distanceKm) === "long") longHaulCount++;
  }

  return {
    // Departures + arrivals per day ~= 2x sampled departures per day.
    dailyOps: (sampleSize * 2) / days,
    sampleSize,
    unknownDestShare: unknownCount / sampleSize,
    longHaulShare: longHaulCount / sampleSize
  };
}

export function opsPerRunway(dailyOps: number, airport: AirportRecord): number | undefined {
  const runways = activeRunwayCount(airport);
  if (runways <= 0) return undefined;
  return dailyOps / runways;
}

export function delaySignal(status: NasAirportStatus): number {
  return DELAY_SIGNAL[status.level];
}
