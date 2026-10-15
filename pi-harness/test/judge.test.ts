import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Contract, JudgeDraft, Material } from "../src/contract/schema.ts";
import { childFailure } from "../src/judge/builder.ts";
import { childExtraArgs, effortPiArgs, judgePiArgs, runChild } from "../src/judge/child.ts";
import { checkDraft, sourceErrors } from "../src/judge/draft.ts";
import {
  buildEffortInput, decideEffort, EFFORT_MARKER, EFFORT_SECTION, EFFORT_SENTINEL, effortFirstMessage, effortInstructions, effortSession,
} from "../src/judge/effort-step.ts";
import { buildJudgeInput, discoverRuleFiles, type JudgeInput } from "../src/judge/input.ts";
import { judgeSession, SUBMIT_CONTRACT } from "../src/judge/judge-ext.ts";
import { captureMcpResult, nextMaterialNumber, originKindFor } from "../src/judge/materials.ts";
import { JUDGE_MARKER, JUDGE_SECTION, JUDGE_SENTINEL, judgeFirstMessage, judgeInstructions } from "../src/judge/prompt.ts";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-judge-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
function dir(name: string): string {
  const d = path.join(tmp, `${++counter}-${name}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const ORIGINAL = "  @value.txt must say ok -- do not touch check.js\n(한국어 \"quotes\")\n";
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function repo(name: string): string {
  const r = dir(name);
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: r });
  fs.writeFileSync(path.join(r, "check.js"), "process.exit(0);\n");
  return r;
}

function input(over: Partial<JudgeInput> = {}): JudgeInput {
  const root = over.repo?.root ?? repo("in");
  const runDir = dir("run");
  const materialsDir = path.join(runDir, "materials");
  fs.mkdirSync(materialsDir, { recursive: true });
  const spec = path.join(runDir, "spec.md");
  fs.writeFileSync(spec, "# spec\n");
  return {
    schemaVersion: 1,
    original: ORIGINAL,
    repo: { root, headSha: "abc123", branch: "main", repoKey: "target" },
    repoConfig: { repoKey: "target", completionSteps: [{ title: "Check", command: "node check.js" }], rules: "Never bump versions." },
    userRulesPath: null,
    ruleFiles: [],
    materials: [{ id: "M1", path: spec, mediaType: "text/markdown", describe: "spec.md", origin: { kind: "case" } }],
    paths: { runDir, materialsDir },
    model: "faux/faux-1",
    mcp: false,
    maxInvalidSubmissions: 3,
    ...over,
  };
}

const draft = (over: Partial<JudgeDraft> = {}): JudgeDraft => ({
  refinedGoal: "Make value.txt say ok.",
  doneConditions: [
    { statement: "check.js passes", verify: { kind: "command", command: "node check.js", timeoutSec: 30 } },
    { statement: "value.txt reads ok", verify: { kind: "reported", how: "Show the file." } },
  ],
  prohibitions: [{ text: "Do not edit check.js.", source: { kind: "user-message", ref: "do not touch check.js" } }],
  materialIds: ["M1"],
  ...over,
});

type Handler = (event: any, ctx: any) => any;
function mockPi() {
  const tools = new Map<string, any>();
  const handlers = new Map<string, Handler[]>();
  let aborts = 0;
  const ctx = { abort: () => { aborts++; } };
  const pi = {
    registerTool: (t: any) => { tools.set(t.name, t); },
    on: (event: string, h: Handler) => { handlers.set(event, [...(handlers.get(event) ?? []), h]); },
  };
  const emit = async (event: string, payload: any) => {
    let out: any;
    for (const h of handlers.get(event) ?? []) out = (await h({ type: event, ...payload }, ctx)) ?? out;
    return out;
  };
  return { pi: pi as unknown as ExtensionAPI, tools, emit, aborts: () => aborts };
}

async function callTool(m: ReturnType<typeof mockPi>, name: string, params: unknown, id: string) {
  await m.emit("tool_execution_start", { toolCallId: id, toolName: name, args: params });
  try {
    const result = await m.tools.get(name).execute(id, params);
    await m.emit("tool_execution_end", { toolCallId: id, toolName: name, result, isError: false });
    return { result, isError: false };
  } catch (e) {
    const result = { content: [{ type: "text", text: (e as Error).message }], details: {} };
    await m.emit("tool_execution_end", { toolCallId: id, toolName: name, result, isError: true });
    return { result, isError: true };
  }
}

describe("judge input", () => {
  test("splits the user's rules file from the repo's rule files and copies materials", () => {
    const r = repo("rules");
    const agent = dir("agent");
    fs.writeFileSync(path.join(agent, "AGENTS.md"), "Never push.\n");
    fs.writeFileSync(path.join(r, "CLAUDE.md"), "Never edit check.js.\n");
    const base = input({ repo: { root: r, headSha: "h", repoKey: "k" } });
    const built = buildJudgeInput({
      original: ORIGINAL, repo: base.repo, repoConfig: null, materials: base.materials, paths: base.paths, model: "p/m", mcp: true, agentDir: agent,
    });
    assert.equal(built.original, ORIGINAL);
    assert.equal(built.userRulesPath, path.join(agent, "AGENTS.md"));
    assert.deepEqual(built.ruleFiles.filter((f) => f.scope === "repo"), [{ path: path.join(r, "CLAUDE.md"), scope: "repo" }]);
    assert.equal(built.mcp, true);
    assert.equal(built.maxInvalidSubmissions, 3);
    assert.deepEqual(built.materials, base.materials);
    assert.notEqual(built.materials[0], base.materials[0]);
  });

  test("no user rules file gives null", () => {
    const r = repo("norules");
    assert.equal(discoverRuleFiles(r, dir("empty-agent")).userRulesPath, null);
  });
});

describe("judge prompt", () => {
  test("instructions carry the product rules and examples marked as not presets", () => {
    const text = judgeInstructions(input());
    assert.ok(text.startsWith(JUDGE_MARKER));
    for (const s of [
      "exactly three things", "Clarify only. Do not add a decision", "one input, not a menu",
      "do not drop a condition because it may fail now", "user-message: the request forbids it; ref is the exact quote",
      "REFERENCE EXAMPLES", "examples only, not presets", "There is no turn limit", "3 rejected submissions",
    ]) assert.ok(text.includes(s), s);
    for (const s of ["unknown", "baseline", "requires it to succeed"]) assert.ok(!text.includes(s), s);
    assert.ok(!text.includes("MCP tools"));
    assert.ok(judgeInstructions(input({ mcp: true })).includes("saved as M3 at <path>"));
  });

  test("first message has the original verbatim, the repo, the config, the rules and the materials", () => {
    const r = repo("prompt");
    const agent = dir("prompt-agent");
    fs.writeFileSync(path.join(agent, "AGENTS.md"), "Never push to main.\n");
    fs.writeFileSync(path.join(r, "AGENTS.md"), "Run lint before commits.\n");
    const text = judgeFirstMessage(input({
      repo: { root: r, headSha: "deadbeef", branch: "main", repoKey: "target" },
      userRulesPath: path.join(agent, "AGENTS.md"),
      ruleFiles: [{ path: path.join(r, "AGENTS.md"), scope: "repo" }],
    }));
    assert.ok(text.includes(`<<<\n${ORIGINAL}\n>>>`));
    for (const s of ["deadbeef", "\"command\": \"node check.js\"", "Never bump versions.", "Never push to main.", "Run lint before commits.", `- M1 `]) {
      assert.ok(text.includes(s), s);
    }
    const bare = judgeFirstMessage(input({ repoConfig: null, materials: [] }));
    assert.ok(bare.includes("no harness config"));
    assert.ok(bare.includes("no prohibition can have source user-rules"));
    assert.ok(bare.includes("MATERIALS\nNone."));
  });
});

describe("draft check", () => {
  test("a valid draft becomes a judge contract with ids", () => {
    const i = input();
    const r = checkDraft(draft(), i, i.materials);
    assert.ok(r.ok);
    const c = (r as { contract: Contract }).contract;
    assert.equal(c.source, "judge");
    assert.equal(c.goal.original, ORIGINAL);
    assert.deepEqual(c.doneConditions.map((d) => d.id), ["D1", "D2"]);
    assert.deepEqual(c.prohibitions.map((p) => [p.id, p.source.kind]), [["P1", "user-message"]]);
    assert.deepEqual(c.effort, { level: "medium", decidedBy: "classifier" });
    const high = checkDraft(draft(), i, i.materials, { level: "high", decidedBy: "override" });
    assert.ok(high.ok && high.contract.runtime.workerCap === 4 && high.contract.effort.decidedBy === "override");
  });

  test("source rules: refs are required and material refs must name a known material", () => {
    const i = input();
    const errors = sourceErrors(draft({
      prohibitions: [
        { text: "a", source: { kind: "user-message", ref: "\"never use bash\"" } },
        { text: "b", source: { kind: "user-rules", ref: "~/.pi/agent/AGENTS.md" } },
        { text: "c", source: { kind: "material", ref: "M7 page 2" } },
        { text: "d", source: { kind: "judge" } },
        { text: "e", source: { kind: "user-message", ref: "“do not   touch check.js”" } },
      ],
    }), i.materials);
    assert.deepEqual(errors, [
      "prohibitions[2].source.ref must name a material id (known: M1).",
      "prohibitions[3].source.ref must cite where the prohibition comes from (a quote, a file path and rule, a material id, or your reason).",
    ]);
    const noConfig = input({ repoConfig: null });
    assert.deepEqual(sourceErrors(draft({ prohibitions: [{ text: "x", source: { kind: "repo-config", ref: "rules" } }] }), noConfig.materials), []);
  });

  test("finalize errors come back as a list: unknown material ids and bad cwd", () => {
    const i = input();
    const r = checkDraft(draft({ materialIds: ["M9"] }), i, i.materials);
    assert.ok(!r.ok);
    assert.match((r as { errors: string[] }).errors[0] ?? "", /Unknown material id "M9"/);
    const cwd = checkDraft(draft({ doneConditions: [{ statement: "s", verify: { kind: "command", command: "x", cwd: "../.." } }] }), i, i.materials);
    assert.ok(!cwd.ok && cwd.errors.some((e) => /outside the repo root|does not exist/.test(e)));
  });
});

describe("judge session (submit_contract)", () => {
  test("invalid then valid: the tool error lists the problems, the valid call terminates and writes judge.json", async () => {
    const i = input();
    const out = path.join(i.paths.runDir, "judge.json");
    const s = judgeSession(i, out);
    const m = mockPi();
    s.factory(m.pi);
    const bad = await callTool(m, SUBMIT_CONTRACT, { ...draft({ materialIds: ["M9"] }), rationale: "r1" }, "c1");
    assert.equal(bad.isError, true);
    assert.match(bad.result.content[0].text, /Unknown material id "M9"[\s\S]*2 attempts left/);
    assert.equal(fs.existsSync(out), false);
    const good = await callTool(m, SUBMIT_CONTRACT, { ...draft(), rationale: "because" }, "c2");
    assert.equal(good.isError, false);
    assert.equal(good.result.terminate, true);
    const rec = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(rec.status, "submitted");
    assert.equal(rec.rationale, "because");
    assert.equal(rec.draft.rationale, undefined);
    assert.deepEqual(rec.draft.materialIds, ["M1"]);
    assert.deepEqual(rec.attempts.map((a: any) => a.valid), [false, true]);
    assert.deepEqual(s.record().toolLog.map((t) => [t.tool, t.isError]), [[SUBMIT_CONTRACT, true], [SUBMIT_CONTRACT, false]]);
    const again = await callTool(m, SUBMIT_CONTRACT, { ...draft({ refinedGoal: "other" }), rationale: "x" }, "c3");
    assert.match(again.result.content[0].text, /already accepted/);
    assert.equal(s.record().draft?.refinedGoal, "Make value.txt say ok.");
    assert.equal(s.record().attempts.length, 2);
    assert.equal(m.aborts(), 0);
  });

  test("three invalid submissions (including schema failures) abort the judge with a recorded error", async () => {
    const i = input();
    const s = judgeSession(i, path.join(i.paths.runDir, "judge.json"));
    const m = mockPi();
    s.factory(m.pi);
    await callTool(m, SUBMIT_CONTRACT, { ...draft({ materialIds: ["M9"] }), rationale: "r" }, "a");
    await m.emit("tool_execution_end", { toolCallId: "b", toolName: SUBMIT_CONTRACT, result: { content: [{ type: "text", text: "Validation failed for tool \"submit_contract\"" }] }, isError: true });
    assert.equal(m.aborts(), 0);
    const last = await callTool(m, SUBMIT_CONTRACT, { ...draft({ materialIds: ["M8"] }), rationale: "r" }, "c");
    assert.match(last.result.content[0].text, /No attempts are left/);
    assert.equal(m.aborts(), 1);
    const rec = s.write();
    assert.equal(rec.status, "failed");
    assert.match(rec.error ?? "", /3 invalid submissions/);
    assert.deepEqual(rec.attempts.map((a) => a.valid), [false, false, false]);
    assert.deepEqual(rec.attempts[1]?.errors, ["Validation failed for tool \"submit_contract\""]);
  });

  test("a session that ends without a submission records why; the first input becomes the judge request", async () => {
    const i = input();
    const s = judgeSession(i, path.join(i.paths.runDir, "judge.json"));
    const m = mockPi();
    s.factory(m.pi);
    const transformed = await m.emit("input", { text: JUDGE_SENTINEL, source: "cli" });
    assert.equal(transformed.action, "transform");
    assert.equal(transformed.text, judgeFirstMessage(i));
    assert.deepEqual(await m.emit("input", { text: JUDGE_SENTINEL, source: "cli" }), { action: "continue" });
    const sections: Record<string, string> = {};
    await m.emit("before_agent_start", { systemPromptOptions: { sections } });
    assert.equal(sections[JUDGE_SECTION], judgeInstructions(i));
    await m.emit("message_end", { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "nothing to add" }], usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 } } } });
    await m.emit("session_shutdown", {});
    const rec = JSON.parse(fs.readFileSync(path.join(i.paths.runDir, "judge.json"), "utf8"));
    assert.equal(rec.status, "failed");
    assert.match(rec.error, /stopped without calling submit_contract\. Last message: nothing to add/);
    assert.equal(rec.usage.totalTokens, 7);
    assert.equal(rec.usage.cost.total, 0.5);
    await m.emit("message_end", { message: { role: "assistant", stopReason: "error", errorMessage: "401 no auth", content: [] } });
    assert.equal(s.record().error, "model error: 401 no auth");
  });
});

describe("MCP material capture", () => {
  test("text, structured content and images become material files with continuing ids", () => {
    const d = dir("mats");
    const existing: Material[] = [{ id: "M1", path: "/x/a.md", mediaType: "text/markdown", describe: "a", origin: { kind: "case" } }];
    const r = captureMcpResult({
      toolName: "mcp__figma__get_screenshot",
      input: { nodeId: "1:2" },
      content: [{ type: "text", text: "truncated..." }],
      structuredContent: {
        content: [
          { type: "text", text: "Frame Login" },
          { type: "image", data: PNG_1PX, mimeType: "image/png" },
          { type: "resource", resource: { uri: "figma://node/1:2", text: "node json" } },
        ],
        structuredContent: { width: 320 },
      },
      isError: false,
    }, existing, d);
    assert.deepEqual(r.captured.map((m) => [m.id, m.mediaType, m.origin.kind]), [
      ["M2", "text/plain", "figma"], ["M3", "application/json", "figma"], ["M4", "image/png", "figma"],
    ]);
    assert.equal(r.captured[0]?.origin.ref, "mcp__figma__get_screenshot {\"nodeId\":\"1:2\"}");
    assert.equal(fs.readFileSync(r.captured[0]?.path ?? "", "utf8"), "Frame Login\n\n[resource figma://node/1:2]\nnode json\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(r.captured[1]?.path ?? "", "utf8")), { width: 320 });
    assert.deepEqual(fs.readFileSync(r.captured[2]?.path ?? ""), Buffer.from(PNG_1PX, "base64"));
    assert.ok(r.captured[2]?.path.endsWith(".png"));
    assert.match(r.note, /^saved as M2 at .+M2-mcp__figma__get_screenshot\.txt \(text\/plain\)\nsaved as M3 at /);
  });

  test("errors and non-MCP tools are not captured; origin follows the server name", () => {
    const d = dir("mats-skip");
    assert.deepEqual(captureMcpResult({ toolName: "mcp__jira__get", input: {}, content: [{ type: "text", text: "x" }], isError: true }, [], d).captured, []);
    assert.deepEqual(captureMcpResult({ toolName: "mcp__jira__get", input: {}, content: [], structuredContent: { content: [{ type: "text", text: "nope" }], isError: true }, isError: false }, [], d).captured, []);
    assert.deepEqual(captureMcpResult({ toolName: "read", input: {}, content: [{ type: "text", text: "x" }], isError: false }, [], d).captured, []);
    assert.equal(originKindFor("mcp__atlassian__getJiraIssue"), "atlassian");
    assert.equal(originKindFor("mcp__confluence-cloud__page"), "atlassian");
    assert.equal(originKindFor("mcp__github__issue"), "other");
    assert.equal(nextMaterialNumber([{ id: "M3" } as Material, { id: "M10" } as Material]), 11);
    const plain = captureMcpResult({ toolName: "mcp__docs__fetch", input: {}, content: [{ type: "text", text: "plain" }], isError: false }, [], d);
    assert.deepEqual(plain.captured.map((m) => [m.id, m.origin.kind]), [["M1", "other"]]);
  });

  test("with MCP on, the judge session appends the note, keeps structuredContent and accepts the captured id", async () => {
    const i = input({ mcp: true });
    const s = judgeSession(i, path.join(i.paths.runDir, "judge.json"));
    const m = mockPi();
    s.factory(m.pi);
    const structuredContent = { content: [{ type: "text", text: "PROJ-1: login is slow" }] };
    const out = await m.emit("tool_result", {
      toolCallId: "t1", toolName: "mcp__atlassian__getJiraIssue", input: { key: "PROJ-1" },
      content: [{ type: "text", text: "PROJ-1: login is slow" }], structuredContent, isError: false,
    });
    assert.equal(out.content.length, 2);
    assert.match(out.content[1].text, new RegExp(`^saved as M2 at ${i.paths.materialsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(out.structuredContent, structuredContent);
    assert.equal(await m.emit("tool_result", { toolCallId: "t2", toolName: "read", input: {}, content: [], isError: false }), undefined);
    const ok = await callTool(m, SUBMIT_CONTRACT, { ...draft({ materialIds: ["M1", "M2"] }), rationale: "r" }, "s1");
    assert.equal(ok.isError, false);
    const rec = s.record();
    assert.deepEqual(rec.materials.map((x) => [x.id, x.origin.kind]), [["M2", "atlassian"]]);
    const c = checkDraft(rec.draft as JudgeDraft, i, [...i.materials, ...rec.materials]);
    assert.ok(c.ok && c.contract.materials.map((x) => x.id).join(",") === "M1,M2");
  });

  test("with MCP off, MCP tool results are left alone", async () => {
    const i = input();
    const m = mockPi();
    judgeSession(i, path.join(i.paths.runDir, "judge.json")).factory(m.pi);
    assert.equal(await m.emit("tool_result", { toolCallId: "t", toolName: "mcp__figma__x", input: {}, content: [{ type: "text", text: "x" }], isError: false }), undefined);
  });
});

