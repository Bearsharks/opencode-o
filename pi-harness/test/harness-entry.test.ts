import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildFixedContract } from "../src/contract/build.ts";
import { runtimeFor } from "../src/contract/effort.ts";
import type { Contract, EffortLevel } from "../src/contract/schema.ts";
import { CANCEL_COMMAND, type EntryDeps, EventsTail, isEscapeKey, PendingEntry, STATUS_KEY, WIDGET_KEY } from "../src/harness/entry.ts";
import { harness } from "../src/harness/index.ts";
import { ENTRY_CONTRACT } from "../src/harness/types.ts";
import { buildJudgeContract, type JudgeBuildInput, type JudgeOptions } from "../src/judge/builder.ts";
import { runChild } from "../src/judge/child.ts";
import { judgeFirstMessage } from "../src/judge/prompt.ts";
import { buildJudgeInput } from "../src/judge/input.ts";
import { checkInteractiveArgs, harnessOffReason } from "../src/launcher/interactive.ts";
import { CliError } from "../src/launcher/work.ts";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-entry-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const PNG = { type: "image" as const, data: "iVBORw0KGgo=", mimeType: "image/png" };
const TEXT = "  @value.txt must say ok -- fix it\n(keep \"quotes\" and 한국어)\n";

let counter = 0;
function repo(name: string): { repo: string; runs: string } {
  const dir = path.join(tmp, `${++counter}-${name}`);
  const r = path.join(dir, "repo");
  fs.mkdirSync(r, { recursive: true });
  fs.writeFileSync(path.join(r, "a.txt"), "a\n");
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: r });
  execFileSync("git", ["add", "-A"], { cwd: r });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: r, env: gitEnv });
  return { repo: r, runs: path.join(dir, "runs") };
}

function judgeContract(input: JudgeBuildInput, level: EffortLevel): Contract {
  const base = buildFixedContract({ ...input, source: "fixed" });
  return { ...base, source: "judge", goal: { original: input.original, refined: "Make value.txt say ok." }, effort: { level, decidedBy: "classifier" }, runtime: runtimeFor(level, input.model) };
}

const until = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
};

type Note = { message: string; level: string | undefined };

function fakePi(opts: { entries?: unknown[]; commands?: Array<{ name: string; source: string }>; model?: { provider: string; id: string } | null; idle?: boolean } = {}) {
  const handlers = new Map<string, Array<(e: any, c: any) => any>>();
  const appended: Array<{ type: string; data: any }> = [];
  const notes: Note[] = [];
  const widgets: Array<string[] | undefined> = [];
  const statuses: Array<string | undefined> = [];
  const sent: Array<{ content: unknown; options: unknown }> = [];
  const registered: string[] = [];
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
  const keyHandlers = new Set<(data: string) => any>();
  let active = ["read", "bash", "edit", "write"];
  let thinking: string | undefined;
  let editor = "";
  let entries = opts.entries ?? [];
  const ctx = (cwd: string) => ({
    hasUI: true, cwd, mode: "tui",
    model: opts.model === null ? undefined : (opts.model ?? { provider: "faux", id: "faux-1" }),
    isIdle: () => opts.idle ?? true,
    ui: {
      notify: (message: string, level?: string) => notes.push({ message, level }),
      setWidget: (key: string, lines: string[] | undefined) => { if (key === WIDGET_KEY) widgets.push(lines); },
      setStatus: (key: string, text: string | undefined) => { if (key === STATUS_KEY) statuses.push(text); },
      onTerminalInput: (h: (data: string) => any) => { keyHandlers.add(h); return () => keyHandlers.delete(h); },
      getEditorText: () => editor,
      setEditorText: (t: string) => { editor = t; },
    },
    sessionManager: { getBranch: () => entries },
    getSystemPrompt: () => "",
  });
  const pi = {
    on(ev: string, h: (e: any, c: any) => any) {
      const list = handlers.get(ev) ?? [];
      list.push(h);
      handlers.set(ev, list);
      return () => {};
    },
    registerTool(t: { name: string }) {
      registered.push(t.name);
      if (!active.includes(t.name)) active = [...active, t.name];
    },
    registerCommand(name: string, o: { handler: (args: string, ctx: any) => Promise<void> }) { commands.set(name, o.handler); },
    appendEntry(type: string, data: unknown) { appended.push({ type, data }); },
    getCommands() { return opts.commands ?? []; },
    sendUserMessage(content: unknown, options: unknown) { sent.push({ content, options }); },
    setThinkingLevel(level: string) { thinking = level; },
    getActiveTools() { return [...active]; },
    setActiveTools(names: string[]) { active = [...names]; },
  };
  return {
    pi: pi as unknown as ExtensionAPI,
    appended, notes, widgets, statuses, sent, registered,
    active: () => active,
    thinking: () => thinking,
    editor: () => editor,
    setEditor: (t: string) => { editor = t; },
    setEntries: (e: unknown[]) => { entries = e; },
    command: (name: string, cwd: string) => commands.get(name)?.("", ctx(cwd)),
    key: (data: string) => [...keyHandlers].map((h) => h(data)).find((r) => r !== undefined),
    keyHandlers,
    emit: async (ev: string, event: Record<string, unknown>, cwd: string) => {
      let out: unknown;
      for (const h of handlers.get(ev) ?? []) out = await h({ type: ev, ...event }, ctx(cwd));
      return out as any;
    },
  };
}

