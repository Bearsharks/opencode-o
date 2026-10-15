import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-workers-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const agentDir = path.join(tmp, "agent");
fs.mkdirSync(agentDir, { recursive: true });
fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
process.env.HOME = path.join(tmp, "home");
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";

const { fauxProvider, fauxAssistantMessage } = await import("@earendil-works/pi-ai");
const { ModelRegistry, ModelRuntime } = await import("@earendil-works/pi-coding-agent");
const { runtimeFor } = await import("../src/contract/effort.ts");
const { harness } = await import("../src/harness/index.ts");
const { runPool, runWorkersTool } = await import("../src/workers/run-workers.ts");
const { emptyUsage, runWorker, workerSystemPrompt } = await import("../src/workers/readonly-worker.ts");
const { say, workerStep } = await import("./fixtures/faux-workers.ts");

import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Contract, EffortLevel } from "../src/contract/schema.ts";
import type { RunWorkerFn } from "../src/workers/run-workers.ts";
import type { ParentModelAccess, RunWorkerOptions, WorkerOutcome } from "../src/workers/readonly-worker.ts";

function contractFor(name: string, level: EffortLevel = "medium"): Contract {
  const dir = path.join(tmp, name);
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo, { recursive: true });
  return {
    schemaVersion: 1, contractId: `c-${name}`, createdAt: "2026-10-15T00:00:00.000Z", source: "file",
    repo: { root: repo, headSha: "x", repoKey: "repo" },
    goal: { original: "Find where alpha is defined", refined: "Locate alpha." },
    doneConditions: [{ id: "D1", statement: "answered", verify: { kind: "reported", how: "say it", checks: [] } }],
    prohibitions: [{ id: "P1", text: "Do not touch secrets.txt.", source: { kind: "user-message" } }],
    materials: [],
    effort: { level, decidedBy: "fixed" },
    runtime: runtimeFor(level, "faux/faux-1"),
    paths: { runDir: path.join(dir, "run"), materialsDir: path.join(dir, "mat") },
  };
}

const usageOf = (n: number): Usage => ({
  input: n, output: 2 * n, cacheRead: 3 * n, cacheWrite: 0, reasoning: n, totalTokens: 6 * n,
  cost: { input: n / 100, output: 0, cacheRead: 0, cacheWrite: 0, total: n / 100 },
});

const stubCtx = (model: unknown = { provider: "faux", id: "faux-1" }) => ({
  model, modelRegistry: {}, isProjectTrusted: () => false,
}) as never;

function toolWith(contract: Contract, run: RunWorkerFn) {
  return runWorkersTool({ contract: () => contract, runDir: contract.paths.runDir, runWorker: run });
}

const tasks = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `t${i + 1}`, prompt: `Read f${i + 1}.txt` }));
const done = (o: RunWorkerOptions, n = 1): WorkerOutcome =>
  ({ title: o.task.title, status: "done", result: { summary: `summary of ${o.task.title}` }, sessionPath: `/s/${o.task.title}.jsonl`, usage: usageOf(n) });

