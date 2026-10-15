import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MCP_SERVER_PATH, swarmExtension } from "../src/extension.ts";
import { renderRole } from "../src/role.ts";
import { type AgentRow, makeAgentDirs, readState, type SwarmState, writeState } from "../src/state.ts";
import { sendMessage } from "../src/tools.ts";
import { tempRoot } from "./helpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await sleep(10);
  }
}

function stateDir(): string {
  const dir = path.join(tempRoot("swarm-ext-"), "state");
  const row = (name: string, role: AgentRow["role"]): AgentRow => ({
    name, role, contextDir: path.join(dir, "agents", name, "context"), cwd: "/r", branch: "main", createdAt: "t",
  });
  const state: SwarmState = { repoRoot: "/r", baseBranch: "main", tmuxSession: "swarm-r", worktreeRoot: "/r-swarm", agents: [row("front", "front"), row("architect", "architect")] };
  fs.mkdirSync(dir, { recursive: true });
  for (const a of state.agents) makeAgentDirs(dir, a.name);
  writeState(dir, state);
  return dir;
}

type Sent = { text: string; options?: { deliverAs?: string } };

function fakePi() {
  const handlers = new Map<string, Array<(e: any, c: any) => any>>();
  const sent: Sent[] = [];
  const mcp: Array<{ name: string; config: any }> = [];
  let throwOnSend = false;
  const pi = {
    on(ev: string, h: (e: any, c: any) => any) {
      handlers.set(ev, [...(handlers.get(ev) ?? []), h]);
      return () => {};
    },
    registerMcpServer(name: string, config: unknown) { mcp.push({ name, config }); },
    sendUserMessage(text: string, options?: { deliverAs?: string }) {
      if (throwOnSend) throw new Error("stale");
      sent.push(options === undefined ? { text } : { text, options });
    },
  };
  const ctx = { idle: true, isIdle() { return this.idle; } };
  const emit = (ev: string, e: any = {}) => { for (const h of handlers.get(ev) ?? []) h({ type: ev, ...e }, ctx); };
  return {
    pi: pi as unknown as ExtensionAPI, sent, mcp, ctx, emit, handlers,
    setThrow(v: boolean) { throwOnSend = v; },
  };
}

function load(dir: string, opts: { hasInitialMessage?: boolean; intervalMs?: number } = {}) {
  const f = fakePi();
  swarmExtension({ dir, name: "front", intervalMs: 20, ...opts })(f.pi);
  return f;
}

const inbox = (dir: string) => fs.readdirSync(path.join(dir, "agents/front/inbox")).filter((n) => n.endsWith(".json"));
const read = (dir: string) => fs.readdirSync(path.join(dir, "agents/front/inbox/read")).filter((n) => n.endsWith(".json"));

test("registers the swarm MCP server with direct exposure and no watcher before session_start", async () => {
  const dir = stateDir();
  const f = load(dir);
  assert.equal(f.mcp.length, 1);
  assert.equal(f.mcp[0]!.name, "swarm");
  const c = f.mcp[0]!.config;
  assert.equal(c.command, process.execPath);
  assert.deepEqual(c.args, [MCP_SERVER_PATH]);
  assert.ok(fs.existsSync(c.args[0]));
  assert.deepEqual(c.env, { PI_SWARM_DIR: dir, PI_SWARM_AGENT: "front" });
  assert.equal(c.exposure, "direct");
  assert.equal(typeof c.description, "string");
  sendMessage(dir, "architect", "front", "x");
  await sleep(80);
  assert.equal(f.sent.length, 0);
});

test("before_agent_start renders the role from the current agents.json", () => {
  const dir = stateDir();
  const f = load(dir);
  const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
  f.emit("before_agent_start", event);
  const state = readState(dir);
  assert.equal(event.systemPromptOptions.sections.swarm, renderRole(state, state.agents[0]!));
  writeState(dir, { ...state, baseBranch: "develop" });
  f.emit("before_agent_start", event);
  assert.match(event.systemPromptOptions.sections.swarm!, /develop에 합치고/);
});

