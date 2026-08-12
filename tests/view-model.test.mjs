import assert from "node:assert/strict";
import test from "node:test";

import {
  cargoTotals,
  formatDistance,
  formatRumor,
  portStatusCopy,
} from "../app/game/view-model.mjs";

test("formatDistance makes nearby and long real-world distances scannable", () => {
  assert.equal(formatDistance(0), "At your position");
  assert.equal(formatDistance(847), "847 m");
  assert.equal(formatDistance(12_840), "12.8 km");
  assert.equal(formatDistance(156_400), "156 km");
  assert.equal(formatDistance(null), "Range unknown");
});

test("formatRumor turns a market signal into useful Galactic News copy", () => {
  assert.deepEqual(
    formatRumor({
      id: "cinder-he3",
      kind: "market",
      port: "Cinder Gate",
      commodity: "Helium-3",
      signal: "buy",
      change: 20,
    }),
    {
      id: "cinder-he3",
      headline: "Cinder Gate wants Helium-3",
      detail: "Buying at a premium (+20%).",
      tone: "opportunity",
    },
  );
});

test("formatRumor keeps a security alert distinct from a trade opportunity", () => {
  assert.deepEqual(
    formatRumor({
      id: "halcyon-customs",
      kind: "customs",
      port: "Halcyon Reach",
      detail: "Inspections are slowing freight traffic.",
    }),
    {
      id: "halcyon-customs",
      headline: "Customs watch: Halcyon Reach",
      detail: "Inspections are slowing freight traffic.",
      tone: "warning",
    },
  );
});

test("formatRumor converts an engine price band into a usable market lead", () => {
  assert.deepEqual(
    formatRumor({
      commodityId: "fuel",
      commodityName: "Ion Fuel",
      port: "Aster Quay",
      price: "cheap",
    }),
    {
      id: "Aster Quay-fuel",
      headline: "Ion Fuel is cheap at Aster Quay",
      detail: "Worth a look before the market turns.",
      tone: "opportunity",
    },
  );
});

test("cargoTotals counts units and occupied commodity types from an object manifest", () => {
  assert.deepEqual(
    cargoTotals({ "Helium-3": 3, Spice: 2, Ore: 0 }),
    { units: 5, types: 2 },
  );
});

test("cargoTotals accepts inventory rows without counting empty holds", () => {
  assert.deepEqual(
    cargoTotals([
      { commodity: "Helium-3", quantity: 3 },
      { commodity: "Spice", quantity: 0 },
      { commodity: "Ore", quantity: 2 },
    ]),
    { units: 5, types: 2 },
  );
});

test("portStatusCopy guides pilots from transit through docking", () => {
  assert.equal(
    portStatusCopy({ portName: "Cinder Gate", distanceMeters: 1_250 }),
    "Cinder Gate is 1.3 km away. Move within docking range.",
  );
  assert.equal(
    portStatusCopy({ portName: "Cinder Gate", dockable: true }),
    "Cinder Gate is in docking range. Request clearance.",
  );
  assert.equal(
    portStatusCopy({ portName: "Cinder Gate", docked: true }),
    "Docked at Cinder Gate. Market access granted.",
  );
});
