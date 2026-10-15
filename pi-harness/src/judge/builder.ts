import fs from "node:fs";
import path from "node:path";
import type { RepoConfig } from "../config/repo-config.ts";
import { buildFixedContract } from "../contract/build.ts";
import type { Contract, EffortLevel, Material, ThinkingLevel } from "../contract/schema.ts";
import { type ChildRun, effortPiArgs, judgePiArgs, runChild } from "./child.ts";
import { checkDraft } from "./draft.ts";
import { buildEffortInput, decideEffort, type EffortDecision, type EffortRecord } from "./effort-step.ts";
import { buildJudgeInput, type JudgeInput, readJson, writeJson } from "./input.ts";
import type { JudgeRecord } from "./judge-ext.ts";

export const DEFAULT_JUDGE_THINKING: ThinkingLevel = "high";

export type JudgePhase = "judge" | "effort";

export class JudgeCancelled extends Error {
  constructor() {
    super("the judge was cancelled");
  }
}

export type JudgeOptions = {
  effort?: EffortLevel;
  thinking: ThinkingLevel;
  timeoutSec?: number;
  mcp: boolean;
  childExtraArgs: string[];
  say: (line: string) => void;
  warn?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  agentDir?: string;
  signal?: AbortSignal;
  onPhase?: (phase: JudgePhase) => void;
};

export type JudgeBuildInput = {
  original: string;
  repo: Contract["repo"];
  paths: Contract["paths"];
  model: string;
  repoConfig: RepoConfig | null;
  materials: Material[];
  attachedImages?: number;
};

export const judgeFiles = (runDir: string) => ({
  input: path.join(runDir, "judge-input.json"),
  record: path.join(runDir, "judge.json"),
  events: path.join(runDir, "judge.events.jsonl"),
  stderr: path.join(runDir, "judge.stderr.log"),
  session: path.join(runDir, "judge-session"),
  effortInput: path.join(runDir, "effort-input.json"),
  effort: path.join(runDir, "effort.json"),
  effortEvents: path.join(runDir, "effort.events.jsonl"),
  effortStderr: path.join(runDir, "effort.stderr.log"),
  effortSession: path.join(runDir, "effort-session"),
});

function readRecord<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return readJson<T>(file);
  } catch {
    return null;
  }
}

function lastLine(file: string): string {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "");
    const line = lines[lines.length - 1] ?? "";
    return line.length > 300 ? `${line.slice(0, 300)}...` : line;
  } catch {
    return "";
  }
}

export function childFailure(run: ChildRun, record: { status: string; error?: string } | null, what: string, files: { record: string; stderr: string }, timeoutSec?: number): string | undefined {
  if (record !== null && record.status === "submitted") return undefined;
  if (run.timedOut) return `the ${what} did not finish within ${timeoutSec} seconds`;
  if (run.spawnError !== undefined) return `the ${what} process could not start: ${run.spawnError}`;
  if (record === null) {
    const how = run.signal !== null ? `was killed by ${run.signal}` : `exited with code ${run.exitCode}`;
    const tail = lastLine(files.stderr);
    return `the ${what} process ${how} without writing ${path.basename(files.record)}${tail !== "" ? ` (${tail})` : ""}; see ${files.stderr}`;
  }
  return record.error ?? `the ${what} gave no result`;
}

function processInfo(run: ChildRun) {
  return {
    exitCode: run.exitCode, signal: run.signal, timedOut: run.timedOut, durationMs: run.durationMs,
    ...(run.spawnError !== undefined ? { spawnError: run.spawnError } : {}),
  };
}