describe("run_workers tool", () => {
  test("rejects more tasks than the cap and says the cap", async () => {
    let calls = 0;
    const tool = toolWith(contractFor("cap"), async (o) => { calls++; return done(o); });
    await assert.rejects(tool.execute("c1", { tasks: tasks(3) }, undefined, undefined, stubCtx()), /at most 2 tasks per call/);
    assert.equal(calls, 0);
  });

  test("runs up to the cap at once and never more", async () => {
    let active = 0;
    let peak = 0;
    const tool = toolWith(contractFor("conc", "high"), async (o) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return done(o);
    });
    const r = await tool.execute("c1", { tasks: tasks(4) }, undefined, undefined, stubCtx());
    assert.equal(peak, 4);
    assert.equal(r.details.workers.length, 4);

    active = 0;
    peak = 0;
    const order: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5 + (n % 3) * 5));
      order.push(n);
      active--;
      return n;
    });
    assert.equal(peak, 3);
    assert.equal(order.length, 7);
  });

  test("sums worker usage into the tool result usage", async () => {
    const tool = toolWith(contractFor("usage"), async (o) => done(o, o.task.title === "t1" ? 1 : 10));
    const r = await tool.execute("c1", { tasks: tasks(2) }, undefined, undefined, stubCtx());
    assert.deepEqual(r.usage, {
      input: 11, output: 22, cacheRead: 33, cacheWrite: 0, reasoning: 11, totalTokens: 66,
      cost: { input: 0.11, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.11 },
    });
    assert.deepEqual(r.details.usage, r.usage);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    assert.match(text, /summary of t1/);
    assert.match(text, /summary of t2/);
    assert.match(text, /\/s\/t2\.jsonl/);
  });

  test("one failing worker does not fail the others", async () => {
    const tool = toolWith(contractFor("iso", "high"), async (o) => {
      if (o.task.title === "t2") throw new Error("boom");
      if (o.task.title === "t3") return { title: o.task.title, status: "failed", error: "model error", usage: usageOf(2) };
      return done(o);
    });
    const r = await tool.execute("c1", { tasks: tasks(4) }, undefined, undefined, stubCtx());
    assert.deepEqual(r.details.workers.map((w: { status: string }) => w.status), ["done", "failed", "failed", "done"]);
    assert.equal(r.details.workers[1]?.error, "boom");
    assert.equal(r.usage?.totalTokens, 6 + 0 + 12 + 6);
    assert.equal(r.isError, undefined);
  });

  test("propagates the abort signal to every worker", async () => {
    const seen: AbortSignal[] = [];
    const tool = toolWith(contractFor("abort"), (o) => new Promise((resolve) => {
      seen.push(o.signal as AbortSignal);
      o.signal?.addEventListener("abort", () => resolve({ title: o.task.title, status: "aborted", usage: usageOf(1) }), { once: true });
    }));
    const ac = new AbortController();
    const pending = tool.execute("c1", { tasks: tasks(2) }, ac.signal, undefined, stubCtx());
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(seen.length, 2);
    ac.abort();
    const r = await pending;
    assert.ok(seen.every((s) => s.aborted));
    assert.deepEqual(r.details.workers.map((w: { status: string }) => w.status), ["aborted", "aborted"]);
    assert.equal(r.usage?.totalTokens, 12);
  });
});

function fakePi() {
  const registered: string[] = [];
  const handlers = new Map<string, Array<(e: any, c: any) => any>>();
  const appended: Array<{ type: string; data: any }> = [];
  const pi = {
    on(ev: string, h: (e: any, c: any) => any) {
      handlers.set(ev, [...(handlers.get(ev) ?? []), h]);
      return () => {};
    },
    registerTool(t: { name: string }) { registered.push(t.name); },
    appendEntry(type: string, data: unknown) { appended.push({ type, data }); },
    getCommands() { return []; },
  };
  const ctx = (cwd: string) => ({
    hasUI: true, cwd, ui: { notify: () => {} }, sessionManager: { getBranch: () => [] }, getSystemPrompt: () => "",
  });
  return {
    pi: pi as unknown as ExtensionAPI, registered, appended,
    emit: async (ev: string, event: Record<string, unknown>, cwd: string) => {
      let out: unknown;
      for (const h of handlers.get(ev) ?? []) out = await h({ type: ev, ...event }, ctx(cwd));
      return out as any;
    },
  };
}

describe("harness registration", () => {
  test("run_workers is registered only when the worker cap is above 0", () => {
    for (const [level, expected] of [["low", false], ["medium", true], ["high", true], ["extreme", true]] as const) {
      const c = contractFor(`reg-${level}`, level);
      const f = fakePi();
      harness({ contract: c, runDir: c.paths.runDir, mode: "start" })(f.pi);
      assert.deepEqual(f.registered, expected ? ["run_workers"] : [], level);
    }
  });
});

