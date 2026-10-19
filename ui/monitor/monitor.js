"use strict";

const $ = (id) => document.getElementById(id);
const names = { easy: "Easy", medium_minus: "Medium−", medium_plus: "Medium+", hard: "Hard" };
let activity = [], visibleRows = 25, taskRowsShown = 20, displayedScope = "";
let jevRows = [], jevShown = 25, jevScope = "";
const observationKey = "dely-monitor.observation-start";
let observationStart = null, storageWarning = "", refreshId = 0, loadingTimer = null;
try {
  const saved = localStorage.getItem(observationKey);
  if (saved && Number.isFinite(Date.parse(saved)) && new Date(saved).toISOString() === saved) observationStart = saved;
} catch (_) { storageWarning = "Browser storage is unavailable; window changes apply only until reload."; }

function observationStatus(data) {
  const active = data ? ` Active start: ${data.window.start}.` : "";
  $("observation-start").textContent = (observationStart
    ? `Statistics reset at ${observationStart}.${active} Limited by the selected rolling window.`
    : `Using selected rolling window.${active}`) + (storageWarning ? ` ${storageWarning}` : "");
  $("resume-window").hidden = !observationStart;
}

function setObservation(start) {
  observationStart = start;
  try {
    if (start) localStorage.setItem(observationKey, start);
    else localStorage.removeItem(observationKey);
    storageWarning = "";
  } catch (_) { storageWarning = "Browser storage is unavailable; this change may not survive reload."; }
  observationStatus();
  refresh();
}
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

function showJevRows() {
  const tbody = $("jev-rows"); tbody.replaceChildren();
  for (const row of jevRows.slice(0, jevShown)) {
    const view = jevPresentation(row);
    const tr = element("tr"), workspace = element("td");
    workspace.append(element("div", row.ts ? new Date(row.ts).toLocaleString() : "Unknown time"),
      element("div", row.repo || "Unknown workspace", "cell-secondary mono"));
    if (row.timeSource === "co-located assessment") workspace.append(element("div", "Time: co-located assessment", "cell-secondary"));
    const mode = element("td"); mode.append(element("div", row.mode), element("div", row.status, "cell-secondary"));
    if (row.policy) mode.append(element("div", row.policy, "cell-secondary"));
    const result = element("td"), details = element("details", null, "evidence-details");
    result.append(element("div", row.category === "valid" ? "Valid recorded output" : row.category.replace(/_/g, " ")));
    if (row.reason !== "NOT_RECORDED") result.append(element("div", row.reason, "cell-secondary"));
    details.append(element("summary", "Output, Control decision & provenance", "evidence-summary"));
    // Build large structured output only when expanded; use textContent throughout.
    details.addEventListener("toggle", () => {
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = "true";
      details.append(element("p", row.output ? "Original Jev structured output" : "Jev output unavailable in saved artifacts", "cell-secondary"));
      if (row.output) details.append(element("pre", JSON.stringify(row.output, null, 2), "jev-output"));
      if (row.mode === "skill") {
        details.append(element("p", "Recorded suggested skills and policy (names are not inferred from probability ids)", "cell-secondary"));
        details.append(element("pre", row.suggestions === null ? "Suggestions not recorded" : JSON.stringify(row.suggestions, null, 2), "jev-output"));
        if (row.selection) details.append(element("pre", JSON.stringify(row.selection, null, 2), "jev-output"));
      }
      details.append(element("p", "Control reviewed routing decision (separate from Jev)", "cell-secondary"));
      details.append(element("pre", view.review, "jev-output"));
      for (const source of row.sources) details.append(element("div", `${source.home}/dely-compliance/tasks/${source.task}/${source.file}`, "mono cell-secondary"));
    });
    result.append(details);
    tr.append(workspace, mode, element("td", view.model, "mono"), element("td", view.proposal), result);
    tbody.append(tr);
  }
  if (!jevRows.length) {
    const td = element("td", "No saved Jev records match these filters; source coverage does not establish complete API history.", "empty-cell");
    td.colSpan = 5; const tr = element("tr"); tr.append(td); tbody.append(tr);
  }
  $("jev-more").hidden = jevShown >= jevRows.length;
}