export async function runEffortStep(
  firstMessage: string,
  contract: Pick<Contract, "doneConditions" | "prohibitions">,
  model: string,
  cwd: string,
  runDir: string,
  opts: JudgeOptions,
): Promise<EffortDecision> {
  const files = judgeFiles(runDir);
  if (opts.effort !== undefined) {
    const decision = decideEffort({ override: opts.effort });
    writeJson(files.effort, decision);
    return decision;
  }
  writeJson(files.effortInput, buildEffortInput(firstMessage, contract));
  if (opts.signal?.aborted) throw new JudgeCancelled();
  opts.onPhase?.("effort");
  const run = await runChild({
    args: [
      "effort-child", "--input", files.effortInput, "--out", files.effort, "--",
      ...effortPiArgs({ model, thinking: opts.thinking, sessionDir: files.effortSession, extra: opts.childExtraArgs }),
    ],
    cwd,
    stdoutFile: files.effortEvents,
    stderrFile: files.effortStderr,
    ...(opts.timeoutSec !== undefined ? { timeoutSec: opts.timeoutSec } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
  if (run.aborted === true) throw new JudgeCancelled();
  const record = readRecord<EffortRecord>(files.effort);
  const failure = childFailure(run, record, "effort step", { record: files.effort, stderr: files.effortStderr }, opts.timeoutSec);
  const decision = decideEffort({ record, ...(failure !== undefined ? { failure } : {}) });
  writeJson(files.effort, {
    ...decision,
    ...(record !== null ? { usage: record.usage, durationMs: record.durationMs, toolLog: record.toolLog, stopReason: record.stopReason } : {}),
    process: processInfo(run),
  });
  return decision;
}

export async function buildJudgeContract(input: JudgeBuildInput, opts: JudgeOptions): Promise<Contract> {
  const runDir = input.paths.runDir;
  const files = judgeFiles(runDir);
  const judgeInput: JudgeInput = buildJudgeInput({
    original: input.original,
    repo: input.repo,
    repoConfig: input.repoConfig,
    materials: input.materials,
    paths: input.paths,
    model: input.model,
    mcp: opts.mcp,
    ...(opts.agentDir !== undefined ? { agentDir: opts.agentDir } : {}),
    ...(input.attachedImages !== undefined && input.attachedImages > 0 ? { attachedImages: input.attachedImages } : {}),
  });
  writeJson(files.input, judgeInput);

  let judgeProcess: ReturnType<typeof processInfo> | undefined;
  const warn = opts.warn ?? opts.say;
  const fallback = (reason: string): Contract => {
    const record = readRecord<Record<string, unknown>>(files.record) ?? { status: "failed" };
    writeJson(files.record, { ...record, status: "failed", error: reason, fallback: true, ...(judgeProcess !== undefined ? { process: judgeProcess } : {}) });
    warn(`판정 단계가 실패해 대체 계약을 사용합니다. 이유: ${reason}`);
    if (opts.effort !== undefined) warn(`대체 계약은 노력 수준이 항상 보통이므로 --effort ${opts.effort}는 적용하지 않습니다.`);
    return buildFixedContract({
      original: input.original, repo: input.repo, paths: input.paths, model: input.model,
      repoConfig: input.repoConfig, materials: input.materials, source: "fallback",
    });
  };

  if (opts.signal?.aborted) throw new JudgeCancelled();
  opts.say(`판정 에이전트가 계약을 작성하고 있습니다. 진행 기록은 ${files.events}에 남습니다.`);
  opts.onPhase?.("judge");
  const run = await runChild({
    args: [
      "judge-child", "--input", files.input, "--out", files.record, "--",
      ...judgePiArgs({ model: input.model, thinking: opts.thinking, mcp: opts.mcp, sessionDir: files.session, extra: opts.childExtraArgs }),
    ],
    cwd: input.repo.root,
    stdoutFile: files.events,
    stderrFile: files.stderr,
    ...(opts.timeoutSec !== undefined ? { timeoutSec: opts.timeoutSec } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
  if (run.aborted === true) throw new JudgeCancelled();
  judgeProcess = processInfo(run);
  const record = readRecord<JudgeRecord>(files.record);
  if (record !== null) writeJson(files.record, { ...record, process: judgeProcess });
  const failure = childFailure(run, record, "judge", { record: files.record, stderr: files.stderr }, opts.timeoutSec);
  if (failure !== undefined || record === null || record.draft === undefined) return fallback(failure ?? "the judge gave no draft");

  const materials = [...input.materials, ...(record.materials ?? [])];
  const dry = checkDraft(record.draft, judgeInput, materials);
  if (!dry.ok) return fallback(`the submitted draft is invalid: ${dry.errors.join("; ")}`);

  const effort = await runEffortStep(input.original, dry.contract, input.model, input.repo.root, runDir, opts);
  if (effort.decidedBy === "fallback") warn(`노력 수준 판단이 실패해 보통으로 진행합니다. 이유: ${effort.error ?? "알 수 없음"}`);

  const final = checkDraft(record.draft, judgeInput, materials, { level: effort.level, decidedBy: effort.decidedBy });
  if (!final.ok) return fallback(`the contract is invalid with effort ${effort.level}: ${final.errors.join("; ")}`);
  return final.contract;
}
