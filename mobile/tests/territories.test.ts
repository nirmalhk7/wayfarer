import assert from "node:assert/strict";
import test from "node:test";

import { canDock, createGame, distanceMeters } from "../src/game/engine";
import { createNorthCoastTraining, territories, territoryAt, usesNorthCoastTrainingMap } from "../src/territories/northCoast";
import { decodeGameState, encodeGameState } from "../src/persistence";

test("synthetic replay crosses Humboldt, Del Norte and uncharted water", () => {
  const replay = [
    { latitude: 41.32, longitude: -123.84 },
    { latitude: 41.60, longitude: -123.84 },
    { latitude: 41.60, longitude: -125 },
  ];
  assert.deepEqual(replay.map((position) => territoryAt(position)?.fips ?? null), ["06023", "06015", null]);
  assert.equal(territoryAt({ latitude: 91, longitude: -124 }), null);
  assert.equal(territoryAt({ latitude: NaN, longitude: -124 }), null);
});

test("a shared Census boundary segment does not assign either county", () => {
  const [delNorte, humboldt] = territories;
  const humboldtSegments = new Set(humboldt.geometry.coordinates.flatMap((polygon) => polygon.flatMap(
    (ring) => ring.slice(1).map((point, index) => [String(point), String(ring[index])].sort().join("|")),
  )));
  const shared = delNorte.geometry.coordinates.flatMap((polygon) => polygon.flatMap((ring) =>
    ring.slice(1).map((point, index) => [point, ring[index]]),
  )).find(([a, b]) => String(a) !== String(b) && humboldtSegments.has([String(a), String(b)].sort().join("|")));
  assert.ok(shared, "the counties have a shared border");
  const [[ax, ay], [bx, by]] = shared;
  assert.equal(territoryAt({ longitude: (ax + bx) / 2, latitude: (ay + by) / 2 }), null);
});

test("fictional stations map to counties without changing the original Training economy", () => {
  const game = createNorthCoastTraining();
  const original = createGame({ origin: { latitude: 39.7392, longitude: -104.9903 }, seed: game.seed });
  assert.deepEqual(
    game.ports.map((port) => territoryAt(port.position)?.fips),
    ["06023", "06015", "06023", "06015", "06023", "06015", "06023"],
  );
  assert.deepEqual(game.ports.map((port) => port.market), original.ports.map((port) => port.market));
  assert.equal(usesNorthCoastTrainingMap(original), false);
  const save = encodeGameState(game);
  assert.equal(usesNorthCoastTrainingMap(decodeGameState(save, "training")!), true);
  assert.equal(decodeGameState(save, "live"), null);
  const tampered = JSON.parse(save);
  tampered.game.ports[1].position.latitude += 0.01;
  assert.equal(decodeGameState(JSON.stringify(tampered), "training"), null);
  assert.ok(distanceMeters(game.ports[0].position, game.ports[1].position) > 90_000);
  const example = { latitude: 41.60, longitude: -123.84 };
  assert.equal(territoryAt(example)?.fips, "06015");
  assert.equal(canDock(game, game.ports[1].id, example), false);
});
