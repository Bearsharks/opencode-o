import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { prepareAgent } from "../src/agent.ts";
import { runStart } from "../src/start.ts";
import { readState, stateDirFor } from "../src/state.ts";
import { createFeatureOwner } from "../src/tools.ts";
import { fakeLauncher, tempRoot } from "./helpers.ts";

test("agent command consumes start-message.md once and builds argv", async () => {
  const root = tempRoot("swarm-agent-");
  const home = path.join(root, "home");
  const repo = path.join(root, "proj");
  fs.mkdirSync(repo);
  await runStart({ cwd: repo, launcher: fakeLauncher(), home });
  const dir = stateDirFor(repo, home);
  const context = "-- 시작 맥락\n--model x";
  await createFeatureOwner(dir, { name: "cart", feature: "장바구니", context }, fakeLauncher());

  const first = prepareAgent(dir, "cart");
  assert.deepEqual(first, { cwd: path.join(root, "proj-swarm", "cart"), argv: ["--", context], hasInitialMessage: true });
  assert.ok(!fs.existsSync(path.join(dir, "agents/cart/start-message.md")));
  assert.equal(fs.readFileSync(path.join(dir, "agents/cart/start-message.sent.md"), "utf8"), context);

  assert.deepEqual(prepareAgent(dir, "cart"), { cwd: first.cwd, argv: [], hasInitialMessage: false });
  assert.deepEqual(prepareAgent(dir, "front"), { cwd: readState(dir).repoRoot, argv: [], hasInitialMessage: false });
  assert.throws(() => prepareAgent(dir, "ghost"), /ghost/);
});
