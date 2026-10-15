import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runtimeFor } from "../src/contract/effort.ts";
import type { Contract } from "../src/contract/schema.ts";
import { VALID_DRAFT } from "./fixtures/faux-judge-ext.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../bin/pi-harness.ts");
const judgeExt = path.resolve(here, "fixtures/faux-judge-ext.ts");
const judgeWorkExt = path.resolve(here, "fixtures/faux-judge-work-ext.ts");
const fixedWorkExt = path.resolve(here, "fixtures/faux-run-ext.ts");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-judge-e2e-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MESSAGE = "  @value.txt must say ok -- fix it\n(keep \"quotes\" and 한국어)\n\n";
const CHECK_JS = `const fs = require("node:fs");
const v = fs.readFileSync("value.txt", "utf8").trim();
if (v === "ok") { console.log("value ok"); process.exit(0); }
console.log("value is bad: " + v); process.exit(1);
`;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const SEP = "\u001f";

type Sandbox = { repo: string; agent: string; runDir: string; messageFile: string; materials: string; sessions: string; env: NodeJS.ProcessEnv };

function sandbox(name: string): Sandbox {
  const dir = path.join(tmp, name);
  const repo = path.join(dir, "target-repo");
  fs.mkdirSync(repo, { recursive: true });
  for (const d of ["home", "agent", "sessions", "repos", "materials"]) fs.mkdirSync(path.join(dir, d));
  fs.writeFileSync(path.join(repo, "check.js"), CHECK_JS);
  fs.writeFileSync(path.join(repo, "value.txt"), "bad\n");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "Never edit check.js.\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env: { ...process.env, ...gitEnv }, stdio: "ignore" });
  git("init", "-q", "-b", "main", ".");
  git("add", "-A");
  git("commit", "-qm", "init");
  const agent = path.join(dir, "agent");
  fs.writeFileSync(path.join(agent, "AGENTS.md"), "Never push.\n");
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
    PI_CODING_AGENT_DIR: agent,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    PI_HARNESS_REPOS_DIR: reposDir,
    PI_HARNESS_CHILD_EXTRA_ARGS: JSON.stringify(["-e", judgeExt]),
  };
  delete env.PI_HARNESS_MODEL;
  return { repo, agent, runDir: path.join(dir, "run"), messageFile, materials, sessions: path.join(dir, "sessions"), env };
}

type Run = { code: number | null; stdout: string; stderr: string; events: Array<Record<string, any>> };

