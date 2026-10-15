import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runtimeFor } from "../src/contract/effort.ts";
import type { Contract } from "../src/contract/schema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../bin/pi-harness.ts");
const fauxExt = path.resolve(here, "fixtures/faux-ext.ts");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-e2e-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const GOAL = "@value.txt must say ok -- fix it\n  (keep \"quotes\" and 한국어)";
const CHECK_JS = `const fs = require("node:fs");
const v = fs.readFileSync("value.txt", "utf8").trim();
if (v === "ok") { console.log("value ok"); process.exit(0); }
console.log("value is bad: " + v); process.exit(1);
`;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

type Sandbox = { dir: string; repo: string; runDir: string; sessions: string; contractFile: string; env: NodeJS.ProcessEnv };

function sandbox(name: string): Sandbox {
  const dir = path.join(tmp, name);
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo, { recursive: true });
  for (const d of ["home", "agent", "sessions"]) fs.mkdirSync(path.join(dir, d));
  fs.writeFileSync(path.join(repo, "check.js"), CHECK_JS);
  fs.writeFileSync(path.join(repo, "value.txt"), "bad\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env: { ...process.env, ...gitEnv }, stdio: "ignore" });
  git("init", "-q", ".");
  git("add", "-A");
  git("commit", "-qm", "init");
  const runDir = path.join(dir, "run");
  const contract: Contract = {
    schemaVersion: 1,
    contractId: `contract-${name}`,
    createdAt: new Date().toISOString(),
    source: "file",
    repo: { root: repo, headSha: "x", repoKey: "repo" },
    goal: { original: GOAL, refined: "Make value.txt say ok." },
    doneConditions: [
      { id: "D1", statement: "check.js passes", verify: { kind: "command", command: "node check.js", cwd: ".", equivalents: [], allowExtraArgs: false, timeoutSec: 30 } },
      { id: "D2", statement: "The value was reviewed", verify: { kind: "reported", how: "Look at value.txt", checks: [] } },
    ],
    prohibitions: [{ id: "P1", text: "Do not edit check.js.", source: { kind: "judge", ref: "check.js is the check" } }],
    materials: [],
    effort: { level: "medium", decidedBy: "fixed" },
    runtime: runtimeFor("medium", "faux/faux-1"),
    paths: { runDir, materialsDir: path.join(dir, "materials") },
  };
  const contractFile = path.join(dir, "contract.json");
  fs.writeFileSync(contractFile, JSON.stringify(contract, null, 2));
  const env = {
    ...process.env, ...gitEnv,
    HOME: path.join(dir, "home"),
    PI_CODING_AGENT_DIR: path.join(dir, "agent"),
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
  return { dir, repo, runDir, sessions: path.join(dir, "sessions"), contractFile, env };
}

type Run = { code: number | null; stdout: string; stderr: string; events: Array<Record<string, any>> };

function run(sb: Sandbox, scenario: string, args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: sb.dir,
      env: { ...sb.env, PI_HARNESS_FAUX_SCENARIO: scenario, PI_HARNESS_EXPECT_GOAL: GOAL },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timeout\n${stderr}`)); }, 90_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const events = stdout.split("\n").filter((l) => l.trim() !== "").map((l, i) => {
        try {
          return JSON.parse(l);
        } catch {
          throw new Error(`stdout line ${i + 1} is not JSON: ${l.slice(0, 200)}\nstderr:\n${stderr}`);
        }
      });
      resolve({ code, stdout, stderr, events });
    });
  });
}

const piArgs = (sb: Sandbox) => ["--mode", "json", "-p", "-e", fauxExt, "--session-dir", sb.sessions];
const work = (sb: Sandbox, scenario: string) => run(sb, scenario, ["work", "--contract", sb.contractFile, "--", ...piArgs(sb)]);

function sessionFile(sb: Sandbox): string {
  const files = fs.readdirSync(sb.sessions, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".jsonl"));
  assert.equal(files.length, 1, `expected one session file, got ${files.join(", ")}`);
  return path.join(sb.sessions, files[0] as string);
}

function sessionEntries(sb: Sandbox): Array<Record<string, any>> {
  return fs.readFileSync(sessionFile(sb), "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l));
}

const assistantTexts = (r: Run) => r.events
  .filter((e) => e.type === "message_end" && e.message?.role === "assistant")
  .flatMap((e) => e.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text as string));

function assertNoUnexpected(r: Run): void {
  const bad = assistantTexts(r).filter((t) => t.startsWith("UNEXPECTED"));
  assert.deepEqual(bad, [], `scripted agent saw something unexpected; stderr:\n${r.stderr}`);
  assert.equal(r.code, 0, r.stderr);
}

describe("e2e with the faux provider", { concurrency: true }, () => {
  test("work injects the contract, sends the goal verbatim and settles without a gate or report", async () => {
    const sb = sandbox("inject");
    const r = await work(sb, "inject");
    assertNoUnexpected(r);
    assert.equal(r.events[0]?.type, "session");
    const system = r.events.find((e) => e.type === "message_end" && e.message?.role === "system");
    const section: string = system?.message.sections.session_contract;
    assert.ok(section.startsWith("<session_contract>"));
    assert.ok(section.includes(GOAL));
    for (const removed of ["run_check", "record_evidence", "ask_user", "the harness checks"]) assert.ok(!section.includes(removed), removed);
    const user = r.events.find((e) => e.type === "message_end" && e.message?.role === "user");
    assert.deepEqual(user?.message.content, [{ type: "text", text: GOAL }]);
    assert.deepEqual(assistantTexts(r), ["All done."]);
    assert.equal(fs.readFileSync(path.join(sb.repo, "value.txt"), "utf8"), "ok\n");
    const entries = sessionEntries(sb);
    assert.deepEqual(entries.filter((e) => e.type === "custom" || e.type === "custom_message").map((e) => e.customType), ["harness-contract"]);
    assert.equal(fs.existsSync(sb.runDir) ? fs.readdirSync(sb.runDir).length : 0, 0);
  });

  test("resume keeps the contract of the session and injects it again", async () => {
    const sb = sandbox("resume");
    assertNoUnexpected(await work(sb, "inject"));
    const r2 = await run(sb, "resume", ["resume", "--session", sessionFile(sb), "--", ...piArgs(sb), "anything else?"]);
    assertNoUnexpected(r2);
    assert.deepEqual(assistantTexts(r2), ["Nothing else to change."]);
    assert.equal(sessionEntries(sb).filter((e) => e.customType === "harness-contract").length, 1);
  });

  test("launcher rejects messages in the pi arguments and the removed baseline flags", async () => {
    const sb = sandbox("reject");
    const r = await run(sb, "inject", ["work", "--contract", sb.contractFile, "--", "--mode", "json", "-p", "hello"]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /must not contain a message/);
    for (const flag of ["--skip-baseline", "--no-baseline-cache"]) {
      const bad = await run(sb, "inject", ["work", "--contract", sb.contractFile, flag, "--", ...piArgs(sb)]);
      assert.equal(bad.code, 2);
      assert.match(bad.stderr, new RegExp(`Unknown argument "${flag}"`));
    }
  });
});