describe("effort step", () => {
  const contract = (() => {
    const i = input();
    const r = checkDraft(draft(), i, i.materials);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    return r.contract;
  })();

  test("input has exactly the first message, the done conditions and the prohibitions", () => {
    const e = buildEffortInput(ORIGINAL, contract);
    assert.deepEqual(Object.keys(e).sort(), ["doneConditions", "firstMessage", "prohibitions", "schemaVersion"]);
    const text = effortFirstMessage(e);
    assert.ok(text.includes(`<<<\n${ORIGINAL}\n>>>`));
    assert.ok(text.includes("- D1 check.js passes (verified by running `node check.js` in `.`)"));
    assert.ok(text.includes("- D2 value.txt reads ok (reported by the agent: Show the file.)"));
    assert.ok(text.includes("- P1 Do not edit check.js."));
    assert.ok(!text.includes("- P2"));
    assert.ok(!text.includes("Make value.txt say ok."));
    const instr = effortInstructions();
    assert.ok(instr.startsWith(EFFORT_MARKER));
    for (const s of ["- low:", "thinks at level medium and may use no helper workers", "- extreme:", "up to 20 read-only helper workers", "lowest level"]) assert.ok(instr.includes(s), s);
  });

  test("decision: override wins, a valid submission is the classifier, anything else falls back to medium", () => {
    assert.deepEqual(decideEffort({ override: "extreme", record: null }), { level: "extreme", reason: "set with --effort", decidedBy: "override" });
    const rec = { status: "submitted" as const, level: "high" as const, reason: "big", usage: {} as never, durationMs: 1, toolLog: [] };
    assert.deepEqual(decideEffort({ record: rec }), { level: "high", reason: "big", decidedBy: "classifier" });
    assert.deepEqual(decideEffort({ record: { ...rec, level: "huge" as never } }).decidedBy, "fallback");
    const failed = decideEffort({ record: { ...rec, status: "failed", error: "model error: x" } });
    assert.deepEqual([failed.level, failed.decidedBy, failed.error], ["medium", "fallback", "model error: x"]);
    assert.equal(decideEffort({ record: null, failure: "timed out" }).error, "timed out");
  });

  test("session: submit_effort terminates and writes effort.json; the first input becomes the effort request", async () => {
    const out = path.join(dir("effort"), "effort.json");
    const e = buildEffortInput(ORIGINAL, contract);
    const s = effortSession(e, out);
    const m = mockPi();
    s.factory(m.pi);
    assert.equal((await m.emit("input", { text: EFFORT_SENTINEL, source: "cli" })).text, effortFirstMessage(e));
    const sections: Record<string, string> = {};
    await m.emit("before_agent_start", { systemPromptOptions: { sections } });
    assert.equal(sections[EFFORT_SECTION], effortInstructions());
    const r = await callTool(m, "submit_effort", { level: "high", reason: "many parts" }, "e1");
    assert.equal(r.result.terminate, true);
    const rec = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.deepEqual([rec.status, rec.level, rec.reason], ["submitted", "high", "many parts"]);
    const none = effortSession(e, path.join(dir("effort-none"), "effort.json"));
    none.factory(mockPi().pi);
    assert.match(none.write().error ?? "", /stopped without calling submit_effort/);
  });
});

