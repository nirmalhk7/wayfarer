import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const atlas = new URL("../mobile/src/territories/north-coast.json", import.meta.url);
const territoryGeoJSON = readFileSync(atlas);
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
  return send(req, res, 404, missing);
});

const port = Number(process.env.PORT ?? 4197);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("Invalid PORT");
server.listen(port, "127.0.0.1", () => {
  console.log("Wayfarer territory API at http://127.0.0.1:" + server.address().port);
});
