import assert from "node:assert/strict";
import test from "node:test";

import {
  locationSamplesFromExpoTaskData,
  selectedPortRegionIdentifier,
  toLocationSample,
} from "../src/location/adapter.ts";

test("toLocationSample removes Expo-specific shape without losing measurement metadata", () => {
  assert.deepEqual(
    toLocationSample({
      coords: {
        latitude: 39.7392,
        longitude: -104.9903,
        accuracy: 7.5,
        altitude: 1_609,
        altitudeAccuracy: 4,
        heading: 181,
        speed: 2.25,
      },
      timestamp: 1_725_000_000_000,
      mocked: false,
    }),
    {
      latitude: 39.7392,
      longitude: -104.9903,
      horizontalAccuracyMeters: 7.5,
      altitudeMeters: 1_609,
      verticalAccuracyMeters: 4,
      headingDegrees: 181,
      speedMetersPerSecond: 2.25,
      recordedAtMs: 1_725_000_000_000,
      isMocked: false,
    },
  );
});

test("task conversion rejects malformed readings and preserves nullable sensor fields", () => {
  const samples = locationSamplesFromExpoTaskData({
    locations: [
      { coords: { latitude: "bad", longitude: -105 }, timestamp: 10 },
      {
        coords: {
          latitude: 39.7,
          longitude: -105,
          accuracy: null,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: 11,
      },
    ],
  });

  assert.equal(samples.length, 1);
  assert.deepEqual(samples[0], {
    latitude: 39.7,
    longitude: -105,
    horizontalAccuracyMeters: null,
    altitudeMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
    speedMetersPerSecond: null,
    recordedAtMs: 11,
    isMocked: false,
  });
  assert.deepEqual(locationSamplesFromExpoTaskData(null), []);
});

test("selected-port identifiers are stable and distinguish ports", () => {
  assert.equal(selectedPortRegionIdentifier("port/one"), "wayfarer:selected-port:port%2Fone");
  assert.notEqual(selectedPortRegionIdentifier("port-1"), selectedPortRegionIdentifier("port-2"));
});