type Calls = { build: Array<{ input: JudgeBuildInput; opts: JudgeOptions }> };

function deps(r: { repo: string; runs: string }, over: Partial<EntryDeps> & { level?: EffortLevel } = {}): { deps: EntryDeps; calls: Calls } {
  const calls: Calls = { build: [] };
  let n = 0;
  const d: EntryDeps = {
    offReason: null,
    resolveTarget: () => ({ repo: { root: r.repo, headSha: "abc", branch: "main", repoKey: "repo" }, repoConfig: { repoKey: "repo", completionSteps: [{ title: "Check", command: "node check.js" }] } }),
    newRunDir: () => {
      const runDir = path.join(r.runs, `run-${++n}`);
      const paths = { runDir, materialsDir: path.join(runDir, "materials") };
      for (const p of Object.values(paths)) fs.mkdirSync(p, { recursive: true });
      return paths;
    },
    buildContract: async (input, opts) => {
      calls.build.push({ input, opts });
      opts.onPhase?.("judge");
      opts.onPhase?.("effort");
      return judgeContract(input, over.level ?? "medium");
    },
    judge: { thinking: "high", mcp: false, childExtraArgs: [] },
    eventsFile: (runDir, phase) => path.join(runDir, phase === "judge" ? "judge.events.jsonl" : "effort.events.jsonl"),
    tickMs: 10,
    ...over,
  };
  return { deps: d, calls };
}

function start(r: { repo: string; runs: string }, f: ReturnType<typeof fakePi>, over: Parameters<typeof deps>[1] = {}) {
  const { deps: d, calls } = deps(r, over);
  const entry = new PendingEntry(d);
  harness({ mode: "interactive", entry })(f.pi);
  return { entry, calls };
}

