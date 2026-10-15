import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { type Args, main, parseArgs } from "@earendil-works/pi-coding-agent";
import { loadRepoConfig, type RepoConfig } from "../config/repo-config.ts";
import type { Contract } from "../contract/schema.ts";
import { type EntryTarget, PendingEntry } from "../harness/entry.ts";
import { harness } from "../harness/index.ts";
import { buildJudgeContract, DEFAULT_JUDGE_THINKING, judgeFiles } from "../judge/builder.ts";
import { childExtraArgs } from "../judge/child.ts";
import { createRunDir, defaultRunDir, reposDirFor, resolveTargetRepo } from "./run.ts";
import { CliError } from "./work.ts";

export const ALLOW_NONINTERACTIVE_ENV = "PI_HARNESS_ALLOW_NONINTERACTIVE";

export type Terminal = { stdinTTY: boolean; stdoutTTY: boolean };

const RUN_HINT = "For a non-interactive run use \"pi-harness run --model <provider/id> --message <text>\" (see pi-harness --help).";

export function checkInteractiveArgs(argv: string[], term: Terminal, env: NodeJS.ProcessEnv = process.env): Args {
  const parsed = parseArgs(argv);
  if (parsed.help || parsed.version || parsed.listModels !== undefined || parsed.export !== undefined) return parsed;
  if (env[ALLOW_NONINTERACTIVE_ENV] === "1" && parsed.mode === "rpc") return parsed;
  const flag = parsed.mode === "rpc" ? "--mode rpc" : parsed.mode === "json" ? "--mode json" : parsed.print ? "--print" : undefined;
  if (flag !== undefined) {
    throw new CliError(`pi-harness without a subcommand opens the interactive pi TUI and does not support ${flag}. ${RUN_HINT}`);
  }
  if (!term.stdinTTY || !term.stdoutTTY) {
    throw new CliError(`pi-harness without a subcommand opens the interactive pi TUI and needs a terminal on stdin and stdout. ${RUN_HINT}`);
  }
  return parsed;
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

export function harnessOffReason(cwd: string): string | null {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top === undefined || top === "") {
    return `현재 폴더(${cwd})가 git 저장소 안에 있지 않아 이번 세션은 하네스 없이 일반 pi로 동작합니다. 작업 계약이 만들어지지 않습니다.`;
  }
  const head = git(top, ["rev-parse", "--verify", "-q", "HEAD"]);
  if (head === undefined || head === "") {
    return `저장소 ${top}에 커밋이 아직 없어 이번 세션은 하네스 없이 일반 pi로 동작합니다. 한 번 커밋한 뒤 다시 시작하면 하네스가 켜집니다.`;
  }
  return null;
}

export function targetResolver(cwd: string, reposDir: string): () => EntryTarget {
  return () => {
    const t = resolveTargetRepo(cwd);
    let repoConfig: RepoConfig | null;
    try {
      repoConfig = loadRepoConfig(reposDir, t.repoKey, t.remoteUrl, t.root);
    } catch (e) {
      throw new CliError((e as Error).message);
    }
    const repo: Contract["repo"] = { root: t.root, headSha: t.headSha, repoKey: t.repoKey };
    if (t.branch !== undefined) repo.branch = t.branch;
    const target: EntryTarget = { repo, repoConfig };
    if (repoConfig === null) {
      target.configWarning = `경고: 레포 ${t.repoKey}의 설정 파일이 ${reposDir}에 없습니다.`;
    }
    return target;
  };
}

export function interactiveEntry(cwd: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): PendingEntry {
  const extra = childExtraArgs(env);
  const offReason = harnessOffReason(cwd);
  const resolveTarget = targetResolver(cwd, reposDirFor(env));
  if (offReason === null) resolveTarget();
  return new PendingEntry({
    offReason,
    resolveTarget,
    newRunDir: () => createRunDir(path.resolve(defaultRunDir(home))),
    buildContract: buildJudgeContract,
    judge: { thinking: DEFAULT_JUDGE_THINKING, mcp: false, childExtraArgs: extra },
    eventsFile: (runDir, phase) => (phase === "judge" ? judgeFiles(runDir).events : judgeFiles(runDir).effortEvents),
  });
}

export async function startInteractive(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  checkInteractiveArgs(argv, { stdinTTY: process.stdin.isTTY === true, stdoutTTY: process.stdout.isTTY === true }, env);
  const entry = interactiveEntry(process.cwd(), env);
  await main(argv, {
    extensionFactories: [{ name: "harness", factory: harness({ mode: "interactive", entry }) }],
  });
}
