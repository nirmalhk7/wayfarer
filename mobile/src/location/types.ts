export type PermissionState = "granted" | "denied" | "undetermined";

export type LocationSample = Readonly<{
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number | null;
  altitudeMeters: number | null;
  verticalAccuracyMeters: number | null;
  headingDegrees: number | null;
  speedMetersPerSecond: number | null;
  recordedAtMs: number;
  isMocked: boolean;
}>;

export type SelectedPortRegion = Readonly<{
  portId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}>;

export type BackgroundLocationPermissions = Readonly<{
  foreground: PermissionState;
  background: PermissionState;
}>;

export type BackgroundLocationStatus = Readonly<{
  available: boolean;
  permissions: BackgroundLocationPermissions;
  geofenceArmed: boolean;
  highAccuracyTracking: boolean;
}>;

export type GeofenceTransition = "enter" | "exit";
