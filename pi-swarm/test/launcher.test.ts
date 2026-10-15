import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempRoot } from "./helpers.ts";
import { agentCommand, runTmux, type TmuxExec, tmuxLaunchArgs, tmuxLauncher } from "../src/launcher.ts";
import type { SwarmState } from "../src/state.ts";

const state = { tmuxSession: "swarm-demo" } as SwarmState;
const spec = { name: "pay", cwd: "/w/pay", env: { PI_SWARM_DIR: "/s/demo" } };

function recorder(hasSession: boolean): { exec: TmuxExec; calls: Array<{ args: string[]; interactive: boolean }> } {
  const calls: Array<{ args: string[]; interactive: boolean }> = [];
  const exec: TmuxExec = (args, interactive = false) => {
    calls.push({ args, interactive });
    if (args[0] === "has-session") return { status: hasSession ? 0 : 1, stderr: "" };
    return { status: 0, stderr: "" };
  };
  return { exec, calls };
}

test("first launch creates the session, later launches add detached windows", async () => {
  const fresh = recorder(false);
  await tmuxLauncher(fresh.exec, {}).launchAgent(state, spec);
  assert.deepEqual(fresh.calls[1]!.args, [
    "new-session", "-d", "-s", "swarm-demo", "-n", "pay", "-c", "/w/pay", "-e", "PI_SWARM_DIR=/s/demo", ...agentCommand("pay"),
  ]);

  const open = recorder(true);
  await tmuxLauncher(open.exec, {}).launchAgent(state, spec);
  assert.deepEqual(open.calls[1]!.args, [
    "new-window", "-d", "-t", "=swarm-demo:", "-n", "pay", "-c", "/w/pay", "-e", "PI_SWARM_DIR=/s/demo", ...agentCommand("pay"),
  ]);
});

test("attach uses switch-client inside tmux and attach-session outside", async () => {
  const outside = recorder(true);
  await tmuxLauncher(outside.exec, {}).attach(state);
  assert.deepEqual(outside.calls[0], { args: ["attach-session", "-t", "=swarm-demo"], interactive: true });

  const inside = recorder(true);
  await tmuxLauncher(inside.exec, { TMUX: "/tmp/tmux-1/default,1,0" }).attach(state);
  assert.deepEqual(inside.calls[0], { args: ["switch-client", "-t", "=swarm-demo"], interactive: true });
});

test("a failed tmux launch is reported", async () => {
  const exec: TmuxExec = (args) => args[0] === "has-session" ? { status: 1, stderr: "" } : { status: 1, stderr: "boom\n" };
  await assert.rejects(tmuxLauncher(exec, {}).launchAgent(state, spec), /tmux 창을 열지 못했습니다: boom/);
});

test("real tmux accepts the launch arguments", { skip: spawnSync("tmux", ["-V"]).status !== 0 }, async (t) => {
  const session = `pi-swarm-smoke-${process.pid}`;
  const root = tempRoot("pi-swarm-tmux-");
  t.after(() => { runTmux(["kill-session", "-t", `=${session}`]); });
  const out = path.join(root, "out");
  const dummy = (args: string[]) => [
    ...args.slice(0, -agentCommand("x").length), "sh", "-c", `printf '%s %s' "$PI_SWARM_DIR" "$PWD" > ${out}; sleep 30`,
  ];
  const s = { name: "front", cwd: root, env: { PI_SWARM_DIR: "/tmp/swarm dir" } };
  assert.equal(runTmux(dummy(tmuxLaunchArgs(session, s, false))).status, 0);
  assert.equal(runTmux(dummy(tmuxLaunchArgs(session, { ...s, name: "architect" }, true))).status, 0);
  assert.equal(await tmuxLauncher().isOpen({ tmuxSession: session } as SwarmState), true);
  const windows = spawnSync("tmux", ["list-windows", "-t", `=${session}`, "-F", "#{window_name}"], { encoding: "utf8" });
  assert.deepEqual(windows.stdout.trim().split("\n"), ["front", "architect"]);
  for (let i = 0; i < 50 && !fs.existsSync(out); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.readFileSync(out, "utf8"), `/tmp/swarm dir ${root}`);
});
