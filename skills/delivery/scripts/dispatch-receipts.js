"use strict";

const fs = require("fs");
const path = require("path");
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);

function checked(repo, file) {
  const root = fs.realpathSync(repo), relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Receipt escaped its repository.");
  for (let entry = file; entry !== root; entry = path.dirname(entry)) {
    if (fs.lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error("Receipt links are not allowed.");
  }
  return file;
}

function record(repo, run, route, dispatch) {
  if (!id(run) || !id(dispatch.dispatchId) || route.run !== run || dispatch.run !== run ||
      path.relative(fs.realpathSync(repo), fs.realpathSync(route.repo)) !== "" ||
      path.relative(fs.realpathSync(repo), fs.realpathSync(dispatch.repo)) !== "") throw Error("Invalid dispatch receipt identity.");
  const directory = checked(repo, path.join(fs.realpathSync(repo), ".dely", "local", "runs", run, "receipts"));
  fs.mkdirSync(directory, { recursive: true });
  const file = checked(repo, path.join(directory, dispatch.dispatchId + ".json"));
  const { seconds, ...boundDispatch } = dispatch;
  const bytes = JSON.stringify({ schema: "dely-dispatch-v1", route, dispatch: boundDispatch }) + "\n";
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") !== bytes) throw Error("Existing dispatch receipt differs.");
  } else fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  return file;
}

function records(repo, run = null) {
  if (run !== null && !id(run)) throw Error("Invalid receipt Run.");
  const base = checked(repo, path.join(fs.realpathSync(repo), ".dely", "local", "runs"));
  const result = { runs: [], rows: [] };
  if (!fs.existsSync(base)) return result;
  for (const name of run === null ? fs.readdirSync(base).filter(id) : [run]) {
    const directory = checked(repo, path.join(base, name, "receipts"));
    if (!fs.existsSync(directory)) continue;
    result.runs.push(name);
    for (const name of fs.readdirSync(directory)) {
      if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) continue;
      const file = checked(repo, path.join(directory, name));
      try {
        if (fs.statSync(file).size > 256 * 1024) continue;
        const value = JSON.parse(fs.readFileSync(file, "utf8"));
        if (value.schema === "dely-dispatch-v1" && value.route?.event === "task_route" &&
            value.dispatch?.event === "dispatch" && value.route.run === value.dispatch.run &&
            path.basename(path.dirname(directory)) === value.dispatch.run &&
            name === value.dispatch.dispatchId + ".json" &&
            path.relative(fs.realpathSync(repo), fs.realpathSync(value.route.repo)) === "" &&
            path.relative(fs.realpathSync(repo), fs.realpathSync(value.dispatch.repo)) === "") {
          result.rows.push(value.route, value.dispatch);
        }
      } catch (_) { /* Incomplete or invalid receipts grant no admission. */ }
    }
  }
  return result;
}

module.exports = { record, records };