function renderJev(data) {
  const source = data.sources.jev, stats = data.jev;
  const pending = !source || ["loading", "refreshing"].includes(source.state);
  $("jev-count").textContent = pending ? "Reading saved evidence…" : `${stats.recorded} unique records`;
  $("jev-summary").textContent = pending && !source?.available ? "Reading saved evaluations in the background…" :
    `${stats.evaluations} recorded evaluations · ${stats.valid} valid outputs · ${stats.errors} recorded errors · ${stats.notEvaluated} advice not evaluated · ${stats.skipped} Hard/direct skips · ${stats.notApplicable} not applicable · ${stats.unknown} unknown. ${stats.unknownTime} unknown time · ${stats.unknownWorkspace} unknown workspace.${pending ? " Refreshing; last available values shown." : ""}`;
  const reasons = $("jev-reasons"); reasons.replaceChildren();
  for (const group of stats.reasons) reasons.append(element("p", `${group.mode} · ${group.category.replace(/_/g, " ")} · ${group.reason}: ${group.count}`, "footnote mono"));
  if (!stats.reasons.length) reasons.append(element("p", "No saved reasons match these filters.", "footnote"));
  const coverage = $("jev-coverage"); coverage.replaceChildren();
  coverage.append(element("p", `Source state: ${source?.state || "NOT_EVALUATED"}. Filtered modes: task ${stats.modes.task}, skill ${stats.modes.skill}, context ${stats.modes.context}. Absent advisor modes have unknown coverage, not zero API use.`, "footnote"));
  for (const s of source?.coverage || []) {
    coverage.append(element("p", `${s.home}: ${s.state} · ${s.directories} task folders · ${s.loaded} readable artifacts (includes review/copy files) · ${s.missing} missing assessments · ${s.malformed} malformed · ${s.unreadable} unreadable · ${s.oversized} oversized · ${s.excluded} excluded links · ${s.truncated ? "directory cap reached" : "within directory cap"}. Saved modes: task ${s.modes.task}, skill ${s.modes.skill}, context ${s.modes.context}.`, "footnote mono"));
  }
  coverage.append(element("p", "Only immediate assessment.json, reviewed.json, skill-advice.json and context-advice.json in the two compliance task homes are read (256 KiB/file, 4096 folders/home). Other saved locations and unsaved calls are NOT_EVALUATED. Advisor workspace/time comes from its co-located assessment when absent; it is not measured request timing.", "footnote"));
  const scope = JSON.stringify([$("days").value, $("repo").value, $("probes").checked, $("jev-mode").value, observationStart]);
  if (scope !== jevScope) { jevShown = 25; jevScope = scope; }
  jevRows = stats.rows; showJevRows();
}

