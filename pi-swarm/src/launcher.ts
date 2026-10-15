import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SwarmState } from "./state.ts";

export const BIN_PATH = fileURLToPath(new URL("../bin/pi-swarm.ts", import.meta.url));

export type LaunchSpec = { name: string; cwd: string; env: Record<string, string> };

export interface Launcher {
  isOpen(state: SwarmState): Promise<boolean>;
  launchAgent(state: SwarmState, spec: LaunchSpec): Promise<void>;
  attach(state: SwarmState): Promise<void>;
}

export function agentCommand(name: string): string[] {
  return [process.execPath, path.resolve(BIN_PATH), "agent", name];
}

export function launchSpec(stateDir: string, name: string, cwd: string): LaunchSpec {
  return { name, cwd, env: { PI_SWARM_DIR: stateDir } };
}

export type TmuxResult = { status: number; stderr: string };
export type TmuxExec = (args: string[], interactive?: boolean) => TmuxResult;

export const runTmux: TmuxExec = (args, interactive = false) => {
  const r = spawnSync("tmux", args, { stdio: interactive ? "inherit" : ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (r.error !== undefined) throw r.error;
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
};

export function tmuxLaunchArgs(session: string, spec: LaunchSpec, sessionExists: boolean): string[] {
  const head = sessionExists ? ["new-window", "-d", "-t", `=${session}:`] : ["new-session", "-d", "-s", session];
  const env = Object.entries(spec.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return [...head, "-n", spec.name, "-c", spec.cwd, ...env, ...agentCommand(spec.name)];
}

export function tmuxAttachArgs(session: string, insideTmux: boolean): string[] {
  return insideTmux ? ["switch-client", "-t", `=${session}`] : ["attach-session", "-t", `=${session}`];
}

export function tmuxLauncher(exec: TmuxExec = runTmux, env: NodeJS.ProcessEnv = process.env): Launcher {
  const has = (s: SwarmState) => exec(["has-session", "-t", `=${s.tmuxSession}`]).status === 0;
  return {
    isOpen: async (s) => has(s),
    launchAgent: async (s, spec) => {
      const r = exec(tmuxLaunchArgs(s.tmuxSession, spec, has(s)));
      if (r.status !== 0) throw new Error(`tmux 창을 열지 못했습니다: ${r.stderr.trim()}`);
    },
    attach: async (s) => {
      const r = exec(tmuxAttachArgs(s.tmuxSession, Boolean(env.TMUX)), true);
      if (r.status !== 0) throw new Error(`tmux 세션 ${s.tmuxSession}에 붙지 못했습니다.`);
    },
  };
}
