"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const samePath = (a, b) => {
  try {
    const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    return normalize(fs.realpathSync(a)) === normalize(fs.realpathSync(b));
  }
  catch (_) { return false; }
};

// Only fresh sessions carrying this exact Dispatch and prompt can prove a pin.
function codexTurn(expected, homes) {
  if (!Number.isFinite(expected.launchedAt) || !expected.id ||
      (!expected.receiptMarker && !expected.spec)) return null;
  const files = new Set();
  for (const home of new Set(homes.filter(Boolean))) {
    for (const offset of [-1, 0, 1]) {
      const day = new Date(expected.launchedAt + offset * 86400000).toISOString().slice(0, 10).split("-");
      const directory = path.join(home, "sessions", ...day);
      if (!fs.existsSync(directory)) continue;
      for (const name of fs.readdirSync(directory)) {
        if (!/^rollout-.*\.jsonl$/.test(name)) continue;
        const file = path.join(directory, name);
        if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).mtimeMs < expected.launchedAt) continue;
        files.add(fs.realpathSync(file));
        if (files.size > 50) return null;
      }
    }
  }
  if (files.size > 50) return null;
  const matches = new Map();
  const versions = new Map();
  let bytes = 0;
  for (const file of files) {
    try {
      const fd = fs.openSync(file, "r");
      const head = Buffer.alloc(256 * 1024);
      let size;
      try { size = fs.readSync(fd, head, 0, head.length, 0); }
      finally { fs.closeSync(fd); }
      const first = head.subarray(0, size).toString("utf8").split("\n")[0];
      const header = JSON.parse(first);
      const meta = header.payload || {};
      if (header.type !== "session_meta" || !samePath(meta.cwd, expected.repo) ||
          !(Date.parse(meta.timestamp) >= expected.launchedAt && Date.parse(meta.timestamp) <= expected.observedAt)) continue;
      const length = fs.statSync(file).size;
      bytes += length;
      if (bytes > 16 * 1024 * 1024) return null;
      const raw = fs.readFileSync(file, "utf8");
      const rows = raw.slice(0, raw.lastIndexOf("\n") + 1).split("\n").filter(Boolean).map(JSON.parse);
      const user = rows.findLast((row) => row.type === "response_item" && row.payload?.role === "user" &&
        (!row.payload.internal_chat_message_metadata_passthrough?.content_item_kinds ||
          row.payload.internal_chat_message_metadata_passthrough.content_item_kinds.includes("user.text")));
      const message = user?.payload;
      const text = (message?.content || []).map((part) => part.text || "").join("\n");
      const context = rows.findLast((row) => row.type === "turn_context");
      const session = meta.id || meta.session_id;
      if (!versions.has(session)) versions.set(session, new Set());
      versions.get(session).add(crypto.createHash("sha256").update(JSON.stringify([context,
        message?.internal_chat_message_metadata_passthrough?.turn_id, text])).digest("hex"));
      if (!text.includes(expected.id) || !(expected.receiptMarker ? text.includes(expected.receiptMarker) : text.includes(expected.spec))) continue;
      const turn = context?.payload;
      const settings = turn?.collaboration_mode?.settings;
      const prior = expected.launch?.modelEvidence;
      if (prior && (prior.session !== (meta.id || meta.session_id) || prior.turn !== turn?.turn_id)) continue;
      const contexts = rows.filter((row) => row.type === "turn_context" && row.payload?.turn_id === turn?.turn_id);
      if (new Set(contexts.map((row) => JSON.stringify(row))).size !== 1) return null;
      if (!turn?.turn_id || turn.turn_id !== message.internal_chat_message_metadata_passthrough?.turn_id ||
          !(Date.parse(context.timestamp) >= Date.parse(meta.timestamp) && Date.parse(context.timestamp) <= expected.observedAt) || !samePath(turn.cwd, expected.repo) ||
          typeof turn.model !== "string" || typeof turn.effort !== "string" ||
          (settings?.model && settings.model !== turn.model) ||
          (settings?.reasoning_effort && settings.reasoning_effort !== turn.effort)) continue;
      const evidence = { session, turn: turn.turn_id,
        model: turn.model, effort: turn.effort, timestamp: context.timestamp, source: file,
        contextSha256: crypto.createHash("sha256").update(JSON.stringify(context)).digest("hex") };
      if (!evidence.session) continue;
      matches.set(JSON.stringify([evidence.session, meta.timestamp, evidence.turn, evidence.contextSha256]), evidence);
    } catch (_) { return null; }
  }
  return matches.size === 1 && versions.get([...matches.values()][0].session)?.size === 1 ? [...matches.values()][0] : null;
}

module.exports = { codexTurn: (...args) => {
  try { return codexTurn(...args); }
  catch (_) { return null; }
} };
