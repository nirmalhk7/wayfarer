import { createTradingService } from "./trading.mjs";

export function createTradeHandlers(store) {
  const service = createTradingService(store);
  function send(res, { status, body }, head = false) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff" });
    res.end(head ? undefined : JSON.stringify(body));
  }

  return {
    async health(req, res) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        return send(res, { status: 405, body: { error: "Method not allowed" } });
      }
      send(res, await service.health(), req.method === "HEAD");
    },
    async live(req, res) {
      const method = req.method;
      if (method !== "GET" && method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return send(res, { status: 405, body: { error: "Method not allowed" } });
      }
      let input;
      if (method === "POST") {
        if (!/^application\/json(?:;|$)/.test(req.headers["content-type"] ?? "")) {
          return send(res, { status: 415, body: { error: "JSON required" } });
        }
        try {
          let chunks = "";
          if (req.body !== undefined) chunks = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
          else {
            for await (const chunk of req) {
              chunks += chunk.toString();
              if (Buffer.byteLength(chunks) > 2048) break;
            }
          }
          if (Buffer.byteLength(chunks) > 2048) return send(res, { status: 413, body: { error: "Order too large" } });
          input = JSON.parse(chunks);
        } catch {
          return send(res, { status: 400, body: { error: "Invalid JSON" } });
        }
      }
      const requestedId = req.headers["x-wayfarer-command"];
      send(res, await service.live(method, req.headers.authorization, input, requestedId));
    },
  };
}
