import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Contract } from "../src/contract/schema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../bin/pi-harness.ts");
const fauxExt = path.resolve(here, "fixtures/faux-run-ext.ts");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-run-e2e-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MESSAGE = "  @value.txt must say ok -- fix it\n(keep \"quotes\" and 한국어)\n\n";
const CHECK_JS = `const fs = require("node:fs");
const v = fs.readFileSync("value.txt", "utf8").trim();
if (v === "ok") { console.log("value ok"); process.exit(0); }
console.log("value is bad: " + v); process.exit(1);
`;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

type Sandbox = { dir: string; repo: string; home: string; reposDir: string; sessions: string; messageFile: string; materials: string; env: NodeJS.ProcessEnv };

function sandbox(name: string): Sandbox {
  const dir = path.join(tmp, name);
  const repo = path.join(dir, "target-repo");
  fs.mkdirSync(repo, { recursive: true });
  for (const d of ["home", "agent", "sessions", "repos", "materials"]) fs.mkdirSync(path.join(dir, d));
  fs.writeFileSync(path.join(repo, "check.js"), CHECK_JS);
  fs.writeFileSync(path.join(repo, "value.txt"), "bad\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env: { ...process.env, ...gitEnv }, stdio: "ignore" });
  git("init", "-q", "-b", "main", ".");
  git("add", "-A");
  git("commit", "-qm", "init");
  const reposDir = path.join(dir, "repos");
  fs.writeFileSync(path.join(reposDir, "target-repo.json"), JSON.stringify({
    repoKey: "target-repo",
    completionSteps: [{ title: "Value check", statement: "check.js passes", command: "node check.js", timeoutSec: 30 }],
  }));
  const materials = path.join(dir, "materials");
  fs.writeFileSync(path.join(materials, "spec.md"), "# value must be ok\n");
  const messageFile = path.join(dir, "message.txt");
  fs.writeFileSync(messageFile, MESSAGE);
  const env: NodeJS.ProcessEnv = {
    ...process.env, ...gitEnv,
    HOME: path.join(dir, "home"),
    PI_CODING_AGENT_DIR: path.join(dir, "agent"),
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    PI_HARNESS_REPOS_DIR: reposDir,
  };
  delete env.PI_HARNESS_MODEL;
  return { dir, repo, home: path.join(dir, "home"), reposDir, sessions: path.join(dir, "sessions"), messageFile, materials, env };
}

type Run = { code: number | null; stdout: string; stderr: string; events: Array<Record<string, any>> };

function run(sb: Sandbox, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: sb.repo, env: { ...sb.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
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

const assistantTexts = (r: Run) => r.events
  .filter((e) => e.type === "message_end" && e.message?.role === "assistant")
  .flatMap((e) => e.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text as string));

describe("pi-harness run with the faux provider", { concurrency: true }, () => {
  test("fixed contract from the repo config, verbatim goal, contract in the system prompt, no gate or report", async () => {
    const sb = sandbox("fixed");
    const r = await run(sb, [
      "run", "--contract-mode", "fixed", "--model", "faux/faux-1", "--message-file", sb.messageFile, "--materials-dir", sb.materials,
      "--", "--mode", "json", "-p", "-e", fauxExt, "--session-dir", sb.sessions,
    ], { PI_HARNESS_EXPECT_SECTION: [MESSAGE, "node check.js", "M1"].join("\u001f") });
    assert.deepEqual(assistantTexts(r).filter((t) => t.startsWith("UNEXPECTED")), [], r.stderr);
    assert.equal(r.code, 0, r.stderr);

    const runsDir = path.join(sb.home, ".pi-harness", "runs");
    const runIds = fs.readdirSync(runsDir);
    assert.equal(runIds.length, 1);
    assert.match(runIds[0] as string, /^\d{8}T\d{6}Z-[0-9a-f]{6}$/);
    const runDir = path.join(runsDir, runIds[0] as string);
    assert.deepEqual(fs.readdirSync(runDir).sort(), ["contract.json", "materials"]);

    const contract: Contract = JSON.parse(fs.readFileSync(path.join(runDir, "contract.json"), "utf8"));
    assert.equal(contract.source, "fixed");
    assert.equal(contract.goal.original, fs.readFileSync(sb.messageFile, "utf8"));
    assert.equal(contract.repo.root, sb.repo);
    assert.equal(contract.repo.repoKey, "target-repo");
    assert.equal(contract.repo.branch, "main");
    assert.equal(contract.runtime.model, "faux/faux-1");
    assert.deepEqual(contract.doneConditions, [{
      id: "D1", statement: "check.js passes", basis: "repo-config:target-repo",
      verify: { kind: "command", command: "node check.js", cwd: ".", equivalents: [], allowExtraArgs: false, timeoutSec: 30 },
    }]);
    assert.deepEqual(contract.materials, [{
      id: "M1", path: path.join(sb.materials, "spec.md"), mediaType: "text/markdown", describe: "spec.md", origin: { kind: "case" },
    }]);

    const system = r.events.find((e) => e.type === "message_end" && e.message?.role === "system");
    const section: string = system?.message.sections.session_contract;
    assert.ok(section.startsWith("<session_contract>"));
    assert.ok(section.includes(MESSAGE));
    assert.ok(section.includes("D1 check.js passes"));
    const user = r.events.find((e) => e.type === "message_end" && e.message?.role === "user");
    assert.deepEqual(user?.message.content, [{ type: "text", text: MESSAGE }]);

    assert.equal(fs.readFileSync(path.join(sb.repo, "value.txt"), "utf8"), "ok\n");
    assert.equal(r.events.filter((e) => e.type === "message_end" && e.message?.role === "custom").length, 0);
    assert.match(r.stderr, /실행 폴더: /);
    assert.doesNotMatch(r.stderr, /경고: /);
  });

  test("judge-only flags are rejected in fixed mode before anything starts", async () => {
    const sb = sandbox("judge-flags");
    const r = await run(sb, ["run", "--contract-mode", "fixed", "--effort", "low", "--model", "faux/faux-1", "--message", "x"]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /--effort only apply to --contract-mode judge/);
    assert.equal(fs.existsSync(path.join(sb.home, ".pi-harness")), false);
  });

  test("a message in the pi arguments is rejected without creating a run", async () => {
    const sb = sandbox("reject");
    const r = await run(sb, ["run", "--model", "faux/faux-1", "--message", "x", "--", "--mode", "json", "-p", "hello"]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /must not contain a message/);
    assert.equal(fs.existsSync(path.join(sb.home, ".pi-harness")), false);
  });
});
