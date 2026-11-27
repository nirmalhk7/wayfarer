import assert from "node:assert/strict";
import test from "node:test";

import {
  cargoUnits,
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

test("rumorSummary explains cheap and expensive market signals", () => {
  assert.equal(rumorSummary("Ion Fuel", "cheap"), "ION FUEL SUPPLY GLUT");
  assert.equal(rumorSummary("Xeno Relics", "expensive"), "XENO RELICS SHORTAGE");
  assert.equal(rumorSummary("Nutrient Gel", "steady"), "NUTRIENT GEL STEADY");
});
