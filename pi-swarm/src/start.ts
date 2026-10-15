import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addWorktree, ensureRepo } from "./git.ts";
import { type Launcher, launchSpec } from "./launcher.ts";
import {
  type AgentRow, contextDirOf, makeAgentDirs, readState, stateDirFor, stateFile, type SwarmState,
  tmuxSessionName, withStateLock, worktreeRootFor, writeState,
} from "./state.ts";

export type StartOptions = {
  cwd: string;
  launcher: Launcher;
  home?: string;
  log?: (line: string) => void;
};

export async function runStart(opts: StartOptions): Promise<number> {
  const log = opts.log ?? ((l: string) => console.error(l));
  const { repoRoot, baseBranch } = ensureRepo(opts.cwd);
  const dir = stateDirFor(repoRoot, opts.home ?? os.homedir());

  if (fs.existsSync(stateFile(dir))) {
    const state = readState(dir);
    if (await opts.launcher.isOpen(state)) {
      await opts.launcher.attach(state);
      return 0;
    }
    log(`이미 상태가 있지만 실행 중인 세션이 없습니다: ${dir} — 새로 시작하려면 이 폴더를 지우세요.`);
    return 1;
  }

  const worktreeRoot = worktreeRootFor(repoRoot);
  const now = new Date().toISOString();
  const architectCwd = path.join(worktreeRoot, "architect");
  const front: AgentRow = {
    name: "front", role: "front", contextDir: contextDirOf(dir, "front"),
    cwd: repoRoot, branch: baseBranch, createdAt: now,
  };
  const architect: AgentRow = {
    name: "architect", role: "architect", contextDir: contextDirOf(dir, "architect"),
    cwd: architectCwd, branch: "swarm/architect", createdAt: now,
  };
  const state: SwarmState = {
    repoRoot, baseBranch, tmuxSession: tmuxSessionName(path.basename(repoRoot)), worktreeRoot,
    agents: [front, architect],
  };

  fs.mkdirSync(worktreeRoot, { recursive: true });
  addWorktree(repoRoot, architectCwd, architect.branch, baseBranch);
  fs.mkdirSync(dir, { recursive: true });
  for (const a of state.agents) makeAgentDirs(dir, a.name);
  withStateLock(dir, () => writeState(dir, state));

  for (const a of state.agents) await opts.launcher.launchAgent(state, launchSpec(dir, a.name, a.cwd));
  await opts.launcher.attach(state);
  return 0;
}
