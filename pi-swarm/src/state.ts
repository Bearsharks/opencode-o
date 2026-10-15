import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Role = "front" | "architect" | "feature";

export type AgentRow = {
  name: string;
  role: Role;
  feature?: string;
  contextDir: string;
  cwd: string;
  branch: string;
  createdAt: string;
};

export type SwarmState = {
  repoRoot: string;
  baseBranch: string;
  tmuxSession: string;
  worktreeRoot: string;
  agents: AgentRow[];
};

export function stateDirFor(repoRoot: string, home: string = os.homedir()): string {
  return path.join(home, ".pi-swarm", path.basename(repoRoot));
}

export function stateFile(dir: string): string {
  return path.join(dir, "agents.json");
}

export function agentDir(dir: string, name: string): string {
  return path.join(dir, "agents", name);
}

export function contextDirOf(dir: string, name: string): string {
  return path.join(agentDir(dir, name), "context");
}

export function inboxDir(dir: string, name: string): string {
  return path.join(agentDir(dir, name), "inbox");
}

export function readDirOf(dir: string, name: string): string {
  return path.join(inboxDir(dir, name), "read");
}

export function startMessageFile(dir: string, name: string): string {
  return path.join(agentDir(dir, name), "start-message.md");
}

export function tmuxSessionName(repoBasename: string): string {
  return `swarm-${repoBasename.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function worktreeRootFor(repoRoot: string): string {
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-swarm`);
}

export function makeAgentDirs(dir: string, name: string): void {
  fs.mkdirSync(contextDirOf(dir, name), { recursive: true });
  fs.mkdirSync(readDirOf(dir, name), { recursive: true });
}

export function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function readState(dir: string): SwarmState {
  return JSON.parse(fs.readFileSync(stateFile(dir), "utf8")) as SwarmState;
}

export function findAgent(state: SwarmState, name: string): AgentRow | undefined {
  return state.agents.find((a) => a.name === name);
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withStateLock<T>(dir: string, fn: () => T): T {
  const lock = `${stateFile(dir)}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error(`could not lock ${lock}`);
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

export function writeState(dir: string, state: SwarmState): void {
  writeFileAtomic(stateFile(dir), `${JSON.stringify(state, null, 2)}\n`);
}

export function updateState<T>(dir: string, fn: (state: SwarmState) => T): T {
  return withStateLock(dir, () => {
    const state = readState(dir);
    const result = fn(state);
    writeState(dir, state);
    return result;
  });
}
