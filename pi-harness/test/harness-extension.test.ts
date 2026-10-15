import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runtimeFor } from "../src/contract/effort.ts";
import type { Contract } from "../src/contract/schema.ts";
import { harness } from "../src/harness/index.ts";
import { ENTRY_CONTRACT, INITIAL_GOAL_SENTINEL } from "../src/harness/types.ts";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-ext-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const at = "2026-10-15T00:00:00.000Z";

function setup(name: string, over: Partial<Contract> = {}) {
  const dir = path.join(tmp, name);
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const contract: Contract = {
    schemaVersion: 1, contractId: `c-${name}`, createdAt: at, source: "file",
    repo: { root: repo, headSha: "x", repoKey: "repo" },
    goal: { original: "@goal -with odd start", refined: "Goal." },
    doneConditions: [
      { id: "D1", statement: "tests", verify: { kind: "command", command: "npm test", cwd: ".", equivalents: [], allowExtraArgs: false, timeoutSec: 30 } },
      { id: "D2", statement: "looks right", verify: { kind: "reported", how: "look", checks: [] } },
    ],
    prohibitions: [{ id: "P1", text: "Do not touch a.txt.", source: { kind: "user-message", ref: "a.txt" } }],
    materials: [],
    effort: { level: "medium", decidedBy: "fixed" },
    runtime: runtimeFor("medium", "p/m"),
    paths: { runDir: path.join(dir, "run"), materialsDir: path.join(dir, "mat") },
    ...over,
  };
  return { dir, repo, contract, runDir: contract.paths.runDir };
}

function fake(entries: unknown[] = []) {
  const handlers = new Map<string, Array<(e: any, c: any) => any>>();
  const appended: Array<{ type: string; data: any }> = [];
  const notes: string[] = [];
  let commands: Array<{ name: string; source: string }> = [];
  const pi = {
    on(ev: string, h: (e: any, c: any) => any) {
      const list = handlers.get(ev) ?? [];
      list.push(h);
      handlers.set(ev, list);
      return () => {};
    },
    registerTool() {},
    appendEntry(type: string, data: unknown) { appended.push({ type, data }); },
    getCommands() { return commands; },
  };
  const ctx = (cwd: string) => ({
    hasUI: true, cwd,
    ui: { notify: (m: string) => notes.push(m) },
    sessionManager: { getBranch: () => entries },
    getSystemPrompt: () => "<session_contract>x</session_contract>",
  });
  return {
    pi: pi as unknown as ExtensionAPI,
    appended, notes, events: () => [...handlers.keys()].sort(),
    setCommands: (c: typeof commands) => { commands = c; },
    emit: async (ev: string, event: Record<string, unknown>, cwd: string) => {
      let out: unknown;
      for (const h of handlers.get(ev) ?? []) out = await h({ type: ev, ...event }, ctx(cwd));
      return out as any;
    },
  };
}

describe("harness extension wiring", () => {
  test("start: appends the contract once and delivers the goal through the sentinel", async () => {
    const s = setup("start");
    const f = fake();
    harness({ contract: s.contract, runDir: s.runDir, mode: "start" })(f.pi);
    await f.emit("session_start", { reason: "startup" }, s.repo);
    assert.equal(f.appended.filter((a) => a.type === ENTRY_CONTRACT).length, 1);
    assert.ok(f.notes[0]?.includes("이번 작업의 계약입니다"));
    const r = await f.emit("input", { text: INITIAL_GOAL_SENTINEL, source: "interactive" }, s.repo);
    assert.deepEqual(r, { action: "transform", text: s.contract.goal.original });
    const again = await f.emit("input", { text: INITIAL_GOAL_SENTINEL, source: "interactive" }, s.repo);
    assert.deepEqual(again, { action: "continue" });
    const event = { messageType: "user", systemPromptOptions: { sections: {} as Record<string, string> } };
    await f.emit("before_agent_start", event, s.repo);
    assert.ok(event.systemPromptOptions.sections.session_contract?.includes(s.contract.goal.original));
  });

  test("start: piped content before the sentinel is kept and the goal follows verbatim", async () => {
    const s = setup("prefix");
    const f = fake();
    harness({ contract: s.contract, runDir: s.runDir, mode: "start" })(f.pi);
    await f.emit("session_start", { reason: "startup" }, s.repo);
    const r = await f.emit("input", { text: `piped\n${INITIAL_GOAL_SENTINEL}`, source: "interactive" }, s.repo);
    assert.equal(r.text, `piped\n${s.contract.goal.original}`);
  });

  test("start: a goal that pi would expand as a prompt template is refused", async () => {
    const s = setup("slash", { goal: { original: "/review the diff", refined: "Review." } });
    const f = fake();
    f.setCommands([{ name: "review", source: "prompt" }]);
    harness({ contract: s.contract, runDir: s.runDir, mode: "start" })(f.pi);
    await f.emit("session_start", { reason: "startup" }, s.repo);
    const previous = process.exitCode;
    const r = await f.emit("input", { text: INITIAL_GOAL_SENTINEL, source: "interactive" }, s.repo);
    assert.deepEqual(r, { action: "handled" });
    assert.equal(process.exitCode, 1);
    process.exitCode = previous;
    assert.match(fs.readFileSync(path.join(s.runDir, "harness.log"), "utf8"), /prompt template/);
  });

  test("start: only injects the contract and registers no gate, ledger or report handlers", async () => {
    const s = setup("events");
    const f = fake();
    harness({ contract: s.contract, runDir: s.runDir, mode: "start" })(f.pi);
    assert.deepEqual(f.events(), ["before_agent_start", "input", "session_shutdown", "session_start"]);
  });

  test("resume: uses the contract entry of the session and injects it", async () => {
    const s = setup("resume");
    const entries = [{ type: "custom", customType: ENTRY_CONTRACT, data: { contract: s.contract, runDir: s.runDir } }];
    const f = fake(entries);
    harness({ contract: { ...s.contract, contractId: "other" }, runDir: s.runDir, mode: "resume" })(f.pi);
    await f.emit("session_start", { reason: "startup" }, s.repo);
    assert.equal(f.appended.length, 0);
    assert.deepEqual(await f.emit("input", { text: "next", source: "interactive" }, s.repo), { action: "continue" });
    const event = { messageType: "user", systemPromptOptions: { sections: {} as Record<string, string> } };
    await f.emit("before_agent_start", event, s.repo);
    assert.match(event.systemPromptOptions.sections.session_contract ?? "", /Do not touch a\.txt/);
    assert.match(fs.readFileSync(path.join(s.runDir, "harness.log"), "utf8"), /already has contract c-resume/);
  });
});
