import http from "node:http";
import { metrics, type IndexerMetricsSnapshot } from "./metrics.js";

export function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/health" || url === "/healthz" || url === "/")) {
      const body: IndexerMetricsSnapshot = metrics.snapshot();
      const status = body.ok ? 200 : 503;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    if (req.method === "GET" && url === "/metrics") {
      const snap = metrics.snapshot();
      const lines = [
        `# HELP indexer_lag_blocks Blocks behind safe head`,
        `# TYPE indexer_lag_blocks gauge`,
        `indexer_lag_blocks ${snap.lagBlocks}`,
        `# HELP indexer_cursor_block Last processed block`,
        `# TYPE indexer_cursor_block gauge`,
        `indexer_cursor_block ${snap.cursorBlock ?? 0}`,
        `# HELP indexer_chain_head Latest chain head`,
        `# TYPE indexer_chain_head gauge`,
        `indexer_chain_head ${snap.chainHead ?? 0}`,
        `# HELP indexer_reorgs_total Reorgs detected`,
        `# TYPE indexer_reorgs_total counter`,
        `indexer_reorgs_total ${snap.reorgsDetected}`,
        `# HELP indexer_ticks_total Poll ticks`,
        `# TYPE indexer_ticks_total counter`,
        `indexer_ticks_total ${snap.ticksTotal}`,
        `# HELP indexer_logs_processed_total Logs processed`,
        `# TYPE indexer_logs_processed_total counter`,
        `indexer_logs_processed_total ${snap.logsProcessedTotal}`,
        `# HELP indexer_rebuilds_total Rebuilds requested`,
        `# TYPE indexer_rebuilds_total counter`,
        `indexer_rebuilds_total ${snap.rebuilds}`,
      ];
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      res.end(lines.join("\n") + "\n");
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(port, () => {
    console.log(`[indexer] health on :${port} (/health, /metrics)`);
  });
  return server;
}
