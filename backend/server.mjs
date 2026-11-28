import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createTradeHandlers } from "./trading-http.mjs";

const atlas = new URL("../mobile/src/territories/north-coast.json", import.meta.url);
const territoryGeoJSON = readFileSync(atlas);
const releases = new Set(["county2026-v1", "county2026-v2"]);
const releaseDirectory = process.env.WAYFARER_ATLAS_DIR;
const retired = JSON.stringify({ error: "Port definitions have moved to the versioned county atlas" });
const immutable = { "Cache-Control": "public, max-age=31536000, immutable" };

function asset(release, path) {
  if (!releaseDirectory) return null;
  try { return readFileSync(join(releaseDirectory, release, path)); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

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

const unavailable = async () => { throw new Error("Trading storage unavailable"); };
const trading = createTradeHandlers(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
  ? (await import("./blob-store.mjs")).blobStore
  : { check: unavailable, read: unavailable, write: unavailable });

const server = createServer((req, res) => {
  if (req.url === "/health") return void trading.health(req, res);
  if (req.url === "/v1/live") return void trading.live(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(req, res, 405, methodNotAllowed, "application/json", { Allow: "GET, HEAD" });
  }
  if (req.url.includes("?")) return send(req, res, 400, unsupportedQuery);
  if (req.url === "/healthz") return send(req, res, 200, health);
  if (req.url === "/v1/territories") {
    return send(req, res, 200, territoryGeoJSON, "application/geo+json");
  }
  if (req.url === "/v2/ports" || /^\/v2\/ports\/\d{10}\/boundary$/.test(req.url)) {
    return send(req, res, 410, retired);
  }
  const match = /^\/atlas\/([^/]+)\/(.+)$/.exec(req.url);
  if (!match || !releases.has(match[1])) return send(req, res, 404, missing);
  const [, release, path] = match;
  if (/^(?:index|sources|counties)\.json$/.test(path)) {
    const body = asset(release, path);
    if (body) return send(req, res, 200, body, "application/json", immutable);
  }
  if (/^tiles\/-?\d{1,3}_-?\d{1,2}\.json$/.test(path)) {
    const body = asset(release, path + ".gz");
    if (body) {
      const headers = { ...immutable, Vary: "Accept-Encoding" };
      if (/(?:^|,\s*)gzip\s*(?:,|$)/i.test(req.headers["accept-encoding"] ?? "")) {
        return send(req, res, 200, body, "application/json", { ...headers, "Content-Encoding": "gzip" });
      }
      return send(req, res, 200, gunzipSync(body), "application/json", headers);
    }
  }
  return send(req, res, 404, missing);
});

const port = Number(process.env.PORT ?? 4197);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("Invalid PORT");
server.listen(port, "127.0.0.1", () => {
  console.log("Wayfarer territory API at http://127.0.0.1:" + server.address().port);
});