describe("child processes", () => {
  test("judge and effort pi args: json print mode, no user extensions or context files, fixed tools, sentinel last", () => {
    const a = judgePiArgs({ model: "p/m", thinking: "high", mcp: false, sessionDir: "/s", extra: ["-e", "/f.ts"] });
    for (const f of ["--mode", "json", "-p", "-ne", "-nc", "-ns", "-np", "-na"]) assert.ok(a.includes(f), f);
    assert.equal(a[a.indexOf("--model") + 1], "p/m");
    assert.equal(a[a.indexOf("--thinking") + 1], "high");
    assert.equal(a[a.indexOf("--tools") + 1], "read,grep,find,ls,submit_contract");
    assert.equal(a[a.indexOf("--session-dir") + 1], "/s");
    assert.ok(!a.includes("builtin:mcp"));
    assert.deepEqual(a.slice(-4), ["-e", "/f.ts", "--", JUDGE_SENTINEL]);
    const mcp = judgePiArgs({ model: "p/m", thinking: "low", mcp: true, sessionDir: "/s" });
    assert.equal(mcp[mcp.indexOf("--tools") + 1], "read,grep,find,ls,submit_contract,tool_search");
    assert.ok(mcp.join(" ").includes("-e builtin:mcp -e builtin:tool-search"));
    const e = effortPiArgs({ model: "p/m", thinking: "high", sessionDir: "/e" });
    assert.equal(e[e.indexOf("--tools") + 1], "submit_effort");
    assert.deepEqual(e.slice(-2), ["--", EFFORT_SENTINEL]);
  });

  test("extra child args come from a JSON array in the environment", () => {
    assert.deepEqual(childExtraArgs({}), []);
    assert.deepEqual(childExtraArgs({ PI_HARNESS_CHILD_EXTRA_ARGS: "[\"-e\",\"/x.ts\"]" }), ["-e", "/x.ts"]);
    assert.throws(() => childExtraArgs({ PI_HARNESS_CHILD_EXTRA_ARGS: "[1]" }), /JSON array of strings/);
  });

  test("runChild saves stdout and stderr to files and kills a child that outlives the timeout", async () => {
    const d = dir("child");
    const ok = await runChild({
      command: process.execPath, args: ["-e", "process.stdout.write('{\"a\":1}\\n'); process.stderr.write('warn\\n')"], cwd: d,
      stdoutFile: path.join(d, "out.jsonl"), stderrFile: path.join(d, "err.log"),
    });
    assert.deepEqual([ok.exitCode, ok.timedOut], [0, false]);
    assert.equal(fs.readFileSync(path.join(d, "out.jsonl"), "utf8"), "{\"a\":1}\n");
    assert.equal(fs.readFileSync(path.join(d, "err.log"), "utf8"), "warn\n");
    const slow = await runChild({
      command: process.execPath, args: ["-e", "setTimeout(() => {}, 60000)"], cwd: d,
      stdoutFile: path.join(d, "o2"), stderrFile: path.join(d, "e2"), timeoutSec: 1,
    });
    assert.equal(slow.timedOut, true);
    assert.equal(slow.signal, "SIGTERM");
    const missing = await runChild({ command: path.join(d, "no-such-binary"), args: [], cwd: d, stdoutFile: path.join(d, "o3"), stderrFile: path.join(d, "e3") });
    assert.match(missing.spawnError ?? "", /ENOENT/);
  });

  test("fallback selection: success only when the record says submitted", () => {
    const files = { record: "/r/judge.json", stderr: "/r/judge.stderr.log" };
    const run = { exitCode: 0, signal: null, timedOut: false, durationMs: 5 };
    assert.equal(childFailure(run, { status: "submitted" }, "judge", files), undefined);
    assert.equal(childFailure({ ...run, timedOut: true, signal: "SIGTERM" }, null, "judge", files, 30), "the judge did not finish within 30 seconds");
    assert.equal(childFailure({ ...run, spawnError: "ENOENT" }, null, "judge", files), "the judge process could not start: ENOENT");
    assert.match(childFailure({ ...run, exitCode: 1 }, null, "judge", files) ?? "", /^the judge process exited with code 1 without writing judge\.json; see \/r\/judge\.stderr\.log$/);
    assert.match(childFailure({ ...run, exitCode: null, signal: "SIGKILL" }, null, "judge", files) ?? "", /was killed by SIGKILL/);
    assert.equal(childFailure(run, { status: "failed", error: "the judge made 3 invalid submissions" }, "judge", files), "the judge made 3 invalid submissions");
  });
});