function render(data) {
  renderJev(data);
  observationStatus(data);
  const scope = JSON.stringify([$("repo").value, $("days").value, $("probes").checked, observationStart]);
  if (scope !== displayedScope) { displayedScope = scope; visibleRows = 25; taskRowsShown = 20; }
  renderProjects(data);
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
  const acceptanceShare = share(m.agyAcceptedWithoutFallback || {});
  $("snapshot-metrics").textContent = `AGY primary: ${share(m.agyPrimary || {})}. Luna fallback: ${share(m.lunaFallback || {})}. Control acceptance: ${acceptanceShare}. Window ${data.window.start} to ${data.window.end}; outcomes as of ${data.window.as_of}.`;
  $("approvals").textContent = number(log.present ? data.tasks.approved : null);
  $("approval-detail").textContent = `${log.present ? data.tasks.recorded : "No"} assessment records · ${data.tasks.unknown} unknown grades`;
  $("workers").textContent = number(orca.available ? data.jobs.count : null);
  $("worker-detail").textContent = sourceProgress(orca) ? "Reading worker inventory…" : orca.available ? `${data.jobs.succeeded} succeeded · ${data.jobs.failed} failed · ${data.jobs.active} active` : "Orca source is unavailable";
  $("sessions").textContent = number(codex.available ? data.conversations.sessions : null);
  $("session-detail").textContent = sourceProgress(codex) ? "Reading conversation metadata…" : codex.available ? `${number(data.conversations.turns)} recorded Codex turns` : "Conversation source is unavailable";
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
    sourceRow("Orca workers", sourceProgress(orca) ? "Reading worker inventory; last available values stay visible" : orca.available ? `${orca.loaded} / ${orca.total ?? "unknown"} records · ${orca.scope || "unknown scope"}` : "Local Orca connection unavailable", sourceProgress(orca) || (orca.available ? orca.complete ? "Complete page set" : "Partial" : "Unavailable"), orca.available && orca.complete && !sourceProgress(orca)),
    sourceRow("Codex conversations", sourceProgress(codex) ? "Reading conversation metadata; last available values stay visible" : codex.available ? `${codex.files} local rollout files · ${codex.malformed} unreadable lines` : "Local conversation metadata unavailable", sourceProgress(codex) || (codex.available ? "Available" : "Unavailable"), codex.available && !sourceProgress(codex)));
  const gaps = [];
  if (data.refreshError) gaps.push(`${data.refreshError}.`);
  if (data.refreshing) gaps.push(`Updating sources in the background. ${data.stale ? "Last available values are shown until refreshed." : "Dely records are ready; other source records will appear as they load."}`);
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
  if (selected && !data.repos.includes(selected)) {
    const option = element("option", selected + " (source pending or unavailable)"); option.value = selected; $("repo").append(option);
  }
  $("repo").firstElementChild.value = ""; $("repo").value = selected;
  activity = data.activity; showRows();
  $("updated").textContent = `${data.refreshing ? "Updating · snapshot" : data.refreshError ? "Previous snapshot" : "Updated"} ${new Date(data.collectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function sourceProgress(source) {
  return source.state === "loading" ? "Reading…" : source.state === "refreshing" ? "Updating…" : "";
}

function renderProjects(data) {
  const selected = $("repo").value;
  $("projects").hidden = !!selected;
  $("project-list").hidden = !!selected;
  $("project-details").hidden = !selected;
  const available = data.projects || [];
  const logAvailable = !!data.sources?.log?.present;
  const orcaAvailable = !!data.sources?.orca?.available;
  const codexAvailable = !!data.sources?.codex?.available;

  const projectRows = $("project-rows");
  projectRows.replaceChildren();

  if (!available.length) {
    const emptyTr = element("tr");
    const emptyTd = element("td", "No projects observed in this time/probe window.", "empty-cell");
    emptyTd.colSpan = 8;
    emptyTr.append(emptyTd);
    projectRows.append(emptyTr);
  } else {
    for (const p of available) {
      const tr = element("tr");

      // Column 1: Project & Full Path
      const tdProject = element("td");
      const btn = element("button", p.name || p.repo || "Unnamed project", "project-open-link");
      btn.type = "button";
      btn.setAttribute("aria-label", `Open project ${p.name || p.repo} at ${p.repo}`);
      btn.setAttribute("title", p.repo);
      btn.setAttribute("aria-pressed", String(p.repo === selected));
      btn.addEventListener("click", () => { $("repo").value = p.repo; refresh(); });

      const pathDiv = element("div", p.repo || "Unknown path", "mono project-path");
      tdProject.append(btn, pathDiv);

      // Column 2: Snapshots (numeric)
      const tdSnapshots = element("td", null, "num");
      if (logAvailable) {
        tdSnapshots.textContent = number(p.snapshots);
      } else {
        tdSnapshots.textContent = "N/A";
        tdSnapshots.classList.add("unknown");
      }

      // Column 3: AGY Start (numeric)
      const tdAgy = element("td", null, "num");
      if (logAvailable) {
        if (p.agyStart && p.agyStart.denominator) {
          const rateDiv = element("div", `${(p.agyStart.rate * 100).toFixed(1)}%`, "cell-primary");
          const countDiv = element("div", `(${p.agyStart.numerator}/${p.agyStart.denominator})`, "cell-secondary mono");
          tdAgy.append(rateDiv, countDiv);
        } else {
          tdAgy.append(
            element("div", "N/A", "cell-primary unknown"),
            element("div", "(0/0 observed)", "cell-secondary mono")
          );
        }
      } else {
        tdAgy.textContent = "N/A";
        tdAgy.classList.add("unknown");
      }

      // Column 4: Approvals / Pending (numeric)
      const tdApprovals = element("td", null, "num");
      if (logAvailable) {
        const approved = p.tasks?.approved ?? 0;
        const pending = p.pending ?? 0;
        const primary = element("div", `${approved} / ${pending}`, "cell-primary");
        const secondary = element("div", `${p.tasks?.recorded ?? 0} rec${p.tasks?.unknown ? `, ${p.tasks.unknown} unk` : ""}`, "cell-secondary");
        tdApprovals.append(primary, secondary);
      } else {
        tdApprovals.textContent = "N/A";
        tdApprovals.classList.add("unknown");
      }

      // Column 5: Attempts / Fallbacks (numeric)
      const tdAttempts = element("td", null, "num");
      if (logAvailable) {
        const fallbacks = (p.models || []).reduce((n, m) => n + (m.fallbacks || 0), 0);
        const primary = element("div", `${p.launches ?? 0} / ${fallbacks}`, "cell-primary");
        tdAttempts.append(primary);
      } else {
        tdAttempts.textContent = "N/A";
        tdAttempts.classList.add("unknown");
      }

      // Column 6: Effective Models
      const tdModels = element("td");
      if (logAvailable) {
        const models = p.models || [];
        if (models.length) {
          const fullText = models.map((m) => `${m.model}: ${m.launches}`).join(", ");
          if (models.length > 1 && (models.length > 2 || fullText.length > 36)) {
            const details = element("details", null, "compact-details");
            const summary = element("summary", `${models[0].model}: ${models[0].launches} (+${models.length - 1} more)`, "compact-summary");
            const content = element("div", fullText, "details-content mono");
            details.append(summary, content);
            tdModels.append(details);
          } else {
            tdModels.textContent = fullText;
          }
        } else {
          tdModels.textContent = "Unknown / no launch evidence";
          tdModels.classList.add("unknown");
        }
      } else {
        tdModels.textContent = "N/A";
        tdModels.classList.add("unknown");
      }

      // Column 7: Orca Workers
      const tdWorkers = element("td");
      if (orcaAvailable) {
        const count = p.jobs?.count ?? 0;
        const primary = element("div", `${count} worker${count === 1 ? "" : "s"}`, "cell-primary");
        const states = (p.jobs?.states || []).map((s) => `${s.status}: ${s.count}`).join(", ");
        const secondary = element("div", states || "No states recorded", "cell-secondary");
        tdWorkers.append(primary, secondary);
      } else {
        tdWorkers.textContent = "N/A";
        tdWorkers.classList.add("unknown");
      }

      // Column 8: Codex Conversations
      const tdCodex = element("td");
      if (codexAvailable) {
        const sessions = p.conversations?.sessions ?? 0;
        const turns = p.conversations?.turns ?? 0;
        const primary = element("div", `${sessions} session${sessions === 1 ? "" : "s"}`, "cell-primary");
        const secondary = element("div", `${turns} turn${turns === 1 ? "" : "s"}`, "cell-secondary");
        tdCodex.append(primary, secondary);
      } else {
        tdCodex.textContent = "N/A";
        tdCodex.classList.add("unknown");
      }

      tr.append(tdProject, tdSnapshots, tdAgy, tdApprovals, tdAttempts, tdModels, tdWorkers, tdCodex);
      projectRows.append(tr);
    }
  }

  $("project-coverage").textContent = `${available.length} projects in the active time/probe window. ${data.unassigned?.records || 0} unassigned/unknown project records across that window; never attributed to the selected project. Source coverage is shared with the panels below.`;
  $("project-title").textContent = `Tasks and launch evidence · ${selected || "All workspaces"}`;

  const tasks = data.taskDetails || [];
  let shown = taskRowsShown;

  function showTasks() {
    $("task-list").replaceChildren();

    const countP = element("p", `Showing ${Math.min(shown, tasks.length)} of ${tasks.length} task / worker records`, "panel-caption");
    countP.id = "task-records-count";

    if (!tasks.length) {
      const emptyP = element("p", "No task or launch evidence in this window. Conversation-only projects have no implied implementation tasks.", "empty");
      $("task-list").append(countP, emptyP);
      return;
    }

    const scrollContainer = element("div", null, "table-scroll");
    scrollContainer.tabIndex = 0;
    scrollContainer.setAttribute("role", "region");
    scrollContainer.setAttribute("aria-label", "Task records table");

    const table = element("table", null, "compact-table task-table");
    const thead = element("thead");
    const headerTr = element("tr");

    const thHeaders = [
      "Task / Identity",
      "Grade / Domain",
      "First Implementation",
      "Status",
      "Time",
      "Evidence & Attempts"
    ];

    for (const h of thHeaders) {
      const th = element("th", h);
      th.setAttribute("scope", "col");
      headerTr.append(th);
    }
    thead.append(headerTr);

    const tbody = element("tbody");
    tbody.id = "task-rows";

    for (const t of tasks.slice(0, shown)) {
      const tr = element("tr");

      // Column 1: Task / Identity
      const td1 = element("td");
      const titleDiv = element("strong", t.task_title || "Missing frozen task title", "task-title");
      titleDiv.title = t.task_title || "Missing frozen task title";
      const idDiv = element("div", t.id, "mono task-id");
      idDiv.title = t.id;
      idDiv.setAttribute("aria-label", `Task ID: ${t.id}`);
      const repoDiv = element("div", t.repo || "Unknown project", "task-repo mono");
      repoDiv.title = t.repo || "Unknown project";
      repoDiv.setAttribute("aria-label", `Project: ${t.repo || "Unknown project"}`);
      td1.append(titleDiv, idDiv, repoDiv);
      if (t.confirmedSnapshot && !t.inSnapshotWindow) {
        td1.append(element("div", "Historical first snapshot outside this window; attempts below do not add a snapshot.", "note-tag"));
      }

      // Column 2: Grade / Domain
      const td2 = element("td");
      const gradePrefix = t.confirmedSnapshot ? "First snapshot" : "Approved";
      const gradeName = names[t.grade] || "Unknown";
      const gradeDiv = element("div", `${gradePrefix} grade: ${gradeName}`, "cell-primary");
      const domainDiv = element("div", t.domain ? `Domain: ${t.domain}` : "Domain: —", "cell-secondary");
      td2.append(gradeDiv, domainDiv);

      // Column 3: First Confirmed Implementation
      const td3 = element("td");
      if (t.firstImplementation) {
        const modelDiv = element("div", t.firstImplementation.model || "Unknown model", "cell-primary");
        const effortDiv = element("div", `Effort: ${t.firstImplementation.effort || "Unknown"}`, "cell-secondary");
        td3.append(modelDiv, effortDiv);
      } else {
        td3.textContent = "—";
        td3.classList.add("unknown");
      }

      // Column 4: Status
      const td4 = element("td");
      const statusSpan = element("span", t.status || "Unknown", "status");
      if (t.status === "succeeded") statusSpan.classList.add("success");
      else if (t.status === "failed") statusSpan.classList.add("failed");
      else if (["running", "starting", "queued", "Launch observed"].includes(t.status)) statusSpan.classList.add("active");
      td4.append(statusSpan);

      // Column 5: Time
      const td5 = element("td", null, "mono cell-time");
      td5.textContent = t.ts || "Unknown time";

      // Column 6: Evidence & Attempts (Native details/summary)
      const td6 = element("td");
      const details = element("details", null, "evidence-details");
      const attemptsCount = t.attempts ? t.attempts.length : 0;
      const summaryText = `${attemptsCount} attempt${attemptsCount === 1 ? "" : "s"}${t.latestApproval ? " · assessment" : ""}`;
      const summary = element("summary", summaryText, "evidence-summary");
      details.append(summary);

      if (t.latestApproval) {
        const la = t.latestApproval;
        const laGrade = names[la.grade] || "Unknown";
        const laStatus = la.status === "APPROVED" ? "Approved" : "Proposed, unapproved";
        const laDiv = element("div", `Latest assessment: ${la.status || "Unknown"} · ${laStatus} grade: ${laGrade} · ${la.ts || "Unknown time"}`, "latest-assessment");
        details.append(laDiv);
      }

      if (t.attempts && t.attempts.length) {
        for (const a of t.attempts) {
          const attemptText = `${a.id} · ${a.source} · ${a.model || "Unknown model"} / ${a.effort || "Unknown effort"} · ${a.status} · Fallback: ${a.fallback || "Not recorded"} · ${a.bound ? "Bound snapshot evidence" : "Binding not confirmed"} · ${a.ts || "Unknown time"}`;
          const attemptDiv = element("div", attemptText, "attempt mono");
          details.append(attemptDiv);
        }
      } else if (!t.latestApproval) {
        details.append(element("div", "No attempt or assessment evidence recorded", "cell-secondary"));
      }
      td6.append(details);

      tr.append(td1, td2, td3, td4, td5, td6);
      tbody.append(tr);
    }

    table.append(thead, tbody);
    scrollContainer.append(table);
    $("task-list").append(countP, scrollContainer);

    if (shown < tasks.length) {
      const more = element("button", "Show more task records", "button");
      more.type = "button";
      more.id = "show-more-tasks";
      more.style.marginTop = "14px";
      more.addEventListener("click", () => {
      shown += 20; taskRowsShown = shown;
        showTasks();
      });
      $("task-list").append(more);
    }
  }

  showTasks();
}

async function refresh() {
  clearTimeout(loadingTimer);
  const requestId = ++refreshId;
  $("refresh").disabled = true; $("updated").textContent = "Reading local sources…";
  try {
    const query = new URLSearchParams({ days: $("days").value, repo: $("repo").value, probes: String($("probes").checked), jevMode: $("jev-mode").value, progressive: "true" });
    if (observationStart) query.set("since", observationStart);
    const response = await fetch(`/api/usage?${query}`); if (!response.ok) throw new Error("Local monitor source is temporarily unavailable");
    const data = await response.json();
    if (requestId === refreshId) {
      render(data);
      if (data.refreshing) loadingTimer = setTimeout(() => { if (requestId === refreshId) refresh(); }, 1000);
    }
  } catch (e) { if (requestId === refreshId) { $("notice").textContent = e.message; $("updated").textContent = "Refresh failed"; } }
  finally { if (requestId === refreshId) $("refresh").disabled = false; }
}
$("reset-statistics").addEventListener("click", () => setObservation(new Date().toISOString()));
$("resume-window").addEventListener("click", () => setObservation(null));
$("refresh").addEventListener("click", refresh);
$("all-projects").addEventListener("click", () => { $("repo").value = ""; refresh(); });
for (const id of ["days", "repo", "probes", "jev-mode"]) $(id).addEventListener("change", refresh);
$("more").addEventListener("click", () => { visibleRows += 50; showRows(); });
$("jev-more").addEventListener("click", () => { jevShown += 25; showJevRows(); });
window.addEventListener("pagehide", () => clearTimeout(loadingTimer));
window.addEventListener("pageshow", (event) => { if (event.persisted) refresh(); });
observationStatus();
refresh();
