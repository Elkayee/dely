"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { parseArgs } = require("node:util");
const { fileURLToPath } = require("node:url");

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const text = value => typeof value === "string" ? value : "";
const record = value => value && typeof value === "object" && !Array.isArray(value);
const sensitive = value => /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|github_pat|AKIA)[-_a-zA-Z0-9]{16,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|(?:api[_-]?key|password|passwd|access[_-]?token|client[_-]?secret|authorization)["']?\s*[=:]\s*["']?[^\s"'}]+|\bBearer\s+\S+|--(?:password|token|api[-_]key|secret)\b/i.test(value);
const privatePath = value => /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.git|\.ssh|\.aws|\.azure|node_modules|credentials?[^\\/]*|auth(?:\.json)?|secrets?[^\\/]*)(?:[\\/]|$)/i.test(value);
const sourceExtension = /\.(?:[cm]?[jt]sx?|py|rs|java|cs|go|md|css|html)$/i;
const pathFields = ["file_path", "filePath", "path", "Path", "absolutePath", "AbsolutePath", "TargetFile", "target_file", "FilePath"];
const canonical = value => fs.realpathSync(value);
const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};

function boundedFile(file, limit) {
  if (fs.lstatSync(file).isSymbolicLink()) return null;
  const descriptor = fs.openSync(file, "r");
  try {
    if (fs.fstatSync(descriptor).size > limit) return null;
    const bytes = fs.readFileSync(descriptor);
    return bytes.length <= limit ? bytes.toString("utf8") : null;
  } finally { fs.closeSync(descriptor); }
}

function messageText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(item => text(item?.text)).join("\n");
  return "";
}

