import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { agentCommand } from "../src/launcher.ts";
import { runStart } from "../src/start.ts";
import { readState, stateDirFor, tmuxSessionName } from "../src/state.ts";
import { fakeLauncher, gitOut, tempRoot } from "./helpers.ts";

test("start on an empty non-git folder initializes git and writes state", async () => {
  const root = tempRoot("swarm-start-");
  const home = path.join(root, "home");
  const repo = path.join(root, "proj");
  fs.mkdirSync(repo);
  const launcher = fakeLauncher();
  const code = await runStart({ cwd: repo, launcher, home });
  assert.equal(code, 0);

  assert.equal(gitOut(repo, ["log", "--format=%s"]), "init");
  assert.equal(gitOut(repo, ["symbolic-ref", "--short", "HEAD"]), "main");

  const dir = stateDirFor(repo, home);
  assert.equal(dir, path.join(home, ".pi-swarm", "proj"));
  const state = readState(dir);
  const wtRoot = path.join(root, "proj-swarm");
  assert.equal(state.repoRoot, repo);
  assert.equal(state.baseBranch, "main");
  assert.equal(state.tmuxSession, "swarm-proj");
  assert.equal(state.worktreeRoot, wtRoot);
  assert.deepEqual(state.agents.map((a) => [a.name, a.role, a.cwd, a.branch, a.contextDir]), [
    ["front", "front", repo, "main", path.join(dir, "agents/front/context")],
    ["architect", "architect", path.join(wtRoot, "architect"), "swarm/architect", path.join(dir, "agents/architect/context")],
  ]);
  for (const a of state.agents) {
    assert.ok(!Number.isNaN(Date.parse(a.createdAt)));
    assert.ok(fs.statSync(path.join(dir, "agents", a.name, "inbox/read")).isDirectory());
    assert.ok(fs.statSync(a.contextDir).isDirectory());
  }
  assert.equal(gitOut(path.join(wtRoot, "architect"), ["symbolic-ref", "--short", "HEAD"]), "swarm/architect");

  assert.deepEqual(launcher.launched, [
    { name: "front", cwd: repo, env: { PI_SWARM_DIR: dir } },
    { name: "architect", cwd: path.join(wtRoot, "architect"), env: { PI_SWARM_DIR: dir } },
  ]);
  assert.equal(launcher.attached, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["agents", "agents.json"]);
});

test("start in a repo with commits uses the checked out branch and adds no commit", async () => {
  const root = tempRoot("swarm-start-");
  const repo = path.join(root, "app");
  fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
  gitOut(repo, ["init", "-b", "dev"]);
  gitOut(repo, ["commit", "--allow-empty", "-m", "first"]);
  const code = await runStart({ cwd: path.join(repo, "sub"), launcher: fakeLauncher(), home: path.join(root, "home") });
  assert.equal(code, 0);
  assert.equal(gitOut(repo, ["log", "--format=%s"]), "first");
  const state = readState(stateDirFor(repo, path.join(root, "home")));
  assert.equal(state.repoRoot, repo);
  assert.equal(state.baseBranch, "dev");
});

test("existing state attaches when the session is open, otherwise fails with the state path", async () => {
  const root = tempRoot("swarm-start-");
  const home = path.join(root, "home");
  const repo = path.join(root, "proj");
  fs.mkdirSync(repo);
  await runStart({ cwd: repo, launcher: fakeLauncher(), home });
  const before = fs.readFileSync(path.join(stateDirFor(repo, home), "agents.json"), "utf8");

  const open = fakeLauncher(true);
  assert.equal(await runStart({ cwd: repo, launcher: open, home }), 0);
  assert.equal(open.attached, 1);
  assert.equal(open.launched.length, 0);

  const closed = fakeLauncher(false);
  const lines: string[] = [];
  assert.equal(await runStart({ cwd: repo, launcher: closed, home, log: (l) => lines.push(l) }), 1);
  assert.equal(closed.attached, 0);
  assert.equal(closed.launched.length, 0);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes(stateDirFor(repo, home)));
  assert.match(lines[0]!, /지우세요/);
  assert.equal(fs.readFileSync(path.join(stateDirFor(repo, home), "agents.json"), "utf8"), before);
});

test("session name and agent command", () => {
  assert.equal(tmuxSessionName("my.repo x_1-2"), "swarm-my-repo-x_1-2");
  const cmd = agentCommand("front");
  assert.equal(cmd[0], process.execPath);
  assert.ok(fs.existsSync(cmd[1]!));
  assert.deepEqual(cmd.slice(2), ["agent", "front"]);
});
