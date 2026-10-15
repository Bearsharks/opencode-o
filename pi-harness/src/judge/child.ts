import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../contract/schema.ts";
import { CliError, parseFlags } from "../launcher/work.ts";
import { EFFORT_SENTINEL, EFFORT_TOOLS, type EffortInput, effortSession } from "./effort-step.ts";
import { JUDGE_TOOLS, judgeSession } from "./judge-ext.ts";
import { type JudgeInput, readJson } from "./input.ts";
import { JUDGE_SENTINEL } from "./prompt.ts";

export const HARNESS_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/pi-harness.ts");
export const CHILD_EXTRA_ARGS_ENV = "PI_HARNESS_CHILD_EXTRA_ARGS";
export const KILL_GRACE_MS = 5000;

export function childExtraArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[CHILD_EXTRA_ARGS_ENV];
  if (raw === undefined || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new CliError(`${CHILD_EXTRA_ARGS_ENV} must be a JSON array of strings: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed) || !parsed.every((a) => typeof a === "string")) {
    throw new CliError(`${CHILD_EXTRA_ARGS_ENV} must be a JSON array of strings.`);
  }
  if (parsed.includes("--")) throw new CliError(`${CHILD_EXTRA_ARGS_ENV} must not contain "--".`);
  return parsed as string[];
}

const COMMON_CHILD_ARGS = ["--mode", "json", "-p", "-ne", "-nc", "-ns", "-np", "-na", "--no-themes"];

export function judgePiArgs(opts: { model: string; thinking: ThinkingLevel; mcp: boolean; sessionDir: string; extra?: string[] }): string[] {
  const tools = opts.mcp ? [...JUDGE_TOOLS, "tool_search"] : [...JUDGE_TOOLS];
  return [
    ...COMMON_CHILD_ARGS,
    "--model", opts.model,
    "--thinking", opts.thinking,
    "--tools", tools.join(","),
    "--session-dir", opts.sessionDir,
    ...(opts.mcp ? ["-e", "builtin:mcp", "-e", "builtin:tool-search"] : []),
    ...(opts.extra ?? []),
    "--", JUDGE_SENTINEL,
  ];
}

export function effortPiArgs(opts: { model: string; thinking: ThinkingLevel; sessionDir: string; extra?: string[] }): string[] {
  return [
    ...COMMON_CHILD_ARGS,
    "--model", opts.model,
    "--thinking", opts.thinking,
    "--tools", EFFORT_TOOLS.join(","),
    "--session-dir", opts.sessionDir,
    ...(opts.extra ?? []),
    "--", EFFORT_SENTINEL,
  ];
}

export type ChildRun = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  spawnError?: string;
  aborted?: true;
};

export type RunChildOptions = {
  args: string[];
  cwd: string;
  stdoutFile: string;
  stderrFile: string;
  timeoutSec?: number;
  env?: NodeJS.ProcessEnv;
  command?: string;
  signal?: AbortSignal;
};

export function runChild(opts: RunChildOptions): Promise<ChildRun> {
  const started = Date.now();
  fs.mkdirSync(path.dirname(opts.stdoutFile), { recursive: true });
  const out = fs.openSync(opts.stdoutFile, "w");
  const err = fs.openSync(opts.stderrFile, "w");
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let onAbort: (() => void) | undefined;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (r: Omit<ChildRun, "durationMs" | "timedOut">) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (onAbort !== undefined) opts.signal?.removeEventListener("abort", onAbort);
      resolve({ ...r, timedOut, durationMs: Date.now() - started, ...(aborted ? { aborted: true as const } : {}) });
    };
    if (opts.signal?.aborted) {
      fs.closeSync(out);
      fs.closeSync(err);
      aborted = true;
      finish({ exitCode: null, signal: null });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(opts.command ?? process.execPath, opts.command !== undefined ? opts.args : [HARNESS_BIN, ...opts.args], {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        stdio: ["ignore", out, err],
      });
    } catch (e) {
      fs.closeSync(out);
      fs.closeSync(err);
      finish({ exitCode: null, signal: null, spawnError: (e as Error).message });
      return;
    }
    fs.closeSync(out);
    fs.closeSync(err);
    child.on("error", (e) => finish({ exitCode: null, signal: null, spawnError: e.message }));
    child.on("exit", (code, signal) => finish({ exitCode: code, signal }));
    const stop = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    if (opts.timeoutSec !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, opts.timeoutSec * 1000);
    }
    if (opts.signal !== undefined) {
      onAbort = () => {
        aborted = true;
        stop();
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function judgeChildCommand(argv: string[]): Promise<void> {
  const flags = parseFlags(argv, ["--input", "--out"], []);
  const inputFile = flags.values.get("--input");
  const outFile = flags.values.get("--out");
  if (inputFile === undefined || outFile === undefined) throw new CliError("judge-child needs --input <file> and --out <file>.");
  const input = readJson<JudgeInput>(path.resolve(inputFile));
  const session = judgeSession(input, path.resolve(outFile));
  process.chdir(input.repo.root);
  try {
    await main(flags.passthrough, { extensionFactories: [{ name: "pi-harness-judge", factory: session.factory }] });
  } catch (e) {
    session.write(`the judge process failed: ${(e as Error).message}`);
    throw e;
  }
  session.write();
}

export async function effortChildCommand(argv: string[]): Promise<void> {
  const flags = parseFlags(argv, ["--input", "--out"], []);
  const inputFile = flags.values.get("--input");
  const outFile = flags.values.get("--out");
  if (inputFile === undefined || outFile === undefined) throw new CliError("effort-child needs --input <file> and --out <file>.");
  const input = readJson<EffortInput>(path.resolve(inputFile));
  const session = effortSession(input, path.resolve(outFile));
  try {
    await main(flags.passthrough, { extensionFactories: [{ name: "pi-harness-effort", factory: session.factory }] });
  } catch (e) {
    session.write(`the effort process failed: ${(e as Error).message}`);
    throw e;
  }
  session.write();
}
