import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runStart } from "../src/start.ts";
import { findAgent, readState, stateDirFor } from "../src/state.ts";
import { createFeatureOwner, listAgents, sendMessage, ToolError } from "../src/tools.ts";
import { fakeLauncher, gitOut, tempRoot } from "./helpers.ts";

async function swarm() {
  const root = tempRoot("swarm-tools-");
  const home = path.join(root, "home");
  const repo = path.join(root, "proj");
  fs.mkdirSync(repo);
  await runStart({ cwd: repo, launcher: fakeLauncher(), home });
  return { root, repo, dir: stateDirFor(repo, home) };
}

test("list_agents returns the agents array", async () => {
  const { dir } = await swarm();
  assert.deepEqual(JSON.parse(listAgents(dir)), readState(dir).agents);
});

test("send_message validates the recipient and writes one atomic inbox file", async () => {
  const { dir } = await swarm();
  assert.throws(() => sendMessage(dir, "front", "nobody", "x"), (e: Error) => e instanceof ToolError && /architect/.test(e.message) && !/front/.test(e.message.split(":").pop()!));
  assert.throws(() => sendMessage(dir, "front", "front", "x"), ToolError);

  sendMessage(dir, "front", "architect", "검수 결과입니다\n둘째 줄");
  const inbox = path.join(dir, "agents/architect/inbox");
  const files = fs.readdirSync(inbox).filter((f) => f !== "read");
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-\d{4}-front-[0-9a-f]{8}\.json$/);
  const msg = JSON.parse(fs.readFileSync(path.join(inbox, files[0]!), "utf8"));
  assert.deepEqual(Object.keys(msg).sort(), ["from", "sentAt", "text", "to"]);
  assert.equal(msg.from, "front");
  assert.equal(msg.to, "architect");
  assert.equal(msg.text, "검수 결과입니다\n둘째 줄");

  sendMessage(dir, "architect", "front", "b");
  sendMessage(dir, "architect", "front", "c");
  const frontFiles = fs.readdirSync(path.join(dir, "agents/front/inbox")).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(frontFiles.map((f) => JSON.parse(fs.readFileSync(path.join(dir, "agents/front/inbox", f), "utf8")).text), ["b", "c"]);
});

test("create_feature_owner validates input", async () => {
  const { dir } = await swarm();
  const l = fakeLauncher();
  const ok = { feature: "f", context: "c" };
  for (const name of ["", "Bad", "-x", "a_b", "a".repeat(41), "front", "architect"]) {
    await assert.rejects(createFeatureOwner(dir, { name, ...ok }, l), ToolError, name);
  }
  await assert.rejects(createFeatureOwner(dir, { name: "x", feature: " ", context: "c" }, l), ToolError);
  await assert.rejects(createFeatureOwner(dir, { name: "x", feature: "f", context: "\n" }, l), ToolError);
  await createFeatureOwner(dir, { name: "a".repeat(40), ...ok }, l);
  await assert.rejects(createFeatureOwner(dir, { name: "a".repeat(40), ...ok }, l), /이미/);
  assert.equal(l.launched.length, 1);
  assert.equal(readState(dir).agents.length, 3);
});

test("create_feature_owner creates branch, worktree, dirs, row, start message and launches", async () => {
  const { root, repo, dir } = await swarm();
  const l = fakeLauncher();
  const feature = "로그인 화면'; rm -rf / #";
  const context = "$(touch pwned) 시작 맥락\n`id`";
  const res = await createFeatureOwner(dir, { name: "login-1", feature, context }, l);
  const wt = path.join(root, "proj-swarm", "login-1");
  assert.deepEqual(res, { name: "login-1", worktree: wt, branch: "swarm/login-1" });
  assert.equal(gitOut(wt, ["symbolic-ref", "--short", "HEAD"]), "swarm/login-1");
  assert.equal(gitOut(repo, ["rev-parse", "swarm/login-1"]), gitOut(repo, ["rev-parse", "main"]));
  assert.ok(fs.statSync(path.join(dir, "agents/login-1/context")).isDirectory());
  assert.ok(fs.statSync(path.join(dir, "agents/login-1/inbox/read")).isDirectory());
  assert.equal(fs.readFileSync(path.join(dir, "agents/login-1/start-message.md"), "utf8"), context);
  const row = findAgent(readState(dir), "login-1")!;
  assert.equal(row.role, "feature");
  assert.equal(row.feature, feature);
  assert.equal(row.cwd, wt);
  assert.equal(row.branch, "swarm/login-1");
  assert.equal(row.contextDir, path.join(dir, "agents/login-1/context"));
  assert.deepEqual(l.launched, [{ name: "login-1", cwd: wt, env: { PI_SWARM_DIR: dir } }]);
  const launchText = JSON.stringify(l.launched);
  assert.ok(!launchText.includes("pwned") && !launchText.includes("로그인"));
  assert.ok(!fs.existsSync(path.join(wt, "pwned")));
});

test("create_feature_owner reports what exists when launching fails", async () => {
  const { dir } = await swarm();
  const l = fakeLauncher();
  l.fail = "no launcher";
  await assert.rejects(createFeatureOwner(dir, { name: "pay", feature: "f", context: "c" }, l), (e: Error) =>
    e instanceof ToolError && e.message.includes("no launcher") && e.message.includes("swarm/pay") && e.message.includes("start-message.md"));
  assert.ok(findAgent(readState(dir), "pay"));
});

test("concurrent state updates from several processes are all kept", async () => {
  const { dir } = await swarm();
  const script = path.join(import.meta.dirname, "fixtures/append-row.ts");
  const names = Array.from({ length: 12 }, (_, i) => `p${i}`);
  await Promise.all(names.map((n) => new Promise<void>((resolve, reject) => {
    const c = spawn(process.execPath, [script, dir, n], { stdio: "ignore" });
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  })));
  const got = readState(dir).agents.map((a) => a.name);
  for (const n of names) assert.ok(got.includes(n), n);
  assert.equal(got.length, 14);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["agents", "agents.json"]);
});
