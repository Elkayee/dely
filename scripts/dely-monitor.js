#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { parseArgs } = require("node:util");
const { collect, summarize } = require("./dely-monitor-data.js");

function sinceTimestamp(value) {
  if (value === null) return null;
  if (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return NaN;
  const date = Date.parse(value.slice(0, 10));
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return Date.parse(value);
}

function createMonitor(options = {}) {
  const assets = path.resolve(__dirname, "../ui/monitor");
  const files = { "/": ["index.html", "text/html"], "/monitor.css": ["monitor.css", "text/css"],
    "/monitor.js": ["monitor.js", "text/javascript"] };
  let cache = null, pending = null;
  const load = (fresh = false) => {
    if (!fresh && cache && Date.now() - cache.loaded < 30000) return Promise.resolve(cache.data);
    if (!pending) pending = (options.collect || collect)().then((data) => {
      cache = { loaded: Date.now(), data }; return data;
    }).finally(() => { pending = null; });
    return pending;
  };
  return http.createServer(async (req, res) => {
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host || "")) { res.writeHead(403).end(); return; }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/usage") {
      const days = Number(url.searchParams.get("days") || 7);
      const since = sinceTimestamp(url.searchParams.get("since"));
      if (![1, 7, 30].includes(days) || Number.isNaN(since)) { res.writeHead(400).end(); return; }
      try {
        let data = await load();
        if (since !== null && since > Date.parse(data.collectedAt)) data = await load(true);
        const asOf = Date.parse(data.collectedAt) || Date.now();
        const start = Math.max(asOf - days * 86400000, since ?? -Infinity);
        const result = summarize(data.events, data.workers, data.conversations, {
          since: start, repo: url.searchParams.get("repo") || "",
          probes: url.searchParams.get("probes") === "true",
          asOf, end: Math.max(start, asOf), runtimes: data.sources?.runtimes || [],
        });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ...result, sources: data.sources, collectedAt: data.collectedAt }));
      } catch (_) { res.setHeader("Content-Type", "application/json"); res.writeHead(503).end(JSON.stringify({ error: "Local activity sources could not be read" })); }
      return;
    }
    const asset = files[url.pathname];
    if (!asset) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", asset[1] + "; charset=utf-8");
    res.end(fs.readFileSync(path.join(assets, asset[0])));
  });
}

if (require.main === module) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "8787" },
    "enable-logging": { type: "boolean", default: false } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local port");
  if (values["enable-logging"]) fs.mkdirSync(path.join(os.homedir(), ".dely"), { recursive: true });
  const server = createMonitor();
  server.listen(port, "127.0.0.1", () => console.log("Dely Monitor: http://127.0.0.1:" + port));
  server.on("error", (e) => { console.error(e.code === "EADDRINUSE" ? "Local port is already in use; choose --port" : "Local monitor could not start"); process.exitCode = 1; });
}

module.exports = { createMonitor };
