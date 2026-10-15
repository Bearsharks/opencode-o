import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runtimeFor } from "../src/contract/effort.ts";
import type { Contract } from "../src/contract/schema.ts";
import { INTERACTIVE_DRAFT } from "./fixtures/faux-interactive-judge-ext.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../bin/pi-harness.ts");
const judgeExt = path.resolve(here, "fixtures/faux-interactive-judge-ext.ts");
const workExt = path.resolve(here, "fixtures/faux-interactive-work-ext.ts");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-interactive-e2e-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MESSAGE = "  @value.txt must say ok -- fix it\n(keep \"quotes\" and 한국어)\n";
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const CHECK_JS = `const fs = require("node:fs");
process.exit(fs.readFileSync("value.txt", "utf8").trim() === "ok" ? 0 : 1);
`;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const SEP = "\u001f";

type Sandbox = { dir: string; repo: string; home: string; sessions: string; env: NodeJS.ProcessEnv };

function sandbox(name: string, git = true): Sandbox {
  const dir = path.join(tmp, name);
  const repo = path.join(dir, "target-repo");
  fs.mkdirSync(repo, { recursive: true });
  for (const d of ["home", "agent", "sessions", "repos"]) fs.mkdirSync(path.join(dir, d));
  fs.writeFileSync(path.join(repo, "check.js"), CHECK_JS);
  fs.writeFileSync(path.join(repo, "value.txt"), "bad\n");
  if (git) {
    const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, env: { ...process.env, ...gitEnv }, stdio: "ignore" });
    run("init", "-q", "-b", "main", ".");
    run("add", "-A");
    run("commit", "-qm", "init");
  }
  fs.writeFileSync(path.join(dir, "repos", "target-repo.json"), JSON.stringify({
    repoKey: "target-repo",
    completionSteps: [{ title: "Value check", statement: "check.js passes", command: "node check.js", timeoutSec: 30 }],
  }));
  const env: NodeJS.ProcessEnv = {
    ...process.env, ...gitEnv,
    HOME: path.join(dir, "home"),
    PI_CODING_AGENT_DIR: path.join(dir, "agent"),
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    PI_HARNESS_REPOS_DIR: path.join(dir, "repos"),
    PI_HARNESS_ALLOW_NONINTERACTIVE: "1",
    PI_HARNESS_CHILD_EXTRA_ARGS: JSON.stringify(["-e", judgeExt]),
  };
  delete env.PI_HARNESS_MODEL;
  return { dir, repo, home: path.join(dir, "home"), sessions: path.join(dir, "sessions"), env };
}

type Rpc = { code: number | null; stderr: string; events: Array<Record<string, any>> };