async function fauxParent(steps: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0], tokensPerSecond?: number) {
  const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json") });
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }], ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}) });
  faux.setResponses(steps);
  runtime.registerProvider("faux", {
    api: faux.api, baseUrl: faux.getModel().baseUrl, apiKey: "faux-key", models: faux.models as never, streamSimple: faux.provider.streamSimple,
  });
  const modelRegistry = new ModelRegistry(runtime);
  const parent: ParentModelAccess = { model: modelRegistry.find("faux", "faux-1"), modelRegistry, isProjectTrusted: () => false };
  return { faux, parent };
}

describe("in-process read-only worker (faux provider)", () => {
  test("reads a file, submits, and keeps its session under runDir/workers", async () => {
    const c = contractFor("real");
    fs.writeFileSync(path.join(c.repo.root, "alpha.txt"), "ALPHA\n");
    const { faux, parent } = await fauxParent([workerStep, workerStep]);
    const o = await runWorker({ task: { title: "alpha", prompt: "Read alpha.txt and report it." }, contract: c, runDir: c.paths.runDir, parent, agentDir });
    assert.equal(o.status, "done", o.error ?? "");
    assert.equal(o.result?.summary, "alpha.txt says ALPHA");
    assert.deepEqual(o.result?.evidence, ["alpha.txt"]);
    assert.ok(o.sessionPath !== undefined && o.sessionPath.startsWith(path.join(c.paths.runDir, "workers") + path.sep));
    assert.ok(fs.existsSync(o.sessionPath));
    assert.ok(o.usage.totalTokens > 0);
    assert.equal(faux.getPendingResponseCount(), 0);
    const lines = fs.readFileSync(o.sessionPath as string, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const header = lines[0];
    assert.equal(header.cwd, c.repo.root);
    const thinking = lines.find((l) => l.type === "thinking_level_change");
    assert.equal(thinking?.thinkingLevel, "high");
    assert.ok(!fs.readdirSync(c.repo.root).some((f) => f.endsWith(".jsonl")));
  });

  test("a worker that ends without submit_result fails with its last message", async () => {
    const c = contractFor("nosubmit");
    const { parent } = await fauxParent([say("I give up.")]);
    const o = await runWorker({ task: { title: "x", prompt: "Read x.txt" }, contract: c, runDir: c.paths.runDir, parent, agentDir });
    assert.equal(o.status, "failed");
    assert.match(o.error ?? "", /without calling submit_result.*I give up/);
    assert.ok(o.usage.totalTokens > 0);
  });

  test("aborting stops a running worker session", async () => {
    const c = contractFor("realabort");
    const { parent } = await fauxParent([fauxAssistantMessage("word ".repeat(4000))], 200);
    const ac = new AbortController();
    const started = Date.now();
    const pending = runWorker({ task: { title: "slow", prompt: "Read slow.txt" }, contract: c, runDir: c.paths.runDir, parent, agentDir, signal: ac.signal });
    setTimeout(() => ac.abort(), 300);
    const o = await pending;
    assert.equal(o.status, "aborted");
    assert.ok(Date.now() - started < 10_000);
  });

  test("the worker system prompt carries the goal, prohibitions and task", () => {
    const c = contractFor("prompt");
    const p = workerSystemPrompt(c, { title: "scan", prompt: "Look at src.", paths: ["src"] });
    for (const s of ["<worker_task>", c.goal.original, c.goal.refined, "P1: Do not touch secrets.txt.", "Your task: scan", "Look at src.", "Start with these paths: src"]) {
      assert.ok(p.includes(s), s);
    }
  });

  test("a missing parent model fails without starting a session", async () => {
    const c = contractFor("nomodel");
    const o = await runWorker({ task: { title: "x", prompt: "p" }, contract: c, runDir: c.paths.runDir, parent: { model: undefined, modelRegistry: {} as never, isProjectTrusted: () => false } });
    assert.equal(o.status, "failed");
    assert.deepEqual(o.usage, emptyUsage());
  });
});
