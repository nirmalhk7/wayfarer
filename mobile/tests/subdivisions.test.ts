import assert from "node:assert/strict";
import test from "node:test";

import { createSubdivisionCampaign, recordSubdivisionVisit } from "../src/game/subdivisionCampaign";
import { createGame } from "../src/game/engine";
import { decodeGameState, encodeGameState } from "../src/persistence";
import { assessObservation, locateSubdivision, PILOT_PORTS, subdivisionGeometry } from "../src/territories/subdivisions";

const eureka = { latitude: 40.7143559, longitude: -124.0990456 };
const arcata = { latitude: 40.735612, longitude: -123.8656711 };
const border = { latitude: 40.73685, longitude: -123.945483 };

test("official subdivisions have their full GEOID and retain every pilot shapefile vertex", () => {
  assert.equal(PILOT_PORTS.length, 10);
  let vertices = 0;
  for (const port of PILOT_PORTS) {
    assert.match(port.geoid, /^06\d{8}$/);
    assert.equal(port.countyGeoid, port.geoid.slice(0, 5));
    for (const polygon of subdivisionGeometry(port.geoid)) {
      for (const ring of polygon) {
        assert.deepEqual(ring[0], ring.at(-1));
        vertices += ring.length;
      }
    }
  }
  assert.equal(vertices, 41_115);
});

test("same-county crossings resolve a different COUSUB while repeated interior fixes resolve the same one", () => {
  const points = [eureka, { ...eureka, latitude: eureka.latitude + 0.0001 }, arcata];
  const observations = points.map((position) => locateSubdivision(position));
  assert.deepEqual(observations.map((item) => item.kind === "inside" ? item.port.geoid : null),
    ["0602390930", "0602390930", "0602390100"]);
  assert.deepEqual(observations.map((item) => item.kind === "inside" ? item.port.countyGeoid : null),
    ["06023", "06023", "06023"]);
});

test("boundary jitter, uncertain and stale fixes release no market authorization", () => {
  const now = 60_000;
  for (const longitude of [border.longitude - .00009, border.longitude, border.longitude + .00009]) {
    assert.equal(assessObservation({ ...border, longitude, accuracy: 5, timestamp: now }, now).kind, "border");
  }
  assert.equal(assessObservation({ ...eureka, accuracy: 150, timestamp: now }, now).kind, "poor");
  assert.equal(assessObservation({ ...eureka, accuracy: 5, timestamp: 30_000 }, now).kind, "stale");
  assert.equal(assessObservation({ ...eureka, accuracy: 5, timestamp: now + 1 }, now).kind, "stale");
  assert.equal(assessObservation({ ...eureka, accuracy: 5, timestamp: now, mocked: true }, now).kind, "poor");
  assert.equal(locateSubdivision({ latitude: 40, longitude: -122 }).kind, "outside");
});

test("legacy ship progress is carried forward and repeated visits are idempotent", () => {
  const legacy = createGame({ origin: { latitude: 0, longitude: 0 } });
  legacy.player.credits = 1234;
  legacy.player.cargo.ion_fuel = 2;
  const live = createSubdivisionCampaign(legacy);
  assert.deepEqual(live.player, legacy.player);
  assert.equal(live.dockedPortId, null);
  assert.equal(live.ports.length, 10);
  assert.deepEqual(live.discoveredPortIds, []);
  const eurekaVisit = recordSubdivisionVisit(live, "0602390930");
  assert.equal(recordSubdivisionVisit(eurekaVisit, "0602390930"), eurekaVisit);
  assert.equal(recordSubdivisionVisit(eurekaVisit, "06023"), eurekaVisit);
  const arcataVisit = recordSubdivisionVisit(eurekaVisit, "0602390100");
  const saved = encodeGameState(arcataVisit);
  assert.equal(decodeGameState(saved, "training"), null);
  assert.deepEqual(decodeGameState(saved, "subdivision-live"), arcataVisit);
  assert.throws(() => encodeGameState({ ...arcataVisit, dockedPortId: "0602390100" }));
});
