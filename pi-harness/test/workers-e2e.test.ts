import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runtimeFor } from "../src/contract/effort.ts";
import type { Contract } from "../src/contract/schema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../bin/pi-harness.ts");
const fauxExt = path.resolve(here, "fixtures/faux-workers-ext.ts");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-workers-e2e-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const jsonl = (file: string): Array<Record<string, any>> =>
  fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
const listJsonl = (dir: string) => fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f))
  : [];

test("e2e: run_workers runs two in-process read-only workers and rejects a call over the cap", async () => {
  const dir = path.join(tmp, "workers");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo, { recursive: true });
  for (const d of ["home", "agent", "sessions"]) fs.mkdirSync(path.join(dir, d));
  fs.writeFileSync(path.join(repo, "alpha.txt"), "ALPHA\n");
  fs.writeFileSync(path.join(repo, "beta.txt"), "BETA\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env: { ...process.env, ...gitEnv }, stdio: "ignore" });
  git("init", "-q", ".");
  git("add", "-A");
  git("commit", "-qm", "init");
  const runDir = path.join(dir, "run");
  const sessions = path.join(dir, "sessions");
  const contract: Contract = {
    schemaVersion: 1,
    contractId: "contract-workers",
    createdAt: new Date().toISOString(),
    source: "file",
    repo: { root: repo, headSha: "x", repoKey: "repo" },
    goal: { original: "Report what alpha.txt and beta.txt say", refined: "Report the contents of alpha.txt and beta.txt." },
    doneConditions: [{ id: "D1", statement: "Both files were reported", verify: { kind: "reported", how: "Say what they contain", checks: [] } }],
    prohibitions: [{ id: "P1", text: "Do not edit any file.", source: { kind: "user-message" } }],
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
  const args = ["work", "--contract", contractFile, "--", "--mode", "json", "-p", "-e", fauxExt, "--session-dir", sessions];
  const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timeout\n${stderr}`)); }, 90_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  const events = r.stdout.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  const texts = events
    .filter((e) => e.type === "message_end" && e.message?.role === "assistant")
    .flatMap((e) => e.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text as string));
  assert.deepEqual(texts.filter((t) => t.startsWith("UNEXPECTED")), [], `stderr:\n${r.stderr}`);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(texts.includes("Workers reported alpha and beta. Done."));

  const results = events.filter((e) => e.type === "message_end" && e.message?.role === "toolResult" && e.message.toolName === "run_workers").map((e) => e.message);
  assert.equal(results.length, 2);
  const [ok, rejected] = results;
  const okText = ok.content.map((c: any) => c.text ?? "").join("\n");
  assert.match(okText, /alpha\.txt says ALPHA/);
  assert.match(okText, /beta\.txt says BETA/);
  assert.equal(ok.isError, false);
  assert.equal(rejected.isError, true);
  assert.match(rejected.content.map((c: any) => c.text ?? "").join("\n"), /at most 2 tasks per call/);

  const workerFiles = listJsonl(path.join(runDir, "workers"));
  assert.equal(workerFiles.length, 2);
  assert.deepEqual(ok.details.workers.map((w: any) => w.sessionPath).sort(), [...workerFiles].sort());
  let workerTokens = 0;
  for (const f of workerFiles) {
    const entries = jsonl(f);
    assert.equal(entries[0]?.cwd, repo);
    const msgs = entries.filter((e) => e.type === "message").map((e) => e.message);
    const file = /Read (\S+)/.exec(msgs.find((m) => m.role === "user")?.content.map((c: any) => c.text ?? "").join("") ?? "")?.[1];
    const calls = msgs.filter((m) => m.role === "assistant").flatMap((m) => m.content.filter((c: any) => c.type === "toolCall"));
    assert.deepEqual(calls.map((c: any) => c.name), ["read", "submit_result"]);
    assert.equal(calls[0].arguments.path, file);
    assert.match(calls[1].arguments.summary, new RegExp(`^${file} says ${file === "alpha.txt" ? "ALPHA" : "BETA"}$`));
    for (const e of entries) if (e.type === "message" && e.message?.role === "assistant") workerTokens += e.message.usage?.totalTokens ?? 0;
  }
  assert.ok(workerTokens > 0);
  assert.equal(ok.usage?.totalTokens, workerTokens);

  const parentFiles = listJsonl(sessions);
  assert.equal(parentFiles.length, 1);
  const parent = jsonl(parentFiles[0] as string);
  const stored = parent.filter((e) => e.type === "message" && e.message?.role === "toolResult" && e.message.toolName === "run_workers");
  assert.equal(stored[0]?.message.usage?.totalTokens, workerTokens);
  assert.deepEqual(parent.filter((e) => e.type === "custom").map((e) => e.customType), ["harness-contract"]);
  assert.deepEqual(fs.readdirSync(runDir).sort(), ["workers"]);
});
