import { EARTH_RADIUS_KM, KM_PER_MILE, LONG_HAUL_KM, SHORT_HAUL_KM } from "../config/scoring.js";

export type HaulBand = "short" | "medium" | "long";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two coordinates, in km. */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

/** Classifies a flight distance (km) into a haul band. Boundaries: short < 1,500 km, medium 1,500–4,799 km, long >= 4,800 km. */
export function classifyHaul(distanceKm: number): HaulBand {
  if (distanceKm < SHORT_HAUL_KM) return "short";
  if (distanceKm < LONG_HAUL_KM) return "medium";
  return "long";
}