function run(sb: Sandbox, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: sb.repo, env: { ...sb.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timeout\n${stderr}`)); }, 120_000);
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

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const jsonl = (file: string) => fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
const assistantTexts = (events: Array<Record<string, any>>) => events
  .filter((e) => e.type === "message_end" && e.message?.role === "assistant")
  .flatMap((e) => e.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text as string));

function judgeArgs(sb: Sandbox, workExt: string, extra: string[] = []): string[] {
  return [
    "run", "--contract-mode", "judge", "--model", "faux/faux-1", "--message-file", sb.messageFile, "--materials-dir", sb.materials,
    "--run-dir", sb.runDir, ...extra,
    "--", "--mode", "json", "-p", "-e", workExt, "--session-dir", sb.sessions,
  ];
}

const judgeExpect = [MESSAGE, "Never edit check.js.", "Never push.", "- M1 "].join(SEP);

describe("pi-harness run --contract-mode judge with the faux provider", { concurrency: true }, () => {
  test("judge reads, retries after an invalid draft, effort step says high, the work session gets that contract", async () => {
    const sb = sandbox("judge-a");
    const r = await run(sb, judgeArgs(sb, judgeWorkExt), {
      PI_FAUX_JUDGE_SCENARIO: "A",
      PI_FAUX_EXPECT_JUDGE: judgeExpect,
      PI_FAUX_EXPECT_EFFORT: [MESSAGE, "D1 check.js passes", "D2 value.txt holds a single line", "P1 Do not edit check.js."].join(SEP),
      PI_HARNESS_EXPECT_SECTION: [MESSAGE, VALID_DRAFT.refinedGoal, "D2 value.txt holds a single line", "P1 Do not edit check.js.", "M1"].join(SEP),
    });
    assert.deepEqual(assistantTexts(r.events).filter((t) => t.startsWith("UNEXPECTED")), [], r.stderr);
    assert.equal(r.code, 0, r.stderr);

    const judgeEvents = jsonl(path.join(sb.runDir, "judge.events.jsonl"));
    assert.deepEqual(assistantTexts(judgeEvents).filter((t) => t.startsWith("UNEXPECTED")), []);
    assert.deepEqual(assistantTexts(jsonl(path.join(sb.runDir, "effort.events.jsonl"))).filter((t) => t.startsWith("UNEXPECTED")), []);

    const contract: Contract = readJson(path.join(sb.runDir, "contract.json"));
    assert.equal(contract.source, "judge");
    assert.equal(contract.goal.original, MESSAGE);
    assert.equal(contract.goal.refined, VALID_DRAFT.refinedGoal);
    assert.deepEqual(contract.doneConditions, [
      {
        id: "D1", statement: "check.js passes", basis: "repo config step",
        verify: { kind: "command", command: "node check.js", cwd: ".", equivalents: [], allowExtraArgs: false, timeoutSec: 30 },
      },
      { id: "D2", statement: "value.txt holds a single line", verify: { kind: "reported", how: "Open value.txt and report its content.", checks: [] } },
    ]);
    assert.deepEqual(contract.prohibitions.map((p) => [p.id, p.source.kind]), [["P1", "repo-rules"]]);
    assert.equal(contract.prohibitions[0]?.source.ref, "AGENTS.md: Never edit check.js.");
    assert.equal("unknowns" in contract, false);
    assert.deepEqual(contract.materials, [{
      id: "M1", path: path.join(sb.materials, "spec.md"), mediaType: "text/markdown", describe: "spec.md", origin: { kind: "case" },
    }]);
    assert.deepEqual(contract.effort, { level: "high", decidedBy: "classifier" });
    assert.deepEqual(contract.runtime, runtimeFor("high", "faux/faux-1"));

    const judgeInput = readJson(path.join(sb.runDir, "judge-input.json"));
    assert.equal(judgeInput.original, MESSAGE);
    assert.equal(judgeInput.userRulesPath, path.join(sb.agent, "AGENTS.md"));
    assert.deepEqual(judgeInput.ruleFiles, [{ path: path.join(sb.repo, "AGENTS.md"), scope: "repo" }]);
    assert.equal(judgeInput.mcp, false);

    const judge = readJson(path.join(sb.runDir, "judge.json"));
    assert.equal(judge.status, "submitted");
    assert.equal(judge.error, undefined);
    assert.equal(judge.rationale, VALID_DRAFT.rationale);
    assert.deepEqual(judge.attempts.map((a: any) => a.valid), [false, true]);
    assert.match(judge.attempts[0].errors.join("\n"), /Unknown material id "M9"/);
    assert.deepEqual(judge.toolLog.map((t: any) => [t.tool, t.isError]), [["read", false], ["submit_contract", true], ["submit_contract", false]]);
    assert.ok(judge.usage.totalTokens > 0);
    assert.equal(judge.process.exitCode, 0);
    assert.equal(judge.process.timedOut, false);
    assert.ok(fs.readdirSync(path.join(sb.runDir, "judge-session")).length === 1);

    const effort = readJson(path.join(sb.runDir, "effort.json"));
    assert.equal(effort.level, "high");
    assert.equal(effort.decidedBy, "classifier");
    assert.match(effort.reason, /Two conditions/);
    const effortInput = readJson(path.join(sb.runDir, "effort-input.json"));
    assert.deepEqual(Object.keys(effortInput).sort(), ["doneConditions", "firstMessage", "prohibitions", "schemaVersion"]);

    const system = r.events.find((e) => e.type === "message_end" && e.message?.role === "system");
    assert.ok(system?.message.sections.session_contract.includes("P1 Do not edit check.js."));
    const user = r.events.find((e) => e.type === "message_end" && e.message?.role === "user");
    assert.deepEqual(user?.message.content, [{ type: "text", text: MESSAGE }]);
    for (const f of ["report.json", "prompts.jsonl", "baseline.json"]) assert.equal(fs.existsSync(path.join(sb.runDir, f)), false, f);
    assert.match(r.stderr, /판정 에이전트가 계약을 작성하고 있습니다/);
    assert.match(r.stderr, /이 계약은 판정 에이전트가 작성했습니다/);
    assert.match(r.stderr, /노력 수준은 높음입니다/);
  });

  test("a judge that never submits leads to the fallback contract with the reason recorded", async () => {
    const sb = sandbox("judge-b");
    const r = await run(sb, judgeArgs(sb, fixedWorkExt), {
      PI_FAUX_JUDGE_SCENARIO: "B",
      PI_FAUX_EXPECT_JUDGE: judgeExpect,
      PI_HARNESS_EXPECT_SECTION: [MESSAGE, "node check.js", "M1"].join(SEP),
    });
    assert.deepEqual(assistantTexts(r.events).filter((t) => t.startsWith("UNEXPECTED")), [], r.stderr);
    assert.equal(r.code, 0, r.stderr);
    const contract: Contract = readJson(path.join(sb.runDir, "contract.json"));
    assert.equal(contract.source, "fallback");
    assert.equal(contract.goal.refined, MESSAGE);
    assert.deepEqual(contract.effort, { level: "medium", decidedBy: "fallback" });
    assert.deepEqual(contract.prohibitions, []);
    assert.deepEqual(contract.doneConditions.map((d) => d.id), ["D1"]);
    assert.deepEqual(contract.materials.map((m) => m.id), ["M1"]);
    const judge = readJson(path.join(sb.runDir, "judge.json"));
    assert.equal(judge.status, "failed");
    assert.equal(judge.fallback, true);
    assert.match(judge.error, /stopped without calling submit_contract/);
    assert.match(judge.error, /nothing to submit/);
    assert.equal(fs.existsSync(path.join(sb.runDir, "effort.json")), false);
    assert.match(r.stderr, /판정 단계가 실패해 대체 계약을 사용합니다\. 이유: the model stopped without calling submit_contract/);
    assert.match(r.stderr, /판정 단계를 사용할 수 없어 레포 설정으로 만든 대체 계약을 사용합니다/);
    assert.equal(fs.existsSync(path.join(sb.runDir, "report.json")), false);
  });

  test("--effort low skips the effort step and is recorded as an override", async () => {
    const sb = sandbox("judge-c");
    const r = await run(sb, judgeArgs(sb, judgeWorkExt, ["--effort", "low"]), {
      PI_FAUX_JUDGE_SCENARIO: "A",
      PI_FAUX_EXPECT_JUDGE: judgeExpect,
      PI_HARNESS_EXPECT_SECTION: [VALID_DRAFT.refinedGoal, "D2"].join(SEP),
    });
    assert.deepEqual(assistantTexts(r.events).filter((t) => t.startsWith("UNEXPECTED")), [], r.stderr);
    assert.equal(r.code, 0, r.stderr);
    const contract: Contract = readJson(path.join(sb.runDir, "contract.json"));
    assert.equal(contract.source, "judge");
    assert.deepEqual(contract.effort, { level: "low", decidedBy: "override" });
    assert.deepEqual(contract.runtime, runtimeFor("low", "faux/faux-1"));
    assert.deepEqual(readJson(path.join(sb.runDir, "effort.json")), { level: "low", reason: "set with --effort", decidedBy: "override" });
    assert.equal(fs.existsSync(path.join(sb.runDir, "effort-input.json")), false);
    assert.equal(fs.existsSync(path.join(sb.runDir, "effort.events.jsonl")), false);
  });

  test("--judge-mcp loads pi's MCP and tool_search extensions in the judge; no servers configured still works", async () => {
    const sb = sandbox("judge-mcp");
    const r = await run(sb, judgeArgs(sb, judgeWorkExt, ["--judge-mcp", "--effort", "medium", "--judge-thinking", "low", "--judge-timeout", "60"]), {
      PI_FAUX_JUDGE_SCENARIO: "A",
      PI_FAUX_JUDGE_TOOLS: "find,grep,ls,read,submit_contract,tool_search",
      PI_HARNESS_EXPECT_SECTION: VALID_DRAFT.refinedGoal,
    });
    assert.deepEqual(assistantTexts(r.events).filter((t) => t.startsWith("UNEXPECTED")), [], r.stderr);
    assert.equal(r.code, 0, r.stderr);
    const contract: Contract = readJson(path.join(sb.runDir, "contract.json"));
    assert.equal(contract.source, "judge", r.stderr);
    assert.deepEqual(contract.effort, { level: "medium", decidedBy: "override" });
    assert.equal(readJson(path.join(sb.runDir, "judge-input.json")).mcp, true);
    const system = jsonl(path.join(sb.runDir, "judge.events.jsonl")).find((e) => e.type === "message_end" && e.message?.role === "system");
    assert.ok(system?.message.sections.judge_instructions.includes("MCP tools (names start with mcp__)"));
    assert.equal(readJson(path.join(sb.runDir, "judge.json")).process.timedOut, false);
  });

  test("three invalid submissions stop the judge and use the fallback contract", async () => {
    const sb = sandbox("judge-d");
    const r = await run(sb, judgeArgs(sb, fixedWorkExt), {
      PI_FAUX_JUDGE_SCENARIO: "D",
      PI_FAUX_EXPECT_JUDGE: judgeExpect,
      PI_HARNESS_EXPECT_SECTION: [MESSAGE, "node check.js"].join(SEP),
    });
    assert.deepEqual(assistantTexts(r.events).filter((t) => t.startsWith("UNEXPECTED")), [], r.stderr);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(assistantTexts(jsonl(path.join(sb.runDir, "judge.events.jsonl"))).filter((t) => t.startsWith("UNEXPECTED")), []);
    assert.equal(readJson(path.join(sb.runDir, "contract.json")).source, "fallback");
    const judge = readJson(path.join(sb.runDir, "judge.json"));
    assert.equal(judge.status, "failed");
    assert.deepEqual(judge.attempts.map((a: any) => a.valid), [false, false, false]);
    assert.match(judge.error, /3 invalid submissions/);
    assert.equal(fs.existsSync(path.join(sb.runDir, "effort.json")), false);
  });
});
