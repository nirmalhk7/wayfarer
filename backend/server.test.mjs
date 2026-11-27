import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("local backend entry point serves the Android catalog and has no web or write routes", async (t) => {
  const script = fileURLToPath(new URL("./server.mjs", import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const closed = once(child, "close");
  t.after(async () => { child.kill(); await closed; });
  const endpoint = await Promise.race([
    once(child.stdout, "data").then(([chunk]) => {
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk));
      assert.ok(match, "server must report its loopback port");
      return match[0];
    }),
    closed.then(([code]) => { throw new Error("Server closed before startup: " + code); }),
  ]);

  const health = await fetch(endpoint + "/healthz");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const atlas = await fetch(endpoint + "/v1/territories");
  assert.equal(atlas.status, 200);
  assert.equal(atlas.headers.get("content-type"), "application/geo+json");
  const shipped = await readFile(new URL("../mobile/src/territories/north-coast.json", import.meta.url), "utf8");
  assert.equal(await atlas.text(), shipped);
  const data = JSON.parse(shipped);
  assert.equal(data.revision, "north-coast-2025-cb500k.v1");
  assert.deepEqual(data.features.map((county) => county.id), ["06015", "06023"]);

  const portsResponse = await fetch(endpoint + "/v2/ports");
  assert.equal(portsResponse.status, 200);
  const ports = await portsResponse.json();
  assert.equal(ports.unit, "COUSUB");
  assert.equal(ports.ports.length, 404);
  assert.equal(new Set(ports.ports.map(({ geoid }) => geoid)).size, 404);
  for (const port of ports.ports) {
    assert.match(port.geoid, /^06\d{8}$/);
    assert.equal(port.countyGeoid, port.geoid.slice(0, 5));
    assert.equal(port.countySubdivisionCode, port.geoid.slice(5));
  }
  const livePorts = ports.ports.filter(({ liveAvailability }) => liveAvailability === "foreground-pilot");
  assert.equal(livePorts.length, 10);
  assert.deepEqual(ports.coverage.liveCountyGeoids, ["06015", "06023"]);
  assert.equal(ports.coverage.fieldVerified, false);
  const arcata = await fetch(endpoint + "/v2/ports/0602390100/boundary");
  assert.equal(arcata.status, 200);
  const boundary = await arcata.json();
  assert.equal(boundary.geoid, "0602390100");
  assert.equal(boundary.countyGeoid, "06023");
  assert.equal(boundary.crs, "EPSG:4269");
  const shape = await readFile(new URL("../mobile/src/territories/cousub/0602390100.json", import.meta.url), "utf8");
  assert.deepEqual(boundary.polygons, JSON.parse(shape));
  const outside = ports.ports.find(({ liveAvailability }) => liveAvailability === "outside-pilot");
  assert.equal((await fetch(endpoint + "/v2/ports/" + outside.geoid + "/boundary")).status, 404);
  assert.equal((await fetch(endpoint + "/v2/ports/06023/boundary")).status, 404);

  const head = await fetch(endpoint + "/v1/territories", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(Number(head.headers.get("content-length")), Buffer.byteLength(shipped));
  const write = await fetch(endpoint + "/v1/territories", { method: "POST", body: "{}" });
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("allow"), "GET, HEAD");
  assert.equal((await fetch(endpoint + "/v1/territories?unexpected=1")).status, 400);
  assert.equal((await fetch(endpoint + "/")).status, 404);
});
