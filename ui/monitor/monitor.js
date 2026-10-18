"use strict";

const $ = (id) => document.getElementById(id);
const names = { easy: "Easy", medium_minus: "Medium−", medium_plus: "Medium+", hard: "Hard" };
let activity = [], visibleRows = 25;
const number = (value) => value == null ? "—" : value.toLocaleString();
const modelName = (value) => value ? value.replace("gemini-3.8-flash-medium", "Gemini Flash Medium").replace("gemini-3.8-flash-high", "Gemini Flash High").replace("claude-sonnet-5-5-high", "Sonnet 5.5 High").replace("gpt-6.1-sol", "GPT-6.1 Sol").replace("gpt-6-luna", "GPT-6 Luna") : "Unknown";
const element = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

function bars(target, rows, field, emptyTitle, emptyDetail) {
  target.replaceChildren();
  const total = rows.reduce((sum, r) => sum + r[field], 0);
  if (!total) { const box = element("div", null, "empty"); box.append(element("strong", emptyTitle), element("span", emptyDetail)); target.append(box); return; }
  for (const row of rows) {
    const wrap = element("div", null, "bar-row"), label = element("div", null, "bar-label");
    label.append(element("span", modelName(row.model)), element("small", `${number(row[field])} · ${(row[field] / total * 100).toFixed(1)}%`));
    const track = element("div", null, "bar-track"), fill = element("div", null, "bar-fill");
    fill.style.width = `${row[field] / total * 100}%`; track.append(fill); wrap.append(label, track); target.append(wrap);
  }
}

function sourceRow(label, detail, status, ok) {
  const row = element("div", null, "source-row"), text = element("div", label);
  text.append(element("small", detail)); row.append(text, element("span", status, "status " + (ok ? "success" : ""))); return row;
}

