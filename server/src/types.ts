export interface DataEnvelope<T> {
  data: T;
  sources: string[];
  asOf: string;
  caveats: string[];
}

export interface RunwayInfo {
  lengthFt: number;
  surface: string;
  closed: boolean;
}

export interface AirportRecord {
  iata: string;
  icao: string;
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  hubSize: "L" | "M" | "S" | "N" | "nonhub";
  activeRunwayCount: number;
  runways: RunwayInfo[];
  enplanements: Record<string, number>;
}

export interface FlightSampleSummary {
  dailyOps: number;
  sampleSize: number;
  unknownDestShare: number;
  longHaulShare: number;
  days: number;
  asOf: string;
}

export interface SeedData {
  generatedAt: string;
  sources: string[];
  airports: AirportRecord[];
  /** Peer-set OpenSky flight sample stats by IATA, precomputed at seed time (see build-seed.ts). */
  flightStats: Record<string, FlightSampleSummary>;
}

export interface OpenSkyFlight {
  icao24: string;
  callsign: string | null;
  firstSeen: number;
  estDepartureAirport: string | null;
  lastSeen: number;
  estArrivalAirport: string | null;
  estDepartureAirportHorizDistance: number | null;
  estDepartureAirportVertDistance: number | null;
  estArrivalAirportHorizDistance: number | null;
  estArrivalAirportVertDistance: number | null;
  departureAirportCandidatesCount: number;
  arrivalAirportCandidatesCount: number;
}

export type NasDelayLevel = "none" | "delay" | "ground_stop";

export interface NasAirportStatus {
  iata: string;
  level: NasDelayLevel;
  reasons: string[];
}

export interface NasStatusSnapshot {
  updateTime: string;
  groundStops: string[];
  groundDelays: string[];
  generalDelays: string[];
}