describe("interactive pending entry", () => {
  test("slash commands, extension input and the startup state pass through untouched", async () => {
    const r = repo("pass");
    const f = fakePi({ commands: [{ name: "skill:fix", source: "skill" }, { name: "review", source: "prompt" }] });
    const { entry, calls } = start(r, f);
    await f.emit("session_start", { reason: "startup" }, r.repo);
    assert.equal(entry.state, "pending");
    assert.equal(f.statuses.at(-1), "pi-harness: 첫 작업 메시지를 기다리는 중");
    assert.equal(f.appended.length, 0);
    assert.deepEqual(await f.emit("input", { text: "/skill:fix the bug", source: "interactive" }, r.repo), { action: "continue" });
    assert.deepEqual(await f.emit("input", { text: "/review", source: "interactive" }, r.repo), { action: "continue" });
    assert.deepEqual(await f.emit("input", { text: "from another extension", source: "extension" }, r.repo), { action: "continue" });
    const event = { messageType: "user", systemPromptOptions: { sections: {} as Record<string, string> } };
    await f.emit("before_agent_start", event, r.repo);
    assert.equal(event.systemPromptOptions.sections.session_contract, undefined);
    assert.equal(calls.build.length, 0);
    assert.ok(!f.active().includes("run_workers"));
  });

  test("the first task message is judged, the contract applied and the message sent verbatim with its images", async () => {
    const r = repo("success");
    const f = fakePi();
    const { entry, calls } = start(r, f, { level: "medium" });
    await f.emit("session_start", { reason: "startup" }, r.repo);
    const res = await f.emit("input", { text: TEXT, images: [PNG], source: "interactive" }, r.repo);
    assert.deepEqual(res, { action: "handled" });
    await until(() => f.sent.length === 1);
    assert.equal(entry.state, "active");
    const { input, opts } = calls.build[0]!;
    assert.equal(input.original, TEXT);
    assert.equal(input.model, "faux/faux-1");
    assert.equal(input.attachedImages, 1);
    assert.deepEqual(input.materials, []);
    assert.equal(opts.thinking, "high");
    assert.ok(opts.signal instanceof AbortSignal);
    const contract = JSON.parse(fs.readFileSync(path.join(input.paths.runDir, "contract.json"), "utf8")) as Contract;
    assert.equal(contract.goal.original, TEXT);
    const entries = f.appended.filter((a) => a.type === ENTRY_CONTRACT);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.data.contract.contractId, contract.contractId);
    assert.equal(entries[0]?.data.runDir, input.paths.runDir);
    assert.deepEqual(Object.keys(entries[0]?.data).sort(), ["contract", "runDir"]);
    assert.equal(f.thinking(), "high");
    assert.deepEqual(f.registered, ["run_workers"]);
    assert.ok(f.active().includes("run_workers"));
    assert.ok(f.widgets.some((w) => w?.[0]?.includes("노력 수준을 정하는 중")));
    assert.equal(f.widgets.at(-1), undefined);
    assert.ok(f.notes.some((n) => n.message.includes("이번 작업의 계약입니다") && n.message.includes(input.paths.runDir)));
    assert.deepEqual(f.sent[0], { content: [{ type: "text", text: TEXT }, PNG], options: undefined });
    assert.equal(f.keyHandlers.size, 0);

    assert.deepEqual(await f.emit("input", { text: TEXT, images: [PNG], source: "extension" }, r.repo), { action: "continue" });
    const event = { messageType: "user", systemPromptOptions: { sections: {} as Record<string, string> } };
    await f.emit("before_agent_start", event, r.repo);
    assert.ok(event.systemPromptOptions.sections.session_contract?.includes("Make value.txt say ok."));
    assert.deepEqual(fs.readdirSync(input.paths.runDir).sort(), ["contract.json", "materials"]);
  });

  test("a low effort contract keeps run_workers away and sets its thinking level; a text-only message is sent as a string", async () => {
    const r = repo("low");
    const f = fakePi();
    start(r, f, { level: "low" });
    await f.emit("session_start", { reason: "startup" }, r.repo);
    await f.emit("input", { text: "rename a.txt", source: "interactive" }, r.repo);
    await until(() => f.sent.length === 1);
    assert.equal(f.thinking(), "medium");
    assert.ok(!f.registered.includes("run_workers"));
    assert.ok(!f.active().includes("run_workers"));
    assert.deepEqual(f.sent[0], { content: "rename a.txt", options: undefined });
  });

  test("progress shows elapsed time, the number of judge tool calls and the last tool from judge.events.jsonl", async () => {
    const r = repo("progress");
    const f = fakePi();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    start(r, f, {
      buildContract: async (input, opts) => {
        opts.onPhase?.("judge");
        const file = path.join(input.paths.runDir, "judge.events.jsonl");
        fs.writeFileSync(file, `${JSON.stringify({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "src/a.ts" } })}\n{"type":"tool_exec`);
        await gate;
        return judgeContract(input, "medium");
      },
    });
    await f.emit("session_start", { reason: "startup" }, r.repo);
    await f.emit("input", { text: "fix it", source: "interactive" }, r.repo);
    await until(() => f.widgets.some((w) => w?.[0]?.includes("판정 도구 호출 1회 · 마지막: read src/a.ts")));
    const w = f.widgets.findLast((x) => x !== undefined)!;
    assert.match(w[0]!, /첫 메시지로 작업 계약을 만드는 중입니다 · \d+초/);
    assert.match(w[1]!, /Esc 또는 \/harness-cancel로 취소/);
    release();
    await until(() => f.sent.length === 1);
  });

  test("Esc and /harness-cancel cancel the judge, return to pending and put the message back; the next message judges again", async () => {
    const r = repo("cancel");
    const f = fakePi();
    let aborted = 0;
    const { entry, calls } = start(r, f, {
      buildContract: (input, opts) => new Promise((resolve, reject) => {
        calls.build.push({ input, opts });
        opts.onPhase?.("judge");
        if (calls.build.length === 3) {
          resolve(judgeContract(input, "medium"));
          return;
        }
        opts.signal?.addEventListener("abort", () => { aborted++; reject(new Error("the judge was cancelled")); });
      }),
    });
    await f.emit("session_start", { reason: "startup" }, r.repo);
    await f.emit("input", { text: "first try", source: "interactive" }, r.repo);
    await until(() => entry.state === "judging" && f.keyHandlers.size === 1);
    assert.equal(f.key("x"), undefined);
    assert.deepEqual(f.key("\u001b"), { consume: true });
    await until(() => entry.state === "pending");
    assert.equal(aborted, 1);
    assert.equal(f.editor(), "first try");
    assert.ok(f.notes.some((n) => n.message.includes("계약 판정을 취소했습니다")));
    assert.equal(f.keyHandlers.size, 0);
    assert.equal(f.widgets.at(-1), undefined);

    f.setEditor("");
    await f.emit("input", { text: "second try", source: "interactive" }, r.repo);
    await until(() => entry.state === "judging");
    await f.command(CANCEL_COMMAND, r.repo);
    await until(() => entry.state === "pending");
    assert.equal(aborted, 2);
    assert.equal(f.editor(), "second try");
    assert.equal(f.appended.filter((a) => a.type === ENTRY_CONTRACT).length, 0);
    assert.equal(f.sent.length, 0);

    await f.emit("input", { text: "third try", source: "interactive" }, r.repo);
    await until(() => f.sent.length === 1);
    assert.equal(f.sent[0]?.content, "third try");
    await f.command(CANCEL_COMMAND, r.repo);
    assert.ok(f.notes.at(-1)?.message.includes("취소할 계약 판정이 없습니다"));
  });

  test("more input while judging is not sent and the user is told that judging is in progress", async () => {
    const r = repo("extra");
    const f = fakePi();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const { entry, calls } = start(r, f, {
      buildContract: async (input) => {
        await gate;
        return judgeContract(input, "medium");
      },
    });
    await f.emit("session_start", { reason: "startup" }, r.repo);
    await f.emit("input", { text: "the task", source: "interactive" }, r.repo);
    await until(() => entry.state === "judging");
    const res = await f.emit("input", { text: "and also this", source: "interactive" }, r.repo);
    assert.deepEqual(res, { action: "handled" });
    assert.ok(f.notes.some((n) => n.level === "warning" && n.message === "아직 첫 메시지의 작업 계약을 만드는 중입니다."));
    release();
    await until(() => f.sent.length === 1);
    assert.deepEqual(f.sent.map((s) => s.content), ["the task"]);
    assert.equal(calls.build.length, 0);
  });

  test("a builder error falls back to the fixed contract with a visible notice and still starts the work", async () => {
    const r = repo("throw");
    const f = fakePi();
    start(r, f, { buildContract: async () => { throw new Error("boom"); } });
    await f.emit("session_start", { reason: "startup" }, r.repo);
    await f.emit("input", { text: "do it", source: "interactive" }, r.repo);
    await until(() => f.sent.length === 1);
    const data = f.appended.find((a) => a.type === ENTRY_CONTRACT)?.data;
    assert.equal(data.contract.source, "fallback");
    assert.deepEqual(data.contract.effort, { level: "medium", decidedBy: "fallback" });
    assert.ok(f.notes.some((n) => n.level === "warning" && n.message.includes("대체 계약을 사용합니다. 이유: boom")));
  });

  test("a judge child that fails leads to the builder's fallback contract with a visible notice", async () => {
    const r = repo("child-fail");
    const agent = path.join(tmp, "child-fail-agent");
    fs.mkdirSync(agent, { recursive: true });
    const env = { ...process.env, HOME: path.join(tmp, "child-fail-home"), PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_TELEMETRY: "0" };
    const f = fakePi({ model: { provider: "nope", id: "missing-model" } });
    const { deps: d } = deps(r);
    const entry = new PendingEntry({
      ...d,
      buildContract: buildJudgeContract,
      judge: { thinking: "high", mcp: false, childExtraArgs: [], env, agentDir: agent, timeoutSec: 60 },
    });
    harness({ mode: "interactive", entry })(f.pi);
    await f.emit("session_start", { reason: "startup" }, r.repo);
    await f.emit("input", { text: "do it", source: "interactive" }, r.repo);
    await until(() => f.sent.length === 1, 60_000);
    const data = f.appended.find((a) => a.type === ENTRY_CONTRACT)?.data;
    assert.equal(data.contract.source, "fallback");
    assert.equal(data.contract.runtime.model, "nope/missing-model");
    assert.ok(f.notes.some((n) => n.level === "warning" && n.message.includes("판정 단계가 실패해 대체 계약을 사용합니다")));
    assert.ok(fs.existsSync(path.join(data.runDir, "judge-input.json")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(data.runDir, "judge.json"), "utf8")).fallback, true);
    assert.equal(f.sent[0]?.content, "do it");
  });

  test("a session that already has a contract skips pending and uses it", async () => {
    const r = repo("resume");
    const runDir = path.join(r.runs, "old");
    const contract = judgeContract({
      original: "old task", repo: { root: r.repo, headSha: "abc", repoKey: "repo" },
      paths: { runDir, materialsDir: path.join(runDir, "m") }, model: "faux/faux-1", repoConfig: null, materials: [],
    }, "high");
    const f = fakePi({ entries: [{ type: "custom", customType: ENTRY_CONTRACT, data: { contract, runDir } }] });
    const { entry, calls } = start(r, f);
    await f.emit("session_start", { reason: "resume" }, r.repo);
    assert.equal(entry.state, "active");
    assert.ok(f.notes.some((n) => n.message.includes("이번 작업의 계약입니다")));
    assert.ok(f.active().includes("run_workers"));
    assert.deepEqual(await f.emit("input", { text: "follow-up request", source: "interactive" }, r.repo), { action: "continue" });
    const event = { messageType: "user", systemPromptOptions: { sections: {} as Record<string, string> } };
    await f.emit("before_agent_start", event, r.repo);
    assert.ok(event.systemPromptOptions.sections.session_contract?.includes("old task"));
    assert.equal(calls.build.length, 0);
    assert.equal(f.appended.filter((a) => a.type === ENTRY_CONTRACT).length, 0);

    f.setEntries([]);
    await f.emit("session_start", { reason: "new" }, r.repo);
    assert.equal(entry.state, "pending");
    assert.ok(!f.active().includes("run_workers"));
  });

  test("outside a git repository the harness is off: a notice, and every input passes through", async () => {
    const dir = path.join(tmp, "not-git");
    fs.mkdirSync(dir, { recursive: true });
    const reason = harnessOffReason(dir);
    assert.match(reason ?? "", /git 저장소 안에 있지 않아/);
    const f = fakePi();
    const { entry, calls } = start({ repo: dir, runs: path.join(dir, "runs") }, f, { offReason: reason });
    await f.emit("session_start", { reason: "startup" }, dir);
    assert.equal(entry.state, "off");
    assert.equal(f.statuses.at(-1), "pi-harness: 꺼짐");
    assert.ok(f.notes.some((n) => n.level === "warning" && n.message === reason));
    assert.deepEqual(await f.emit("input", { text: "do something", source: "interactive" }, dir), { action: "continue" });
    assert.equal(calls.build.length, 0);
    assert.equal(f.appended.length, 0);
  });

  test("a repository without commits also turns the harness off", () => {
    const dir = path.join(tmp, "no-commit");
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", "-q", "."], { cwd: dir });
    assert.match(harnessOffReason(dir) ?? "", /커밋이 아직 없어/);
    assert.equal(harnessOffReason(repo("ok").repo), null);
  });

  test("without a selected model the message goes back to the editor and the entry stays pending", async () => {
    const r = repo("no-model");
    const f = fakePi({ model: null });
    const { entry, calls } = start(r, f);
    await f.emit("session_start", { reason: "startup" }, r.repo);
    await f.emit("input", { text: "do it", source: "interactive" }, r.repo);
    await until(() => entry.state === "pending" && f.editor() === "do it");
    assert.ok(f.notes.some((n) => n.level === "error" && n.message.includes("/login")));
    assert.equal(calls.build.length, 0);
  });

  test("a new session while judging aborts the judge and discards its result", async () => {
    const r = repo("switch");
    const f = fakePi();
    let signal: AbortSignal | undefined;
    const { entry } = start(r, f, {
      buildContract: (input, opts) => new Promise((resolve) => {
        signal = opts.signal;
        opts.signal?.addEventListener("abort", () => resolve(judgeContract(input, "medium")));
      }),
    });
    await f.emit("session_start", { reason: "startup" }, r.repo);
    await f.emit("input", { text: "task", source: "interactive" }, r.repo);
    await until(() => signal !== undefined);
    await f.emit("session_start", { reason: "new" }, r.repo);
    assert.equal(signal?.aborted, true);
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(entry.state, "pending");
    assert.equal(f.sent.length, 0);
    assert.equal(f.appended.filter((a) => a.type === ENTRY_CONTRACT).length, 0);
  });
});