function rpc(sb: Sandbox, commands: Array<Record<string, unknown>>, extraEnv: NodeJS.ProcessEnv, waitFor: () => boolean): Promise<Rpc> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, "--mode", "rpc", "--model", "faux/faux-1", "-e", workExt, "--session-dir", sb.sessions], {
      cwd: sb.repo, env: { ...sb.env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    for (const c of commands) child.stdin.write(`${JSON.stringify(c)}\n`);
    const started = Date.now();
    const poll = setInterval(() => {
      if (!waitFor() && Date.now() - started < 90_000) return;
      clearInterval(poll);
      child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
      setTimeout(() => child.stdin.end(), 300);
    }, 100);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timeout\n${stderr}`)); }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(poll);
      const events = stdout.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      resolve({ code, stderr, events });
    });
  });
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const runDirOf = (sb: Sandbox) => {
  const root = path.join(sb.home, ".pi-harness", "runs");
  const runs = fs.existsSync(root) ? fs.readdirSync(root) : [];
  return runs.length === 1 ? path.join(root, runs[0]!) : undefined;
};
const finished = (sb: Sandbox) => {
  if (!fs.existsSync(sb.sessions)) return false;
  return fs.readdirSync(sb.sessions, { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl"))
    .some((f) => fs.readFileSync(path.join(sb.sessions, f), "utf8").includes("\"text\":\"Done.\""));
};
const ui = (r: Rpc, method: string) => r.events.filter((e) => e.type === "extension_ui_request" && e.method === method);
const assistantTexts = (r: Rpc) => r.events
  .filter((e) => e.type === "message_end" && e.message?.role === "assistant")
  .flatMap((e) => e.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text as string));
const state = (r: Rpc) => r.events.find((e) => e.type === "response" && e.command === "get_state")?.data;

function sessionEntries(sb: Sandbox): Array<Record<string, any>> {
  const files = fs.readdirSync(sb.sessions, { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl"));
  assert.equal(files.length, 1);
  return fs.readFileSync(path.join(sb.sessions, files[0]!), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

describe("pi-harness interactive entry over RPC with the faux provider", { concurrency: true }, () => {
  test("the first prompt is judged, the contract applied with its effort, and the verbatim message with its image starts the harnessed work", async () => {
    const sb = sandbox("success");
    const r = await rpc(sb, [{ id: "p1", type: "prompt", message: MESSAGE, images: [{ type: "image", data: PNG_1PX, mimeType: "image/png" }] }], {
      PI_FAUX_EFFORT_LEVEL: "medium",
      PI_FAUX_EXPECT_JUDGE: [MESSAGE, "attached 1 image"].join(SEP),
      PI_FAUX_EXPECT_EFFORT: MESSAGE,
      PI_HARNESS_EXPECT_SECTION: [INTERACTIVE_DRAFT.refinedGoal, "D2 value.txt holds a single line", "P1 Do not edit check.js."].join(SEP),
      PI_HARNESS_EXPECT_USER: MESSAGE,
      PI_HARNESS_EXPECT_WORKERS: "1",
    }, () => finished(sb));
    assert.deepEqual(assistantTexts(r).filter((t) => t.startsWith("UNEXPECTED")), [], r.stderr);
    assert.equal(r.code, 0, r.stderr);
    const runDir = runDirOf(sb)!;
    assert.equal(path.dirname(runDir), path.join(sb.home, ".pi-harness", "runs"));

    const judge = readJson(path.join(runDir, "judge.json"));
    assert.equal(judge.status, "submitted");
    assert.equal(readJson(path.join(runDir, "judge-input.json")).original, MESSAGE);
    assert.equal(readJson(path.join(runDir, "judge-input.json")).attachedImages, 1);
    assert.deepEqual([readJson(path.join(runDir, "effort.json")).level, readJson(path.join(runDir, "effort.json")).decidedBy], ["medium", "classifier"]);
    const contract: Contract = readJson(path.join(runDir, "contract.json"));
    assert.equal(contract.source, "judge");
    assert.equal(contract.goal.original, MESSAGE);
    assert.equal(contract.repo.root, sb.repo);
    assert.deepEqual(contract.runtime, runtimeFor("medium", "faux/faux-1"));
    for (const f of ["baseline.json", "report.json", "prompts.jsonl"]) assert.equal(fs.existsSync(path.join(runDir, f)), false, f);

    assert.equal(r.events.find((e) => e.type === "response" && e.id === "p1")?.data?.disposition, "handled");
    const users = r.events.filter((e) => e.type === "message_end" && e.message?.role === "user");
    assert.equal(users.length, 1);
    assert.deepEqual(users[0]?.message.content[0], { type: "text", text: MESSAGE });
    assert.equal(users[0]?.message.content.filter((c: any) => c.type === "image").length, 1);
    const system = r.events.find((e) => e.type === "message_end" && e.message?.role === "system");
    assert.match(system?.message.sections.session_contract ?? "", /<session_contract>[\s\S]*Make value\.txt contain ok/);
    assert.equal(state(r)?.thinkingLevel, "high");

    const widgets = ui(r, "setWidget").map((e) => (e.widgetLines ?? []).join("\n"));
    assert.ok(widgets.some((w) => w.includes("첫 메시지로 작업 계약을 만드는 중입니다")), widgets.join("\n---\n"));
    assert.ok(widgets.some((w) => w.includes("노력 수준을 정하는 중입니다") && w.includes("판정 도구 호출 2회")), widgets.join("\n---\n"));
    assert.ok(!widgets.some((w) => w.includes("기준")));
    assert.ok(ui(r, "notify").some((e) => e.message.includes("이번 작업의 계약입니다") && e.message.includes(runDir)));

    const entries = sessionEntries(sb);
    const contractEntries = entries.filter((e) => e.type === "custom" && e.customType === "harness-contract");
    assert.equal(contractEntries.length, 1);
    assert.deepEqual(entries.filter((e) => e.type === "custom" || e.type === "custom_message").map((e) => e.customType), ["harness-contract"]);
    assert.equal(contractEntries[0]?.data.runDir, runDir);
    const firstUser = entries.find((e) => e.type === "message" && e.message?.role === "user");
    assert.deepEqual(firstUser?.message.content[0], { type: "text", text: MESSAGE });
  });

  test("a low effort keeps run_workers away and sets thinking to medium", async () => {
    const sb = sandbox("low");
    const r = await rpc(sb, [{ id: "p1", type: "prompt", message: "make value.txt say ok" }], {
      PI_FAUX_EFFORT_LEVEL: "low",
      PI_HARNESS_EXPECT_SECTION: INTERACTIVE_DRAFT.refinedGoal,
      PI_HARNESS_EXPECT_USER: "make value.txt say ok",
      PI_HARNESS_EXPECT_WORKERS: "0",
    }, () => finished(sb));
    assert.deepEqual(assistantTexts(r).filter((t) => t.startsWith("UNEXPECTED")), [], r.stderr);
    assert.equal(r.code, 0, r.stderr);
    const contract: Contract = readJson(path.join(runDirOf(sb)!, "contract.json"));
    assert.deepEqual(contract.effort, { level: "low", decidedBy: "classifier" });
    assert.equal(state(r)?.thinkingLevel, "medium");
  });

  test("a judge that never submits leads to the fallback contract with a visible notice, and the work still starts", async () => {
    const sb = sandbox("fallback");
    const r = await rpc(sb, [{ id: "p1", type: "prompt", message: MESSAGE }], {
      PI_FAUX_JUDGE_SCENARIO: "B",
      PI_HARNESS_EXPECT_SECTION: [MESSAGE.trim(), "node check.js"].join(SEP),
      PI_HARNESS_EXPECT_USER: MESSAGE,
      PI_HARNESS_EXPECT_WORKERS: "1",
    }, () => finished(sb));
    assert.equal(r.code, 0, r.stderr);
    const runDir = runDirOf(sb)!;
    const contract: Contract = readJson(path.join(runDir, "contract.json"));
    assert.equal(contract.source, "fallback");
    assert.equal(fs.existsSync(path.join(runDir, "effort.json")), false);
    assert.equal(readJson(path.join(runDir, "judge.json")).fallback, true);
    assert.ok(ui(r, "notify").some((e) => e.notifyType === "warning" && e.message.includes("판정 단계가 실패해 대체 계약을 사용합니다")));
    const users = r.events.filter((e) => e.type === "message_end" && e.message?.role === "user");
    assert.deepEqual(users[0]?.message.content, [{ type: "text", text: MESSAGE }]);
  });

  test("outside a git repository the session opens without a contract and says the harness is off", async () => {
    const sb = sandbox("no-git", false);
    let seen = false;
    const r = await rpc(sb, [{ id: "c", type: "get_commands" }], {}, () => {
      if (seen) return true;
      seen = true;
      return false;
    });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(ui(r, "setStatus").some((e) => e.statusText === "pi-harness: 꺼짐"));
    assert.ok(ui(r, "notify").some((e) => e.notifyType === "warning" && e.message.includes("git 저장소 안에 있지 않아")));
    assert.equal(fs.existsSync(path.join(sb.home, ".pi-harness")), false);
  });
});

describe("pi-harness launch checks", () => {
  test("without a terminal, or with print or json mode, it exits and points to pi-harness run", () => {
    const sb = sandbox("no-tty");
    const env = { ...sb.env, PI_HARNESS_ALLOW_NONINTERACTIVE: "" };
    for (const args of [[], ["--mode", "json"], ["-p", "hi"], ["--mode", "rpc"]]) {
      let out = "";
      let code = 0;
      try {
        execFileSync(process.execPath, [bin, ...args], { cwd: sb.repo, env, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" });
      } catch (e) {
        const err = e as { status: number; stderr: string };
        code = err.status;
        out = err.stderr;
      }
      assert.equal(code, 2, `${args.join(" ")}: ${out}`);
      assert.match(out, /pi-harness run/);
    }
  });

  test("the bin runs through a symlink from another directory, as npm link installs it", () => {
    const dir = path.join(tmp, "linked");
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.mkdirSync(path.join(dir, "elsewhere"));
    const link = path.join(dir, "bin", "pi-harness");
    fs.symlinkSync(bin, link);
    const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` };
    const r = spawnSync(link, ["--help"], { cwd: path.join(dir, "elsewhere"), env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /pi-harness \[<pi args>\]/);
    assert.match(fs.readFileSync(bin, "utf8"), /^#!\/usr\/bin\/env node\n/);
  });
});