function showRows() {
  const tbody = $("activity-rows"); tbody.replaceChildren();
  for (const row of activity.slice(0, visibleRows)) {
    const tr = element("tr"), workspace = element("td");
    workspace.title = row.repo || "Unknown workspace";
    workspace.append(element("span", row.repo ? row.repo.replace(/\\/g, "/").split("/").filter(Boolean).pop() : "Unknown workspace", "workspace-name"), element("span", row.id, "mono"));
    tr.append(workspace, element("td", names[row.grade] || "Unclassified", row.grade ? "" : "unknown"), element("td", modelName(row.model), row.model ? "" : "unknown"));
    const state = element("td"); state.append(element("span", row.status, "status " + (row.status === "succeeded" ? "success" : row.status === "failed" ? "failed" : ["running", "starting", "queued"].includes(row.status) ? "active" : "")));
    tr.append(state, element("td", row.fallback ? `${row.source} · ${row.fallback}` : row.source), element("td", row.ts ? new Date(row.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not recorded", row.ts ? "" : "unknown"));
    tbody.append(tr);
  }
  if (!activity.length) { const tr = element("tr"), td = element("td", "No activity records match these filters.", "unknown"); td.colSpan = 6; tr.append(td); tbody.append(tr); }
  $("more").hidden = activity.length <= visibleRows;
  $("activity-count").textContent = `${number(activity.length)} records`;
}

function render(data) {
  const log = data.sources.log, orca = data.sources.orca, codex = data.sources.codex;
  const share = (r) => r.rate == null ? "N/A" : `${(r.rate * 100).toFixed(1)}% (${r.numerator}/${r.denominator})`;
  $("adoption").textContent = data.metrics.agyStart.rate == null ? "N/A" : `${(data.metrics.agyStart.rate * 100).toFixed(1)}%`;
  $("adoption-detail").textContent = `${data.metrics.agyStart.numerator} / ${data.metrics.agyStart.denominator} confirmed snapshots · ${data.pending} awaiting start`;
  $("snapshot-metrics").textContent = `AGY primary: ${share(data.metrics.agyPrimary)}. Luna fallback: ${share(data.metrics.lunaFallback)}. Control acceptance: N/A (not observed). Window ${data.window.start} to ${data.window.end}; outcomes as of ${data.window.as_of}.`;
  $("approvals").textContent = number(log.present ? data.tasks.approved : null);
  $("approval-detail").textContent = `${log.present ? data.tasks.recorded : "No"} assessment records · ${data.tasks.unknown} unknown grades`;
  $("workers").textContent = number(orca.available ? data.jobs.count : null);
  $("worker-detail").textContent = orca.available ? `${data.jobs.succeeded} succeeded · ${data.jobs.failed} failed · ${data.jobs.active} active` : "Orca source is unavailable";
  $("sessions").textContent = number(codex.available ? data.conversations.sessions : null);
  $("session-detail").textContent = codex.available ? `${number(data.conversations.turns)} recorded Codex turns` : "Conversation source is unavailable";
  bars($("implementation-chart"), data.models, "launches", "No Dely launch records yet", log.enabled ? "New acknowledged launches will appear when they are logged." : "Local logging is not enabled. Historical Orca rows still appear below.");
  bars($("conversation-chart"), data.conversations.models, "turns", "No Codex turns in this window", "Change the time window or workspace filter.");
  $("launch-count").textContent = `${data.models.reduce((n, r) => n + r.launches, 0)} logged launches`;
  $("grade-grid").replaceChildren(...data.tasks.grades.map((r) => {
    const box = element("div", null, "grade");
    box.append(element("p", names[r.grade]), element("b", log.present ? number(r.count) : "—"), element("small", r.grade === "hard" ? "Sol · direct" : r.grade === "medium_plus" ? "Sol · no fallback" : "Flash → Luna")); return box;
  }));
  $("sources").replaceChildren(
    sourceRow("Dely activity log", log.present ? `${log.malformed} unreadable lines · local metadata` : "No activity log has been recorded", log.present ? "Available" : log.enabled ? "Waiting for events" : "Not enabled", log.present),
    sourceRow("Orca workers", orca.available ? `${orca.loaded} / ${orca.total ?? "unknown"} records · ${orca.scope || "unknown scope"}` : "Local Orca connection unavailable", orca.available ? orca.complete ? "Complete page set" : "Partial" : "Unavailable", orca.available && orca.complete),
    sourceRow("Codex conversations", codex.available ? `${codex.files} local rollout files · ${codex.malformed} unreadable lines` : "Local conversation metadata unavailable", codex.available ? "Available" : "Unavailable", codex.available));
  const gaps = [];
  if (!log.present) gaps.push("Snapshot shares become available after bound assessments and confirmed launches are logged.");
  if (data.coverage.history !== "COMPLETE") gaps.push("Retained journal history is not verified complete; shares describe observed snapshots only.");
  if (data.coverage.unbound || data.coverage.conflicting) gaps.push(`${data.coverage.unbound} unbound launches; ${data.coverage.conflicting} conflicting receipts excluded.`);
  if (data.coverage.unidentified || data.coverage.unknownPhase) gaps.push(`${data.coverage.unidentified} receipts lack identity; ${data.coverage.unknownPhase} launches lack phase evidence.`);
  if (data.coverage.runtimeUnknown) gaps.push(`${data.coverage.runtimeUnknown} cohort snapshots have unverified runtime fingerprints.`);
  if (data.jobs.unknownModel) gaps.push(`${data.jobs.unknownModel} Orca workers have no recorded model; they are not assigned to a model by guesswork.`);
  if (!orca.complete) gaps.push("Orca inventory is partial or unavailable.");
  $("notice").textContent = gaps.length ? gaps.join(" ") : "Available source records are loaded. Shares describe the confirmed snapshot cohort.";
  $("notice").classList.toggle("good", !gaps.length);
  const selected = $("repo").value;
  $("repo").replaceChildren(element("option", "All workspaces"), ...data.repos.map((repo) => { const o = element("option", repo); o.value = repo; return o; }));
  $("repo").firstElementChild.value = ""; $("repo").value = selected;
  activity = data.activity; visibleRows = 25; showRows();
  $("updated").textContent = `Updated ${new Date(data.collectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

async function refresh() {
  $("refresh").disabled = true; $("updated").textContent = "Reading local sources…";
  try {
    const query = new URLSearchParams({ days: $("days").value, repo: $("repo").value, probes: String($("probes").checked) });
    const response = await fetch(`/api/usage?${query}`); if (!response.ok) throw new Error("Local monitor source is temporarily unavailable");
    render(await response.json());
  } catch (e) { $("notice").textContent = e.message; $("updated").textContent = "Refresh failed"; }
  finally { $("refresh").disabled = false; }
}
$("refresh").addEventListener("click", refresh);
for (const id of ["days", "repo", "probes"]) $(id).addEventListener("change", refresh);
$("more").addEventListener("click", () => { visibleRows += 50; showRows(); });
refresh();
