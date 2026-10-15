import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addWorktree } from "./git.ts";
import { type Launcher, launchSpec } from "./launcher.ts";
import {
  type AgentRow, contextDirOf, inboxDir, makeAgentDirs, readState, startMessageFile, type SwarmState,
  updateState, writeFileAtomic,
} from "./state.ts";

export class ToolError extends Error {}

export type InboxMessage = { from: string; to: string; text: string; sentAt: string };

export function listAgents(dir: string): string {
  return JSON.stringify(readState(dir).agents, null, 2);
}

let lastMs = 0;
let seq = 0;

function inboxFileName(sentAt: Date, from: string): string {
  const ms = sentAt.getTime();
  seq = ms === lastMs ? seq + 1 : 0;
  lastMs = ms;
  const stamp = sentAt.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${String(seq).padStart(4, "0")}-${from}-${crypto.randomBytes(4).toString("hex")}.json`;
}

export function sendMessage(dir: string, from: string, to: string, text: string): string {
  const state = readState(dir);
  const valid = state.agents.map((a) => a.name).filter((n) => n !== from);
  if (!valid.includes(to)) {
    throw new ToolError(`받는 에이전트 "${to}"가 없습니다. 보낼 수 있는 이름: ${valid.join(", ") || "(없음)"}`);
  }
  const now = new Date();
  const msg: InboxMessage = { from, to, text, sentAt: now.toISOString() };
  const file = path.join(inboxDir(dir, to), inboxFileName(now, from));
  writeFileAtomic(file, `${JSON.stringify(msg, null, 2)}\n`);
  return `${to}에게 보냈습니다.`;
}

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED = new Set(["front", "architect"]);

export type CreatedOwner = { name: string; worktree: string; branch: string };

export async function createFeatureOwner(
  dir: string,
  args: { name: string; feature: string; context: string },
  launcher: Launcher,
): Promise<CreatedOwner> {
  const { name, feature, context } = args;
  if (!NAME_PATTERN.test(name)) throw new ToolError(`이름은 ${NAME_PATTERN.source} 형식이어야 합니다.`);
  if (RESERVED.has(name)) throw new ToolError(`"${name}"은 쓸 수 없는 이름입니다.`);
  if (feature.trim() === "") throw new ToolError("feature가 비어 있습니다.");
  if (context.trim() === "") throw new ToolError("context가 비어 있습니다.");

  const branch = `swarm/${name}`;
  let state: SwarmState | undefined;
  let worktree = "";
  updateState(dir, (s) => {
    if (s.agents.some((a) => a.name === name)) throw new ToolError(`"${name}" 이름의 에이전트가 이미 있습니다.`);
    worktree = path.join(s.worktreeRoot, name);
    fs.mkdirSync(s.worktreeRoot, { recursive: true });
    addWorktree(s.repoRoot, worktree, branch, s.baseBranch);
    makeAgentDirs(dir, name);
    writeFileAtomic(startMessageFile(dir, name), context);
    const row: AgentRow = {
      name, role: "feature", feature, contextDir: contextDirOf(dir, name),
      cwd: worktree, branch, createdAt: new Date().toISOString(),
    };
    s.agents.push(row);
    state = s;
  });

  try {
    await launcher.launchAgent(state!, launchSpec(dir, name, worktree));
  } catch (e) {
    throw new ToolError(
      `에이전트 실행에 실패했습니다: ${(e as Error).message}\n` +
      `이미 만들어진 것: 브랜치 ${branch}, 워크트리 ${worktree}, agents.json의 ${name} 행, 시작 메시지 ${startMessageFile(dir, name)}`,
    );
  }
  return { name, worktree, branch };
}
