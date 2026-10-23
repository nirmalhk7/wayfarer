import type { LocationSample } from "./types.ts";

type ExpoLocationLike = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    altitude?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
  timestamp: number;
  mocked?: boolean;
};

const REGION_IDENTIFIER_PREFIX = "wayfarer:selected-port:";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableFiniteNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function isExpoLocationLike(value: unknown): value is ExpoLocationLike {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExpoLocationLike>;
  return Boolean(
    candidate.coords
      && isFiniteNumber(candidate.coords.latitude)
      && isFiniteNumber(candidate.coords.longitude)
      && isFiniteNumber(candidate.timestamp),
  );
}

export function toLocationSample(location: ExpoLocationLike): LocationSample {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    horizontalAccuracyMeters: nullableFiniteNumber(location.coords.accuracy),
    altitudeMeters: nullableFiniteNumber(location.coords.altitude),
    verticalAccuracyMeters: nullableFiniteNumber(location.coords.altitudeAccuracy),
    headingDegrees: nullableFiniteNumber(location.coords.heading),
    speedMetersPerSecond: nullableFiniteNumber(location.coords.speed),
    recordedAtMs: location.timestamp,
    isMocked: location.mocked === true,
  };
}

export function locationSamplesFromExpoTaskData(data: unknown): LocationSample[] {
  if (!data || typeof data !== "object") return [];
  const locations = (data as { locations?: unknown }).locations;
  if (!Array.isArray(locations)) return [];
  return locations.filter(isExpoLocationLike).map(toLocationSample);
}

export function selectedPortRegionIdentifier(portId: string): string {
  return `${REGION_IDENTIFIER_PREFIX}${encodeURIComponent(portId)}`;
}

export function isSelectedPortRegionIdentifier(identifier: unknown): identifier is string {
  return typeof identifier === "string" && identifier.startsWith(REGION_IDENTIFIER_PREFIX);
}
