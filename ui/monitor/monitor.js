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

function renderMeasure(id, title, metric) {
  const card = element("article", null, "measure-card");
  card.id = `metric-${id}`;
  const head = element("div", null, "measure-head");
  const status = metric?.status || "NOT_EVALUATED";
  const ok = status === "EVALUATED";
  head.append(
    element("span", title, "measure-title"),
    element("span", status, "status " + (ok ? "success" : ""))
  );

  const hasDenominator = metric && typeof metric.denominator === "number" && metric.denominator > 0;
  const isEmptyDenominator = metric && typeof metric.denominator === "number" && metric.denominator === 0;
  const rateText = hasDenominator
    ? (metric.rate != null ? `${(metric.rate * 100).toFixed(1)}%` : "N/A")
    : (isEmptyDenominator || status === "EVALUATED" ? "N/A" : (status || "NOT_EVALUATED"));
  const ratioText = hasDenominator
    ? `${number(metric.numerator)} / ${number(metric.denominator)}`
    : (isEmptyDenominator || status === "EVALUATED" ? "N/A" : "N/A / NOT_EVALUATED");

  const main = element("div", null, "measure-main");
  const rateEl = element("div", rateText, "measure-rate" + (hasDenominator ? "" : " unknown"));
  rateEl.id = `${id}-rate`;
  const ratioEl = element("div", `Ratio: ${ratioText}`, "measure-ratio");
  ratioEl.id = `${id}-ratio`;
  main.append(rateEl, ratioEl);

  const details = element("div", null, "measure-details");
  const pendingCount = metric?.pending != null ? number(metric.pending) : "—";
  let coverageText = "—";
  if (metric?.coverage) {
    const evaluated = metric.coverage.evaluated != null ? number(metric.coverage.evaluated) : null;
    const total = metric.coverage.total != null ? number(metric.coverage.total) : null;
    if (evaluated != null && total != null) {
      coverageText = `${evaluated} / ${total}`;
      if (metric.coverage.unboundEvents != null) {
        coverageText += ` (${number(metric.coverage.unboundEvents)} unbound)`;
      }
    }
  }
  const asOfText = metric?.as_of ? String(metric.as_of) : "Not recorded";

  const pendingEl = element("div", `Pending: ${pendingCount}`, "measure-detail");
  pendingEl.id = `${id}-pending`;
  const coverageEl = element("div", `Coverage: ${coverageText}`, "measure-detail");
  coverageEl.id = `${id}-coverage`;
  const asOfEl = element("div", `As of: ${asOfText}`, "measure-detail mono");
  asOfEl.id = `${id}-as-of`;

  details.append(pendingEl, coverageEl, asOfEl);
  card.append(head, main, details);
  return card;
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
  const m = data.metrics || {};
  const agyNum = m.agyStart?.numerator;
  const agyDen = m.agyStart?.denominator;
  const hasAgyDen = typeof agyDen === "number" && agyDen > 0;
  $("adoption").textContent = hasAgyDen && m.agyStart?.rate != null ? `${(m.agyStart.rate * 100).toFixed(1)}%` : "N/A";
  const agyRatioText = hasAgyDen
    ? `${number(agyNum)} / ${number(agyDen)}`
    : (agyDen === 0 ? "N/A" : "—");
  const pendingText = data.pending != null ? `${number(data.pending)} awaiting start` : "— awaiting start";
  $("adoption-detail").textContent = `${agyRatioText} confirmed snapshots · ${pendingText}`;
  const acceptanceShare = m.agyAcceptedWithoutFallback?.denominator ?
    share(m.agyAcceptedWithoutFallback) :
    (m.agyAcceptedWithoutFallback?.status || "N/A (not observed)");
  $("snapshot-metrics").textContent = `AGY primary: ${share(m.agyPrimary || {})}. Luna fallback: ${share(m.lunaFallback || {})}. Control acceptance: ${acceptanceShare}. Window ${data.window.start} to ${data.window.end}; outcomes as of ${data.window.as_of}.`;
  $("approvals").textContent = number(log.present ? data.tasks.approved : null);
  $("approval-detail").textContent = `${log.present ? data.tasks.recorded : "No"} assessment records · ${data.tasks.unknown} unknown grades`;
  $("workers").textContent = number(orca.available ? data.jobs.count : null);
  $("worker-detail").textContent = orca.available ? `${data.jobs.succeeded} succeeded · ${data.jobs.failed} failed · ${data.jobs.active} active` : "Orca source is unavailable";
  $("sessions").textContent = number(codex.available ? data.conversations.sessions : null);
  $("session-detail").textContent = codex.available ? `${number(data.conversations.turns)} recorded Codex turns` : "Conversation source is unavailable";
  if ($("measures-grid")) {
    $("measures-grid").replaceChildren(
      renderMeasure("compliance", "Low-tier primary compliance", m.lowTierPrimaryCompliance),
      renderMeasure("correction", "Correction utilization", m.correctionUtilization),
      renderMeasure("acceptance", "AGY accepted without fallback", m.agyAcceptedWithoutFallback),
      renderMeasure("leakage", "Audited upward leakage", m.upwardLeakage)
    );
  }
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
  if (m.decisionEvidenceCoverage?.missingEffectiveEvents) gaps.push(`${m.decisionEvidenceCoverage.missingEffectiveEvents} approved assessments lack effective review evidence.`);
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