test("pending messages at start: first sent while idle, the rest steered once busy, all moved to read once", async () => {
  const dir = stateDir();
  sendMessage(dir, "architect", "front", "one");
  sendMessage(dir, "architect", "front", "two");
  sendMessage(dir, "architect", "front", "three");
  const f = load(dir);
  f.emit("session_start", { reason: "startup" });
  await waitFor(() => f.sent.length === 1);
  assert.deepEqual(f.sent[0], { text: "[architect에게서 온 메시지]\none" });
  assert.equal(read(dir).length, 1);
  await sleep(100);
  assert.equal(f.sent.length, 1);
  f.ctx.idle = false;
  await waitFor(() => f.sent.length === 3);
  assert.deepEqual(f.sent.slice(1), [
    { text: "[architect에게서 온 메시지]\ntwo", options: { deliverAs: "steer" } },
    { text: "[architect에게서 온 메시지]\nthree", options: { deliverAs: "steer" } },
  ]);
  assert.equal(inbox(dir).length, 0);
  assert.equal(read(dir).length, 3);
  await sleep(100);
  assert.equal(f.sent.length, 3);
  f.emit("session_shutdown");
  f.emit("session_shutdown");
});

test("busy session gets steer; agent_start releases the hold after an idle send", async () => {
  const dir = stateDir();
  const f = load(dir, { intervalMs: 60_000 });
  f.emit("session_start", { reason: "startup" });
  sendMessage(dir, "architect", "front", "a");
  await waitFor(() => f.sent.length === 1);
  assert.equal(f.sent[0]!.options, undefined);
  sendMessage(dir, "architect", "front", "b");
  await sleep(100);
  assert.equal(f.sent.length, 1);
  f.ctx.idle = false;
  f.emit("agent_start");
  sendMessage(dir, "architect", "front", "c");
  await waitFor(() => f.sent.length === 3);
  assert.deepEqual(f.sent.slice(1).map((s) => [s.text.split("\n")[1], s.options?.deliverAs]), [["b", "steer"], ["c", "steer"]]);
  f.emit("session_shutdown");
});

test("no delivery while compacting; delivered after compaction ends", async () => {
  const dir = stateDir();
  const f = load(dir);
  f.emit("session_start", { reason: "startup" });
  f.ctx.idle = false;
  f.emit("session_before_compact");
  sendMessage(dir, "architect", "front", "wait");
  await sleep(150);
  assert.equal(f.sent.length, 0);
  assert.equal(inbox(dir).length, 1);
  f.ctx.idle = true;
  f.emit("session_compact");
  await waitFor(() => f.sent.length === 1);
  assert.equal(read(dir).length, 1);

  f.ctx.idle = false;
  f.emit("session_before_compact");
  sendMessage(dir, "architect", "front", "again");
  await sleep(150);
  assert.equal(f.sent.length, 1);
  f.emit("session_compact_failed");
  await waitFor(() => f.sent.length === 2);
  assert.deepEqual(f.sent[1]!.options, { deliverAs: "steer" });
  f.emit("session_shutdown");
});

test("a synchronous send failure keeps the message for a later scan", async () => {
  const dir = stateDir();
  const f = load(dir);
  f.ctx.idle = false;
  f.setThrow(true);
  f.emit("session_start", { reason: "startup" });
  sendMessage(dir, "architect", "front", "keep");
  await sleep(120);
  assert.equal(inbox(dir).length, 1);
  f.setThrow(false);
  await waitFor(() => f.sent.length === 1);
  assert.equal(read(dir).length, 1);
  f.emit("session_shutdown");
});

test("a message that cannot be moved is not delivered twice", async () => {
  const dir = stateDir();
  const readDir = path.join(dir, "agents/front/inbox/read");
  const f = load(dir);
  f.ctx.idle = false;
  fs.chmodSync(readDir, 0o500);
  try {
    f.emit("session_start", { reason: "startup" });
    sendMessage(dir, "architect", "front", "once");
    await waitFor(() => f.sent.length === 1);
    await sleep(150);
    assert.equal(f.sent.length, 1);
    assert.equal(inbox(dir).length, 1);
  } finally {
    fs.chmodSync(readDir, 0o700);
  }
  await waitFor(() => read(dir).length === 1);
  assert.equal(f.sent.length, 1);
  f.emit("session_shutdown");
});

test("initial message: inbox waits until the first run starts", async () => {
  const dir = stateDir();
  sendMessage(dir, "architect", "front", "early");
  const f = load(dir, { hasInitialMessage: true });
  f.emit("session_start", { reason: "startup" });
  await sleep(150);
  assert.equal(f.sent.length, 0);
  f.ctx.idle = false;
  f.emit("agent_start");
  await waitFor(() => f.sent.length === 1);
  assert.deepEqual(f.sent[0]!.options, { deliverAs: "steer" });
  f.emit("session_shutdown");
});

test("after shutdown nothing is delivered", async () => {
  const dir = stateDir();
  const f = load(dir);
  f.emit("session_start", { reason: "startup" });
  f.emit("session_shutdown");
  sendMessage(dir, "architect", "front", "late");
  await sleep(120);
  assert.equal(f.sent.length, 0);
  assert.equal(inbox(dir).length, 1);
});