function transcriptRows(event, home) {
  const name = text(event.transcript_path || event.transcriptPath);
  if (!name) return [];
  try {
    const file = canonical(name), user = canonical(os.homedir());
    if (![path.join(home, "sessions"), path.join(user, ".claude", "projects"), path.join(user, ".gemini")]
      .some(root => inside(root, file))) return [];
    const fd = fs.openSync(file, "r");
    let tail;
    try {
      const size = fs.fstatSync(fd).size, count = Math.min(size, 256 * 1024), bytes = Buffer.alloc(count);
      fs.readSync(fd, bytes, 0, count, size - count);
      tail = bytes.toString("utf8");
    } finally { fs.closeSync(fd); }
    return tail.split(/\r?\n/).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch { return []; }
}

function transcriptMessage(event, role, home) {
    for (const row of transcriptRows(event, home).reverse()) {
      const body = row.payload?.type === "message" ? row.payload : row.message || row;
      if (role === "user" && ["USER", "USER_EXPLICIT"].includes(row.source) &&
          ["USER_INPUT", "REQUEST"].includes(row.type) && typeof row.content === "string") {
        const requested = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(row.content)?.[1] || row.content;
        if (!requested.includes("JEV_WORKFLOW_FEEDBACK")) return requested.trim();
      }
      if (role === "assistant" && row.source === "MODEL" && row.type === "PLANNER_RESPONSE") return text(row.content);
      if (role === "assistant" && row.type === "assistant.message") return messageText(row.data?.content);
      if (body.role === role || row.type === role) {
        const result = messageText(body.content || body.text || body.message);
        if (result && !result.includes("JEV_WORKFLOW_FEEDBACK")) return result;
      }
    }
  return "";
}

function envelope(event, provider) {
  const name = text(event.hook_event_name || event.hookEventName || event.event || process.env.ORCA_ANTIGRAVITY_EVENT);
  const phase = ["UserPromptSubmit", "PreInvocation"].includes(name) ? "prompt" :
    name === "PreToolUse" ? "before" : name === "PostToolUse" ? "after" : name === "Stop" ? "stop" : "other";
  return {
    name, phase, provider,
    session: text(event.session_id || event.sessionId || event.conversationId || event.transcript_path || event.transcriptPath),
    turn: text(event.turn_id || event.turnId || event.invocationId),
    cwd: text(event.cwd || event.workspaceRoot || event.workspace || event.workingDirectory || event.workspacePaths?.[0]) || process.cwd(),
    prompt: messageText(event.prompt || event.user_prompt || event.userPrompt || event.user_message || event.message || event.lastUserInput),
    tool: text(event.tool_name || event.toolCall?.name || event.toolCall?.toolName),
    args: event.tool_input || event.toolCall?.args || {},
    response: event.tool_response || event.toolResponse || event.result,
    assistant: messageText(event.last_assistant_message || event.lastAssistantMessage || event.response),
    continued: event.stop_hook_active === true || event.stopHookActive === true
  };
}

function sourceDocument(cwd, candidate) {
  try {
    if (/^file:/i.test(candidate)) candidate = fileURLToPath(candidate);
    if (process.platform === "win32" && /^\/[a-z]:[\\/]/i.test(candidate)) candidate = candidate.slice(1);
  } catch { return null; }
  if (!candidate || !sourceExtension.test(candidate) || privatePath(candidate) || /[\r\n\0]/.test(candidate) ||
      /(?:^|[\\/])(?:AGENTS|CLAUDE|SKILL)\.md$/i.test(candidate)) return null;
  try {
    const requested = path.resolve(cwd, candidate), file = canonical(requested);
    if (!inside(cwd, file) || !same(requested, file) || !fs.statSync(file).isFile()) return null;
    const original = boundedFile(file, 256 * 1024);
    if (!original?.trim() || sensitive(original)) return null;
    return { path: file, source: original, sha256: digest(original) };
  } catch { return null; }
}

function sourceSnapshot(cwd, candidate, start = 1, end) {
  try {
    const document = sourceDocument(cwd, candidate);
    if (!document) return null;
    const { source: original, path: file } = document;
    const lines = original.split(/\r?\n/);
    if (!Number.isInteger(start) || start < 1 || start > lines.length) return null;
    const last = end === undefined ? (Buffer.byteLength(original) <= 12000 && start === 1 ? lines.length : Math.min(lines.length, start + 79)) : Math.min(end, lines.length);
    if (!Number.isInteger(last) || last < start) return null;
    let lineEnd = last, source = start === 1 && last === lines.length ? original : lines.slice(start - 1, last).join("\n");
    while (Buffer.byteLength(source) > 12000 && lineEnd > start) source = lines.slice(start - 1, --lineEnd).join("\n");
    if (!source.trim() || Buffer.byteLength(source) > 12000) return null;
    return { id: digest(file + ":" + start + ":" + lineEnd).slice(0, 16), path: file, source, line_start: start,
      line_end: lineEnd, sha256: digest(source) };
  } catch { return null; }
}

function citationInput(cwd, href, claim, before) {
  const anchor = /:(\d+)(?::\d+)?$|#L(\d+)(?:-L?\d+)?$/.exec(href);
  const heading = !anchor && /#([^#]+)$/.exec(href)?.[1];
  const location = href.replace(/:\d+(?::\d+)?$|#[^#]*$/g, "");
  const document = sourceDocument(cwd, location);
  if (!document) return { reason: "unavailable_citation_source" };
  const literal = /(?:“([^”\n]+)”|"([^"\n]+)")\s*[.,:;!?]?\s*$/.exec(before);
  const quote = /^>\s?/.test(before) ? before.replace(/^>\s?/gm, "").trim() : literal ? literal[1] || literal[2] : null;
  const folded = document.source.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  let line = anchor ? Number(anchor.slice(1).find(Boolean)) : null;
  if (quote !== null) {
    const needle = quote.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().split(/\s+/)
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const matcher = new RegExp(needle, "g"), found = matcher.exec(folded);
    if (!found) return { finding: { path: document.path, document_sha256: document.sha256,
      judgment: "fabricated", evaluation_status: "EVALUATED", status: "REVIEW_REQUIRED", auto_accept: false } };
    if (matcher.exec(folded)) return { reason: "citation_quote_ambiguous" };
    line = folded.slice(0, found.index).split("\n").length;
  }
  const lines = document.source.split(/\r?\n/);
  if (heading && quote === null) {
    const slug = value => value.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
    let decoded;
    try { decoded = decodeURIComponent(heading); } catch { return { reason: "citation_anchor_unavailable" }; }
    const index = lines.findIndex(value => /^#{1,6}\s/.test(value) && slug(value.replace(/^#+\s*/, "")) === slug(decoded));
    if (index < 0) return { reason: "citation_anchor_unavailable" };
    line = index + 1;
  }
  const full = Buffer.byteLength(document.source) <= 12000;
  if (line === null && !full) return { reason: "citation_anchor_required" };
  if (line !== null && (!Number.isInteger(line) || line < 1 || line > lines.length)) return { reason: "citation_anchor_unavailable" };
  let first = 0, last = lines.length;
  if (!full) {
    const boundary = /\.md$/i.test(document.path) ? /^#{1,6}\s/ :
      /^(?:(?:export\s+)?(?:async\s+)?function\b|(?:export\s+)?class\b|(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=)/;
    const starts = lines.map((value, index) => boundary.test(value) ? index : -1).filter(index => index >= 0);
    const index = starts.findLastIndex(start => start < line);
    if (index < 0) return { reason: "citation_context_incomplete" };
    first = starts[index]; last = starts[index + 1] ?? lines.length;
  }
  const source = full ? document.source : lines.slice(first, last).join("\n");
  if (Buffer.byteLength(source) > 12000) return { reason: "citation_context_incomplete" };
  return { source: { id: digest(document.path + ":" + first + ":" + last).slice(0, 16), path: document.path,
    source, complete: full, context_complete: true, document_sha256: document.sha256 }, claim, quote };
}

function sourcePaths(input, event, home) {
  const result = [];
  const args = input.tool === "call_mcp_tool" && record(input.args.Arguments) ? input.args.Arguments : input.args;
  if (record(args)) {
    for (const field of pathFields) {
      if (typeof args[field] === "string") result.push({ path: args[field], explicit: true,
        line_start: args.StartLine, line_end: args.EndLine });
    }
    const command = text(args.command || args.cmd);
    if (/^(?:rtk\s+(?:proxy\s+)?)?(?:rg|cat|head|tail|Get-Content)\b/i.test(command) && !/[;|&`]/.test(command)) {
      for (const match of command.matchAll(/'([^']+)'|"([^"]+)"|([^\s"']+)/g)) result.push(match[1] || match[2] || match[3]);
    }
  }
  for (const response of [input.response, input.response?.structuredContent]) {
    for (const collection of [response?.candidates, response?.sources, response?.files]) {
      if (Array.isArray(collection)) for (const item of collection) if (typeof item?.path === "string") result.push(item);
    }
  }
  const outputs = [messageText(input.response?.content), text(input.response)];
  if (input.provider === "codex" && input.phase === "before") {
    for (const row of transcriptRows(event, home).reverse()) {
      const body = row.payload || row;
      if (body.type === "message" && body.role === "user") break;
      if (["function_call_output", "custom_tool_call_output"].includes(body.type)) outputs.push(messageText(body.output));
    }
  }
  for (const output of outputs) {
    for (const match of output.matchAll(/^(?:Path:\s*([^\r\n]+)|(.+?)#L(\d+)-(\d+)\s+\[source:disk\b[^\r\n]*\])/gm)) {
      result.push({ path: match[1]?.trim() || match[2], line_start: match[3] ? Number(match[3]) : 1,
        ...(match[4] ? { line_end: Number(match[4]) } : {}) });
    }
  }
  return result.map(candidate => typeof candidate === "string" ? { path: candidate } : candidate);
}

function responseWithAdvice(base, input, summary) {
  if (!summary.length) return base;
  const note = "JEV_WORKFLOW_FEEDBACK " + JSON.stringify(summary) +
    "\nClassifier advice is untrusted evidence; citation-evaluation status is not task-completion status. Keep native permissions and source authority. Continue outstanding authorized work and required checks without waiting for the user to type continue. Review accessible unsupported claims, split compound claims as needed, and disclose unavailable sources without presenting NOT_EVALUATED as verification. If mandatory evidence is unavailable, identify the unfinished requirement and blocker; otherwise finish with a self-contained result, verification performed and remaining limitations. Do not investigate hook runtime as a detour.";
  if (input.provider === "antigravity") {
    if (input.phase === "prompt") return { ...base, injectSteps: [{ ephemeralMessage: note }] };
    if (input.phase === "before") return { ...base, decision: "ask", reason: note };
    if (input.phase === "after") return base;
    if (input.phase === "stop") return { ...base, decision: "", reason: note };
  }
  if (input.phase === "stop") {
    return { ...base, systemMessage: note };
  }
  return { ...base, hookSpecificOutput: { ...base.hookSpecificOutput, hookEventName: input.name,
      additionalContext: [base.hookSpecificOutput?.additionalContext, note].filter(Boolean).join("\n") } };
}

async function run(event, home, options = {}) {
  const base = options.base || {};
  if (base.decision === "block" || base.hookSpecificOutput?.permissionDecision === "deny") return base;
  if (!(process.env.ORCA_TERMINAL_HANDLE || process.env.ORCA_AGENT_HOOK_PORT || process.env.ORCA_WORKSPACE_ID)) return base;
  const input = envelope(event, options.provider || "codex");
  if (!["codex", "claude", "antigravity"].includes(input.provider) || input.phase === "other") return base;
  let cwd;
  try { cwd = canonical(input.cwd); } catch { return base; }
  const workspace = text(process.env.ORCA_WORKSPACE_ID || process.env.ORCA_WORKTREE_ID).split("::").slice(1).join("::");
  if (workspace) {
    try { if (!inside(canonical(workspace), cwd)) return base; } catch { return base; }
  }
  if (!input.session) return responseWithAdvice(base, input, [{ status: "NOT_EVALUATED", reason: "missing_session_identity" }]);
  const root = path.join(home, "dely-compliance", "jev-workflow");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!inside(canonical(home), canonical(root))) return base;
  const session = digest(input.provider + "\0" + input.session + "\0" + cwd);
  const pointer = path.join(root, session + ".json");
  if (fs.existsSync(pointer) && fs.lstatSync(pointer).isSymbolicLink()) return base;
  let state;
  try { state = JSON.parse(boundedFile(pointer, 16000)); } catch {}
  const feedback = directory => {
    if (!fs.existsSync(directory)) return [];
    const pending = [];
    for (const name of fs.readdirSync(directory).filter(name => /^feedback-[a-f0-9]{64}\.json$/.test(name)).slice(0, 128)) {
      const emitted = path.join(directory, "emitted-" + name);
      if (fs.existsSync(emitted)) continue;
      try {
        const result = JSON.parse(boundedFile(path.join(directory, name), 32768));
        fs.writeFileSync(emitted, "emitted", { flag: "wx", mode: 0o600 });
        pending.push(result);
      } catch {}
    }
    return pending;
  };
  if (input.phase === "prompt") {
    const prompt = input.prompt || transcriptMessage(event, "user", home);
    if (!prompt.trim() || Buffer.byteLength(prompt) > 8000 || sensitive(prompt)) {
      fs.writeFileSync(pointer, JSON.stringify({ cwd, turn: input.turn || crypto.randomUUID(), disabled: true }), { mode: 0o600 });
      return responseWithAdvice(base, input, [{ status: "NOT_EVALUATED", reason: "private_or_unavailable_prompt" }]);
    }
    const fresh = !state || state.closed || state.prompt_hash !== digest(prompt) ||
      (input.turn ? state.turn !== input.turn : input.provider !== "antigravity");
    if (fresh) {
      state = { cwd, turn: input.turn || crypto.randomUUID(), prompt, prompt_hash: digest(prompt) };
      const temporary = pointer + "." + crypto.randomUUID();
      fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, pointer);
    }
    const directory = path.join(root, session + "-" + digest(state.turn).slice(0, 16));
    return responseWithAdvice(base, input, [...(fresh ? [{ status: "ACTIVE", phases: ["guardrails", "context", "citations"] }] : []),
      ...(input.provider === "antigravity" ? feedback(directory) : [])]);
  }
  if (!state || !same(state.cwd, cwd) || (input.turn && input.turn !== state.turn)) return base;
  if (state.disabled) return responseWithAdvice(base, input, [{ status: "NOT_EVALUATED", reason: "private_or_unavailable_prompt" }]);
  if (typeof state.prompt !== "string" || state.prompt_hash !== digest(state.prompt) || sensitive(state.prompt)) return base;
  if (input.continued) return base;
  if (input.provider === "antigravity" && input.phase === "stop" &&
      (event.fullyIdle === false || (event.terminationReason && !["NO_TOOL_CALL", "TERMINAL_STEP_TYPE"].includes(event.terminationReason)))) {
    if (event.fullyIdle !== false) fs.writeFileSync(pointer, JSON.stringify({ ...state, closed: true }), { mode: 0o600 });
    return base;
  }
  const directory = path.join(root, session + "-" + digest(state.turn).slice(0, 16));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!inside(canonical(root), canonical(directory))) return base;
  const candidates = path.join(directory, "sources");
  fs.mkdirSync(candidates, { recursive: true, mode: 0o700 });
  if (!inside(canonical(directory), canonical(candidates))) return base;
  let rejectedSources = 0;
  for (const entry of sourcePaths(input, event, home)) {
    const candidate = entry.path;
    if ((!sourceExtension.test(candidate) && !privatePath(candidate)) || /[*?]/.test(candidate)) {
      if (entry.explicit || pathFields.some(field => input.args[field] === candidate)) rejectedSources++;
      continue;
    }
    const snapshot = sourceSnapshot(cwd, candidate, entry.line_start, entry.line_end);
    if (!snapshot) { rejectedSources++; continue; }
    if (fs.readdirSync(candidates).length >= 32 && !fs.existsSync(path.join(candidates, snapshot.id + ".json"))) {
      rejectedSources++; continue;
    }
    const marker = path.join(candidates, snapshot.id + ".json");
    try { fs.writeFileSync(marker, JSON.stringify({ path: snapshot.path, line_start: snapshot.line_start, line_end: snapshot.line_end }), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const advisor = options.advisor || require(path.join(home, "dely-compliance", "jev-advisor.js"));
  const context = options.taskContext;
  const confirmed = record(context) && context.session === input.session && context.turn === input.turn &&
    typeof context.repo === "string" && same(context.repo, cwd) &&
    ["request", "scope", "acceptance"].every(key => text(context[key]).trim()) &&
    ["spec_sha256", "context_sha256"].every(key => /^[a-f0-9]{64}$/.test(context[key])) &&
    Buffer.byteLength(JSON.stringify(context)) <= 8000 && !sensitive(JSON.stringify(context));
  const request = confirmed ? "Confirmed task: " + context.request + "\nConfirmed scope: " + context.scope +
    "\nAcceptance: " + context.acceptance + "\nLatest user message: " + state.prompt : state.prompt;
  async function evaluate(mode, payload) {
    const evaluationOptions = mode === "guardrails" ? { scopeConfirmed: Boolean(confirmed) } : {};
    const identity = digest(mode + JSON.stringify(payload) + JSON.stringify(evaluationOptions) +
      JSON.stringify(confirmed ? [context.spec_sha256, context.context_sha256] : null));
    const file = path.join(directory, "cache-" + identity + ".json");
    try {
      const saved = boundedFile(file, 32768);
      if (saved) return JSON.parse(saved);
    } catch {}
    if (fs.readdirSync(directory).length > 256) return { mode, status: "NOT_EVALUATED", reason: "turn_budget" };
    const lock = file + ".lock";
    let descriptor;
    try { descriptor = fs.openSync(lock, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") return { mode, status: "NOT_EVALUATED", reason: "duplicate_in_flight" };
      throw error;
    }
    try {
      const result = await advisor.advise(payload, mode, { repo: cwd, ...(options.advisorOptions || {}), ...evaluationOptions });
      const summary = { mode, status: result.status, input_sha256: result.input_sha256,
        policy: { mode: "advisory", calibration_status: "NOT_EVALUATED" }, ...(result.reason ? { reason: result.reason } : {}) };
      if (mode === "guardrails") summary.commands = result.commands?.map(command => ({ id: command.id, hazards: command.hazards }));
      if (mode === "context") summary.sources = result.ranked_context?.map(candidate => ({ id: candidate.id, path: candidate.path,
        line_start: candidate.line_start, line_end: candidate.line_end,
        relevance: candidate.relevance, confidence: candidate.confidence, probabilities: candidate.probabilities,
        sha256: candidate.sha256, passage_signals: candidate.passage_signals }));
      if (mode === "citations") summary.citations = result.citations?.map(citation => ({ id: citation.id,
        path: citation.path, source_sha256: citation.source_sha256, document_sha256: citation.document_sha256,
        judgment: citation.judgment, status: citation.status, evaluation_status: citation.evaluation_status,
        auto_accept: false, reason: citation.reason, confidence: citation.confidence, probabilities: citation.probabilities }));
      if (Buffer.byteLength(JSON.stringify(summary)) > 24000) return { mode, status: "NOT_EVALUATED", reason: "feedback_limit" };
      fs.writeFileSync(file, JSON.stringify(summary), { mode: 0o600, flag: "wx" });
      return summary;
    } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  }
  const evaluations = [];
  if (rejectedSources) evaluations.push(Promise.resolve({ mode: "context", status: "NOT_EVALUATED", reason: "ineligible_source", count: rejectedSources }));
  if (input.phase === "before") {
    const command = text(input.args.command || input.args.cmd || input.args.CommandLine);
    if (command) evaluations.push(sensitive(command) || /(?:^|\s)(?:export|set|\$env:)\s*\w+\s*=|(?:https?:\/\/)[^\s/]+@/i.test(command)
      ? Promise.resolve({ mode: "guardrails", status: "NOT_EVALUATED", reason: "private_command" })
      : evaluate("guardrails", { request, commands: [{ id: "pending", command,
        shell: text(input.args.shell) || (input.provider === "claude" && input.tool === "Bash" ? "bash" : "provider_default_on_" + process.platform), cwd }] }));
  }
  if (["before", "after"].includes(input.phase)) {
    const entries = fs.readdirSync(candidates);
    if (entries.length <= 32) {
      const sources = entries.map(name => {
        try {
          const entry = JSON.parse(boundedFile(path.join(candidates, name), 4096));
          return sourceSnapshot(cwd, entry.path, entry.line_start, entry.line_end);
        } catch { return null; }
      }).filter(Boolean);
      if (sources.length) evaluations.push(evaluate("context", { request, candidates: sources, passage_checks: true }));
    } else evaluations.push(Promise.resolve({ mode: "context", status: "NOT_EVALUATED", reason: "source_count_limit" }));
  }
  if (input.phase === "stop") {
    const message = input.assistant || transcriptMessage(event, "assistant", home);
    if (!message || sensitive(message) || Buffer.byteLength(message) > 32000) return base;
    const sources = [], citations = [], unresolved = [];
    let count = 0;
    for (const match of message.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
      if (++count > 32) { unresolved.push("citation_count_limit"); break; }
      const href = match[2].replace(/^<|>$/g, "");
      if (/^https?:|^mailto:/i.test(href)) continue;
      const start = message.lastIndexOf("\n", match.index) + 1, end = message.indexOf("\n", match.index);
      let claim = message.slice(start, end === -1 ? undefined : end);
      let before = message.slice(start, match.index).trim();
      if (/^>\s?/.test(before)) {
        const previous = message.slice(0, start).replace(/\r?\n$/, "").split("\n"), quoted = [];
        while (previous.length && /^>\s?/.test(previous.at(-1))) quoted.unshift(previous.pop());
        if (quoted.length) { const prefix = quoted.join("\n") + "\n"; before = prefix + before; claim = prefix + claim; }
      }
      if ([...claim.matchAll(/\[[^\]\n]+\]\([^)\n]+\)/g)].length > 1) { unresolved.push("compound_claim"); continue; }
      const located = citationInput(cwd, href, claim, before);
      if (located.reason) { unresolved.push(located.reason); continue; }
      if (located.finding) {
        evaluations.push(Promise.resolve({ mode: "citations", status: "REVIEW_REQUIRED",
          policy: { mode: "advisory", calibration_status: "NOT_EVALUATED" }, citations: [located.finding] }));
        continue;
      }
      const source = located.source;
      if (!sources.some(existing => existing.id === source.id)) sources.push(source);
      citations.push({ id: "citation-" + citations.length, source_id: source.id,
        claim, quote: located.quote });
    }
    if (citations.length && citations.length <= 32 && sources.length <= 32) evaluations.push(evaluate("citations", { request, sources, citations }));
    if (citations.length > 32 || sources.length > 32) evaluations.push(Promise.resolve({ mode: "citations", status: "NOT_EVALUATED", reason: "citation_count_limit" }));
    for (const reason of new Set(unresolved)) evaluations.push(Promise.resolve({ mode: "citations", status: "NOT_EVALUATED",
      reason, count: unresolved.filter(value => value === reason).length }));
  }
  const summaries = await Promise.all(evaluations);
  if (input.provider === "antigravity" && ["before", "after"].includes(input.phase)) {
    for (const summary of summaries) {
      const bytes = JSON.stringify(summary), file = path.join(directory, "feedback-" + digest(bytes) + ".json");
      try { fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
  }
  if (input.provider === "antigravity" && input.phase === "stop") {
    fs.writeFileSync(pointer, JSON.stringify({ ...state, closed: true }), { mode: 0o600 });
  }
  return responseWithAdvice(base, input, summaries);
}

async function main() {
  const { values } = parseArgs({ options: { provider: { type: "string" }, home: { type: "string" }, event: { type: "string" } } });
  const chunks = [], buffer = Buffer.alloc(16384);
  let total = 0, count;
  while ((count = fs.readSync(0, buffer, 0, buffer.length, null)) > 0) {
    total += count;
    if (total > 1024 * 1024) {
      process.stdout.write(JSON.stringify(values.provider === "antigravity" && values.event === "PreToolUse" ? { decision: "ask" } : {}) + "\n");
      return;
    }
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  const bytes = Buffer.concat(chunks);
  const event = JSON.parse(bytes.toString("utf8"));
  if (values.event) event.hook_event_name = values.event;
  const base = values.provider === "antigravity" && event.hook_event_name === "PreToolUse" ? { decision: "ask" } : {};
  let result;
  try {
    const home = canonical(path.resolve(values.home || process.env.CODEX_HOME || path.join(os.homedir(), ".codex")));
    const settings = JSON.parse(boundedFile(path.join(home, "dely-compliance", "settings.json"), 64000));
    for (const file of [__filename, settings.advisor]) {
      if (!file || !inside(home, canonical(file)) || !same(path.resolve(file), canonical(file)) ||
          digest(fs.readFileSync(file)) !== settings.dependencies?.[canonical(file)]) throw Error("Unverified workflow dependency");
    }
    result = await run(event, home, { provider: values.provider, base });
  }
  catch { result = { ...base, systemMessage: "Jev workflow NOT_EVALUATED: runtime_unavailable" }; }
  process.stdout.write(JSON.stringify(result) + "\n");
}

module.exports = { run, envelope, sourceSnapshot, sensitive };
if (require.main === module) main().catch(() => {
  process.stdout.write(JSON.stringify(process.argv.includes("antigravity") && process.argv.includes("PreToolUse") ? { decision: "ask" } : {}) + "\n");
});
