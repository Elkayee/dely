#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { parseArgs } = require("node:util");
const { collect, summarize } = require("./dely-monitor-data.js");
const { summarizeJev } = require("./dely-monitor-jev.js");

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
  const now = options.now || Date.now;
  let cache = null, preview = null, pending = null, first = null, lastError = null, attempted = 0;
  const load = async (fresh = false, progressive = false) => {
    if (!pending && (!cache || fresh || now() - cache.loaded >= 30000) &&
        (!lastError || now() - attempted >= 30000)) {
      let ready;
      first = new Promise((resolve) => { ready = resolve; });
      attempted = now();
      const publish = (data) => {
        const next = { ...data, sources: { ...data.sources } };
        for (const [source, field] of [["orca", "workers"], ["codex", "conversations"], ["jev", "jev"]]) {
          if (data.sources?.[source]?.state === "loading" && cache?.data.sources?.[source]?.available) {
            next[field] = cache.data[field];
            next.sources[source] = { ...cache.data.sources[source], state: "refreshing" };
          }
        }
        preview = next; ready(next); return next;
      };
      pending = Promise.resolve().then(() => (options.collect || collect)({ onUpdate: publish })).then((data) => {
        const next = publish(data);
        cache = { loaded: now(), data: next }; lastError = null; preview = null; return next;
      }).catch((error) => {
        lastError = error; preview = null; ready(cache?.data || null); throw error;
      }).finally(() => { pending = null; });
      // Progressive callers observe the shared job without awaiting its completion.
      pending.catch(() => {});
    }
    if (progressive) return preview || cache?.data || (pending ? await first : null);
    if (pending) return pending;
    if (lastError) throw lastError;
    return cache?.data;
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
      const progressive = url.searchParams.get("progressive") === "true";
      if (![1, 7, 30].includes(days) || Number.isNaN(since)) { res.writeHead(400).end(); return; }
      try {
        let data = await load(false, progressive);
        if (!data) throw lastError || new Error("Sources have not loaded");
        if (since !== null && since > Date.parse(data.collectedAt) && since <= now()) data = await load(true, progressive);
        const asOf = Date.parse(data.collectedAt) || Date.now();
        const start = Math.max(asOf - days * 86400000, since ?? -Infinity);
        const result = summarize(data.events, data.workers, data.conversations, {
          since: start, repo: url.searchParams.get("repo") || "",
          probes: url.searchParams.get("probes") === "true",
          asOf, end: Math.max(start, asOf), runtimes: data.sources?.runtimes || [],
        });
        result.jev = summarizeJev(data.jev, { since: start, asOf,
          repo: url.searchParams.get("repo") || "", probes: url.searchParams.get("probes") === "true" });
        result.repos = [...new Set([...result.repos, ...(data.jev || []).map((r) => r.repo).filter(Boolean)])].sort();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ...result, sources: data.sources, collectedAt: data.collectedAt,
          refreshing: !!pending,
          stale: !!lastError || data === cache?.data && !!pending || Object.values(data.sources).some((s) => s?.state === "refreshing"),
          refreshError: lastError ? "Source refresh failed; the previous snapshot is shown" : null }));
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