describe("interactive entry helpers", () => {
  test("EventsTail counts tool starts across partial writes and keeps the last tool and path", () => {
    const file = path.join(tmp, "events.jsonl");
    const t = new EventsTail(file);
    t.read();
    assert.equal(t.calls, 0);
    fs.writeFileSync(file, `${JSON.stringify({ type: "message_end" })}\n{"type":"tool_execution_start","toolName":"grep","args":{"pat`);
    t.read();
    assert.equal(t.calls, 0);
    fs.appendFileSync(file, `tern":"TODO","path":"src"}}\n${JSON.stringify({ type: "tool_execution_start", toolName: "ls", args: {} })}\n`);
    t.read();
    assert.equal(t.calls, 2);
    assert.equal(t.last, "ls");
  });

  test("Esc is recognised in legacy and kitty encodings only", () => {
    assert.ok(isEscapeKey("\u001b"));
    assert.ok(isEscapeKey("\u001b[27u"));
    assert.ok(isEscapeKey("\u001b[27;1:1u"));
    assert.ok(!isEscapeKey("\u001b[27;1:3u"));
    assert.ok(!isEscapeKey("\u001b[A"));
  });

  test("the judge request mentions attached images without changing the original text", () => {
    const r = repo("images");
    const paths = { runDir: path.join(r.runs, "x"), materialsDir: path.join(r.runs, "m") };
    const base = { original: TEXT, repo: { root: r.repo, headSha: "abc", repoKey: "repo" }, repoConfig: null, materials: [], paths, model: "faux/faux-1", mcp: false, agentDir: path.join(tmp, "no-agent") };
    const withImages = buildJudgeInput({ ...base, attachedImages: 2 });
    assert.equal(withImages.attachedImages, 2);
    assert.equal(withImages.original, TEXT);
    assert.match(judgeFirstMessage(withImages), /attached 2 images to this request/);
    const plain = buildJudgeInput(base);
    assert.equal("attachedImages" in plain, false);
    assert.doesNotMatch(judgeFirstMessage(plain), /attached/);
  });

  test("runChild stops a running child when its signal aborts", async () => {
    const dir = path.join(tmp, "abort-child");
    const ac = new AbortController();
    const p = runChild({
      command: process.execPath, args: ["-e", "setTimeout(() => {}, 30000)"], cwd: tmp,
      stdoutFile: path.join(dir, "out"), stderrFile: path.join(dir, "err"), signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 100);
    const run = await p;
    assert.equal(run.aborted, true);
    assert.ok(run.durationMs < 5000);
    const pre = await runChild({ command: process.execPath, args: ["-e", ""], cwd: tmp, stdoutFile: path.join(dir, "o2"), stderrFile: path.join(dir, "e2"), signal: AbortSignal.abort() });
    assert.equal(pre.aborted, true);
  });

  test("checkInteractiveArgs refuses non-interactive use unless the test switch allows rpc", () => {
    const tty = { stdinTTY: true, stdoutTTY: true };
    assert.equal(checkInteractiveArgs(["--model", "a/b"], tty, {}).model, "a/b");
    assert.throws(() => checkInteractiveArgs(["--mode", "json"], tty, {}), (e: unknown) => e instanceof CliError && /--mode json[\s\S]*pi-harness run/.test(e.message));
    assert.throws(() => checkInteractiveArgs(["-p", "hi"], tty, {}), /--print/);
    assert.throws(() => checkInteractiveArgs(["--mode", "rpc"], tty, {}), /--mode rpc/);
    assert.throws(() => checkInteractiveArgs([], { stdinTTY: false, stdoutTTY: true }, {}), /needs a terminal/);
    assert.throws(() => checkInteractiveArgs(["--mode", "json"], tty, { PI_HARNESS_ALLOW_NONINTERACTIVE: "1" }), /--mode json/);
    assert.equal(checkInteractiveArgs(["--mode", "rpc"], { stdinTTY: false, stdoutTTY: false }, { PI_HARNESS_ALLOW_NONINTERACTIVE: "1" }).mode, "rpc");
    assert.equal(checkInteractiveArgs(["--version"], { stdinTTY: false, stdoutTTY: false }, {}).version, true);
  });
});
