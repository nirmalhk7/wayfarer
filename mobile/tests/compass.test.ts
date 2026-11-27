import assert from "node:assert/strict";
import test from "node:test";

import { compassDirection, compassRange, nearestBoundaryPoint, placeName, trueBearing } from "../src/game/compass";

const origin = { latitude: 0, longitude: 0 };

test("true north, east and west have independent heading and straight-line range", () => {
  assert.equal(trueBearing(origin, { latitude: 1, longitude: 0 }), 0);
  assert.equal(trueBearing(origin, { latitude: 0, longitude: 1 }), 90);
  assert.equal(trueBearing(origin, { latitude: 0, longitude: -1 }), 270);
  assert.equal(compassRange(compassDirection(origin, { latitude: 0, longitude: 1 })), "111.2 km · East 90° true");
  assert.equal(compassRange(compassDirection(origin, origin)), "Less than 1 m");
});

test("range measures the nearest point on an edge rather than its vertex or interior", () => {
  const edge: [number, number][] = [[1, -1], [3, -1], [3, 1], [1, 1], [1, -1]];
  const nearest = nearestBoundaryPoint(origin, [[edge]]);
  assert.deepEqual(nearest, { latitude: 0, longitude: 1 });
  assert.equal(compassRange(compassDirection(origin, nearest)), "111.2 km · East 90° true");
});

test("range checks interior rings and separate parts", () => {
  const outer: [number, number][] = [[-4, -4], [4, -4], [4, 4], [-4, 4], [-4, -4]];
  const hole: [number, number][] = [[-.25, -1], [.5, -1], [.5, 1], [-.25, 1], [-.25, -1]];
  const island: [number, number][] = [[8, 0], [9, 0], [9, 1], [8, 1], [8, 0]];
  assert.deepEqual(nearestBoundaryPoint(origin, [[outer, hole], [island]]), { latitude: 0, longitude: -.25 });
  assert.deepEqual(nearestBoundaryPoint({ latitude: .5, longitude: 7.5 }, [[outer, hole], [island]]), { latitude: .5, longitude: 8 });
});

test("player names strip designations without changing the underlying place name", () => {
  assert.equal(placeName("Smith River-Gasquet CCD"), "Smith River-Gasquet");
  assert.equal(placeName("Del Norte County"), "Del Norte");
  assert.equal(placeName("Wayfarer Freeport"), "Wayfarer Freeport");
});
