import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const atlas = new URL("../mobile/src/territories/north-coast.json", import.meta.url);
const territoryGeoJSON = readFileSync(atlas);
const cousub = new URL("../mobile/src/territories/cousub/", import.meta.url);
const portCatalog = readFileSync(new URL("catalog.json", cousub));
const pilot = JSON.parse(readFileSync(new URL("pilot.json", cousub)));
const boundaries = new Map(pilot.map(({ geoid, name, countyGeoid, countyName }) => [geoid, JSON.stringify({
  geoid, name, countyGeoid, countyName,
  encoding: "delta-polyline-lon-lat-1e6",
  crs: "EPSG:4269",
  polygons: JSON.parse(readFileSync(new URL(geoid + ".json", cousub))),
})]));
const health = JSON.stringify({ status: "ok" });
const unsupportedQuery = JSON.stringify({ error: "Query parameters are unsupported" });
const methodNotAllowed = JSON.stringify({ error: "Method not allowed" });
const missing = JSON.stringify({ error: "Not found" });

function send(req, res, status, body, type = "application/json", headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(req, res, 405, methodNotAllowed, "application/json", { Allow: "GET, HEAD" });
  }
  if (req.url.includes("?")) return send(req, res, 400, unsupportedQuery);
  if (req.url === "/healthz") return send(req, res, 200, health);
  if (req.url === "/v1/territories") {
    return send(req, res, 200, territoryGeoJSON, "application/geo+json");
  }
  if (req.url === "/v2/ports") return send(req, res, 200, portCatalog);
  const portBoundary = /^\/v2\/ports\/(\d{10})\/boundary$/.exec(req.url);
  const boundary = portBoundary && boundaries.get(portBoundary[1]);
  if (boundary) return send(req, res, 200, boundary);
  return send(req, res, 404, missing);
});

const port = Number(process.env.PORT ?? 4197);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("Invalid PORT");
server.listen(port, "127.0.0.1", () => {
  console.log("Wayfarer territory API at http://127.0.0.1:" + server.address().port);
});
