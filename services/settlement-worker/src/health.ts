import { createServer } from "node:http";

/** Lightweight readiness for hosted workers (Render/Fly/Docker) — WP-086. */
export function startHealthServer(port: number): void {
  const startedAt = Date.now();
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/health" || url === "/healthz" || url === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "settlement-worker",
          uptimeMs: Date.now() - startedAt,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[settlement-worker] health on :${port} (/health)`);
  });
}
