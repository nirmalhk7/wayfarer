import assert from "node:assert/strict";
import test from "node:test";

import {
  cargoUnits,
  chartPosition,
  formatDistance,
  rumorSummary,
} from "../src/game/presentation.ts";

test("formatDistance keeps city-scale ranges readable", () => {
  assert.equal(formatDistance(0), "HERE");
  assert.equal(formatDistance(847), "847 M");
  assert.equal(formatDistance(1_260), "1.3 KM");
});

test("cargoUnits totals only positive manifest quantities", () => {
  assert.equal(cargoUnits({ ion_fuel: 3, xeno_relics: 2, empty: 0 }), 5);
});

test("chartPosition maps coordinates into a bounded radar square", () => {
  const point = chartPosition(
    { latitude: 39.7392, longitude: -104.9903 },
    { latitude: 39.745, longitude: -104.982 },
  );
  assert.ok(point.x >= 8 && point.x <= 92);
  assert.ok(point.y >= 8 && point.y <= 92);
});

test("rumorSummary explains cheap and expensive market signals", () => {
  assert.equal(rumorSummary("Ion Fuel", "cheap"), "ION FUEL SUPPLY GLUT");
  assert.equal(rumorSummary("Xeno Relics", "expensive"), "XENO RELICS SHORTAGE");
  assert.equal(rumorSummary("Nutrient Gel", "steady"), "NUTRIENT GEL STEADY");
});
