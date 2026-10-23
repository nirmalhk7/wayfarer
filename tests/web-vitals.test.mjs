import assert from "node:assert/strict";
import test from "node:test";

import * as reporter from "../app/web-vitals-reporter.mjs";

test("publishes a bounded Core Web Vital payload to observers and configured RUM", () => {
  const publishWebVital = Reflect.get(reporter, "publishWebVital");
  assert.equal(typeof publishWebVital, "function", "publishWebVital must exist");
  const events = [];
  const beacons = [];

  publishWebVital({
    name: "LCP",
    value: 1875.25,
    delta: 200,
    id: "v4-123",
    rating: "good",
    entries: [{ huge: "not serialized" }],
    navigationType: "navigate",
  }, {
    endpoint: "https://rum.example.test/vitals",
    pathname: "/chart",
    dispatch: (name, detail) => events.push({ name, detail }),
    sendBeacon: (url, body) => { beacons.push({ url, body }); return true; },
  });

  const expected = {
    name: "LCP",
    value: 1875.25,
    delta: 200,
    id: "v4-123",
    rating: "good",
    navigationType: "navigate",
    pathname: "/chart",
  };
  assert.deepEqual(events, [{ name: "wayfarer:web-vital", detail: expected }]);
  assert.deepEqual(beacons, [{
    url: "https://rum.example.test/vitals",
    body: JSON.stringify(expected),
  }]);
});

test("keeps browser measurement local when no RUM endpoint is configured", () => {
  const publishWebVital = Reflect.get(reporter, "publishWebVital");
  assert.equal(typeof publishWebVital, "function", "publishWebVital must exist");
  let beaconCalls = 0;
  const events = [];
  publishWebVital({
    name: "CLS",
    value: 0.04,
    delta: 0.01,
    id: "v4-456",
    rating: "good",
    navigationType: "navigate",
  }, {
    endpoint: "",
    pathname: "/",
    dispatch: (name, detail) => events.push({ name, detail }),
    sendBeacon: () => { beaconCalls += 1; return true; },
  });

  assert.equal(beaconCalls, 0);
  assert.equal(events.length, 1);
});
