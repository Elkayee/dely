"use strict";

const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { spawn } = require("node:child_process"), { once } = require("node:events");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

test("two real processes cannot replace the winner's pending fallback or launch twice", async (t) => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dely-network-race-")));
  const children = [];
  t.after(() => {
    for (const c of children) if (c.exitCode === null) c.kill();
    assert.ok(path.basename(repo).startsWith("dely-network-race-"));
    fs.rmSync(repo, { recursive: true, force: true });
  });
  const helper = path.resolve(__dirname, "../skills/delivery/scripts/dely.js");
  const run = "run_race", folder = path.join(repo, ".dely/local/runs", run), spec = "Bounded synthetic race fixture.\n";
  fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(repo, "spec.md"), spec);
  fs.writeFileSync(path.join(folder, "pending-start.json"), JSON.stringify({ repo, run, phase: "implement",
    sourceSha256: sha(spec), contextSha256: sha("context"), assessmentBasisSha256: sha("basis"),
    pin: { agent: "antigravity", model: "gemini-3.8-flash-medium", effort: "default" },
    submissionAttempted: false, failed: true, transportFailure: { source: "orca_adapter", code: "ECONNRESET", operation: "repo add" } }));
  const program = path.join(repo, "child.cjs");
  fs.writeFileSync(program, `
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),{createRequire}=require('module');
const [helper,repo]=process.argv.slice(2),r=createRequire(helper),routing=r('./task-routing.js');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const decision={difficulty:'medium_minus',route:routing.route('medium_minus'),task:{spec_sha256:sha(fs.readFileSync(path.join(repo,'spec.md'))),context_sha256:sha('context')},assessment_basis_sha256:sha('basis'),review:{source:'control-evidence'}};
const source=fs.readFileSync(helper,'utf8');
const c=vm.createContext({require:p=>p==='./task-routing.js'?{...routing,requireApprovedRoute:()=>decision}:r(p),__dirname:path.dirname(helper),__filename:helper,Buffer,TextDecoder,process:{platform:'win32',pid:process.pid,env:{},once:process.once.bind(process),removeListener:process.removeListener.bind(process),exit:process.exit.bind(process)},console});
vm.runInContext(source.slice(0,source.indexOf('const [cmd, ...rest] = process.argv.slice(2);')),c);
c.pin=()=>({agent:'codex',model:'gpt-6-luna',effort:'max'});c.requireHandle=c.restoreControlFocus=c.recordOwnedSnapshot=c.logEvent=()=>{};
let marker;
c.start=(_,run,p,prompt)=>{
 marker=prompt.match(/rcpt_[a-f0-9]{16}/)[0];c.updatePendingStart(repo,run,{id:'ctx_winner',terminalHandle:'term_winner'});
 process.stdout.write('LAUNCH\\n');const deadline=Date.now()+10000;
 while(!fs.existsSync(path.join(repo,'release'))&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 return {id:'ctx_winner',terminalHandle:'term_winner'};
};
c.orca=()=>({result:{messages:[{type:'heartbeat',dispatchId:'ctx_winner',from_handle:'term_winner',subject:marker}]}});
c.dispatch({repo,run:'run_race',phase:'implement','spec-file':'spec.md',fallback:'network'});
`);
  const first = spawn(process.execPath, [program, helper, repo], { stdio: ["ignore", "pipe", "pipe"] }); children.push(first);
  const firstExit = once(first, "exit");
  const started = await once(first.stdout, "data"); assert.match(String(started[0]), /LAUNCH/);
  const second = spawn(process.execPath, [program, helper, repo], { stdio: ["ignore", "pipe", "pipe"] }); children.push(second);
  let output = ""; second.stdout.on("data", (b) => output += b);
  const [code] = await once(second, "exit");
  assert.equal(code, 8); assert.match(output, /another dispatch\/recovery/); assert.doesNotMatch(output, /LAUNCH/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "pending-start.json"), "utf8")).id, "ctx_winner");
  assert.ok(fs.readdirSync(folder).some((f) => f.startsWith("fallback-stage-1-")));
  fs.writeFileSync(path.join(repo, "release"), "continue");
  assert.equal((await firstExit)[0], 0);
  assert.ok(!fs.existsSync(path.join(folder, "dispatch.lock")));
});
