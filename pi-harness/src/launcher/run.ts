import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoConfig, type RepoConfig, repoKeyFor } from "../config/repo-config.ts";
import { buildFixedContract } from "../contract/build.ts";
import type { Contract, EffortLevel, Material, ThinkingLevel } from "../contract/schema.ts";
import { validateContract } from "../contract/validate.ts";
import { buildJudgeContract, DEFAULT_JUDGE_THINKING, type JudgeOptions } from "../judge/builder.ts";
import { childExtraArgs } from "../judge/child.ts";
import { EFFORT_LEVELS, isEffortLevel } from "../judge/effort-step.ts";
import { CliError, checkWorkPassthrough, parseFlags, say, startWork } from "./work.ts";

export const RUN_USAGE = `  pi-harness run [--repo <dir>] --model <provider/id> [--contract-mode fixed|judge] [--run-dir <dir>] [--materials-dir <dir>] (--message-file <file> | --message <text>) [-- <pi args>]
      judge mode only: [--effort low|medium|high|extreme] [--judge-thinking <level>] [--judge-timeout <seconds>] [--judge-mcp]`;

export const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MODEL_ENV = "PI_HARNESS_MODEL";
export const REPOS_DIR_ENV = "PI_HARNESS_REPOS_DIR";

export const CONTRACT_MODES = ["fixed", "judge"] as const;
export type ContractMode = (typeof CONTRACT_MODES)[number];

export const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export type RunOptions = {
  repo: string;
  model: string;
  mode: ContractMode;
  runDir?: string;
  materialsDir?: string;
  message: string;
  passthrough: string[];
  effort?: EffortLevel;
  judgeThinking?: ThinkingLevel;
  judgeTimeoutSec?: number;
  judgeMcp?: boolean;
};

const JUDGE_FLAGS = ["--effort", "--judge-thinking", "--judge-timeout", "--judge-mcp"];

export function parseRunArgs(argv: string[], env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): RunOptions {
  const flags = parseFlags(
    argv,
    ["--repo", "--model", "--contract-mode", "--run-dir", "--materials-dir", "--message-file", "--message", "--effort", "--judge-thinking", "--judge-timeout"],
    ["--judge-mcp"],
  );
  const v = flags.values;

  const mode = v.get("--contract-mode") ?? "fixed";
  if (!(CONTRACT_MODES as readonly string[]).includes(mode)) {
    throw new CliError(`--contract-mode must be one of ${CONTRACT_MODES.join(", ")} (got "${mode}").`);
  }

  const usedJudgeFlags = JUDGE_FLAGS.filter((f) => v.has(f) || flags.booleans.has(f));
  if (mode !== "judge" && usedJudgeFlags.length > 0) {
    throw new CliError(`${usedJudgeFlags.join(", ")} only apply to --contract-mode judge.`);
  }
  const effort = v.get("--effort");
  if (effort !== undefined && !isEffortLevel(effort)) {
    throw new CliError(`--effort must be one of ${EFFORT_LEVELS.join(", ")} (got "${effort}").`);
  }
  const judgeThinking = v.get("--judge-thinking");
  if (judgeThinking !== undefined && !(THINKING_LEVELS as readonly string[]).includes(judgeThinking)) {
    throw new CliError(`--judge-thinking must be one of ${THINKING_LEVELS.join(", ")} (got "${judgeThinking}").`);
  }
  const judgeTimeout = v.get("--judge-timeout");
  if (judgeTimeout !== undefined && !/^[1-9]\d*$/.test(judgeTimeout)) {
    throw new CliError(`--judge-timeout must be a positive whole number of seconds (got "${judgeTimeout}").`);
  }

  const model = v.get("--model") ?? env[MODEL_ENV];
  if (model === undefined || model.trim() === "") {
    throw new CliError(`run needs --model <provider/id> (or the ${MODEL_ENV} environment variable).\nUsage:\n${RUN_USAGE}`);
  }

  const messageFile = v.get("--message-file");
  const messageText = v.get("--message");
  if (messageFile !== undefined && messageText !== undefined) {
    throw new CliError("Give the message with either --message-file or --message, not both.");
  }
  let message: string;
  if (messageFile !== undefined) {
    const file = path.resolve(cwd, messageFile);
    try {
      message = fs.readFileSync(file, "utf8");
    } catch (e) {
      throw new CliError(`Cannot read message file ${file}: ${(e as Error).message}`);
    }
  } else if (messageText !== undefined) {
    message = messageText;
  } else {
    throw new CliError(`run needs the request as --message-file <file> or --message <text>.\nUsage:\n${RUN_USAGE}`);
  }
  if (message.trim() === "") throw new CliError("The message is empty; describe the work to do.");

  const opts: RunOptions = {
    repo: path.resolve(cwd, v.get("--repo") ?? "."),
    model,
    mode: mode as ContractMode,
    message,
    passthrough: flags.passthrough,
  };
  const runDir = v.get("--run-dir");
  if (runDir !== undefined) opts.runDir = path.resolve(cwd, runDir);
  const materialsDir = v.get("--materials-dir");
  if (materialsDir !== undefined) opts.materialsDir = path.resolve(cwd, materialsDir);
  if (effort !== undefined) opts.effort = effort as EffortLevel;
  if (judgeThinking !== undefined) opts.judgeThinking = judgeThinking as ThinkingLevel;
  if (judgeTimeout !== undefined) opts.judgeTimeoutSec = Number(judgeTimeout);
  if (flags.booleans.has("--judge-mcp")) opts.judgeMcp = true;
  return opts;
}

export type TargetRepo = { root: string; headSha: string; branch?: string; remoteUrl?: string; repoKey: string };

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

export function resolveTargetRepo(dir: string): TargetRepo {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new CliError(`Repository directory ${dir} does not exist.`);
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  if (top === undefined || top === "") throw new CliError(`${dir} is not inside a git repository; run needs a git repository (use --repo <dir>).`);
  const root = fs.realpathSync(top);
  const headSha = git(root, ["rev-parse", "--verify", "HEAD"]);
  if (headSha === undefined || headSha === "") throw new CliError(`Repository ${root} has no commits yet; commit once before running.`);
  const branch = git(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const remoteUrl = git(root, ["remote", "get-url", "origin"]);
  const repo: TargetRepo = { root, headSha, repoKey: repoKeyFor(root, remoteUrl) };
  if (branch !== undefined && branch !== "") repo.branch = branch;
  if (remoteUrl !== undefined && remoteUrl !== "") repo.remoteUrl = remoteUrl;
  return repo;
}

export function newRunId(now: Date = new Date(), suffix: string = randomBytes(3).toString("hex")): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
  return `${stamp}-${suffix}`;
}

export function defaultRunDir(home: string = os.homedir(), runId: string = newRunId()): string {
  return path.join(home, ".pi-harness", "runs", runId);
}

export function createRunDir(runDir: string): Contract["paths"] {
  const paths = { runDir, materialsDir: path.join(runDir, "materials") };
  for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
  return paths;
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function mediaTypeFor(file: string): string {
  return MEDIA_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export function listMaterials(dir: string): Material[] {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new CliError(`Materials directory ${abs} does not exist.`);
  const names = fs.readdirSync(abs).filter((name) => fs.statSync(path.join(abs, name)).isFile()).sort();
  return names.map((name, i) => ({
    id: `M${i + 1}`,
    path: path.join(abs, name),
    mediaType: mediaTypeFor(name),
    describe: name,
    origin: { kind: "case" },
  }));
}

export function reposDirFor(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[REPOS_DIR_ENV];
  return override !== undefined && override !== "" ? path.resolve(override) : path.join(os.homedir(), ".pi-harness", "repos");
}

export type RunContractInput = {
  original: string;
  repo: Contract["repo"];
  paths: Contract["paths"];
  model: string;
  repoConfig: RepoConfig | null;
  materials: Material[];
  judge?: JudgeOptions;
};

export type ContractBuilder = (input: RunContractInput) => Promise<Contract>;

const CONTRACT_BUILDERS: Record<ContractMode, ContractBuilder | undefined> = {
  fixed: async ({ judge: _judge, ...input }) => buildFixedContract({ ...input, source: "fixed" }),
  judge: async ({ judge, ...input }) => {
    if (judge === undefined) throw new CliError("--contract-mode judge needs judge options.");
    return buildJudgeContract(input, judge);
  },
};

export function judgeOptionsFor(opts: RunOptions, say: (line: string) => void, env?: NodeJS.ProcessEnv): JudgeOptions {
  const judge: JudgeOptions = {
    thinking: opts.judgeThinking ?? DEFAULT_JUDGE_THINKING,
    mcp: opts.judgeMcp ?? false,
    childExtraArgs: childExtraArgs(env ?? process.env),
    say,
  };
  if (opts.effort !== undefined) judge.effort = opts.effort;
  if (opts.judgeTimeoutSec !== undefined) judge.timeoutSec = opts.judgeTimeoutSec;
  if (env !== undefined) {
    judge.env = env;
    const agentDir = env.PI_CODING_AGENT_DIR;
    if (agentDir !== undefined && agentDir !== "") judge.agentDir = path.resolve(agentDir);
  }
  return judge;
}

export function contractBuilderFor(mode: ContractMode): ContractBuilder {
  const builder = CONTRACT_BUILDERS[mode];
  if (builder === undefined) throw new CliError(`--contract-mode ${mode} is not implemented yet; use --contract-mode fixed.`);
  return builder;
}

export type RunContext = { reposDir: string; home: string; say: (line: string) => void; env?: NodeJS.ProcessEnv };
export type PreparedRun = { contract: Contract; runDir: string; contractFile: string; target: TargetRepo };

export async function prepareRun(opts: RunOptions, ctx: RunContext): Promise<PreparedRun> {
  const build = contractBuilderFor(opts.mode);
  const target = resolveTargetRepo(opts.repo);

  let repoConfig: RepoConfig | null;
  try {
    repoConfig = loadRepoConfig(ctx.reposDir, target.repoKey, target.remoteUrl, target.root);
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  if (repoConfig === null) {
    ctx.say(`경고: 레포 ${target.repoKey}의 설정 파일이 ${ctx.reposDir}에 없습니다.`);
  }

  const materials = opts.materialsDir !== undefined ? listMaterials(opts.materialsDir) : [];
  const runDir = path.resolve(opts.runDir ?? defaultRunDir(ctx.home));
  const contractFile = path.join(runDir, "contract.json");
  if (fs.existsSync(contractFile)) throw new CliError(`Run directory ${runDir} already has a contract.json; choose a new --run-dir.`);
  const paths = createRunDir(runDir);

  const repo: Contract["repo"] = { root: target.root, headSha: target.headSha, repoKey: target.repoKey };
  if (target.branch !== undefined) repo.branch = target.branch;
  const contractInput: RunContractInput = { original: opts.message, repo, paths, model: opts.model, repoConfig, materials };
  if (opts.mode === "judge") contractInput.judge = judgeOptionsFor(opts, ctx.say, ctx.env);
  const contract = await build(contractInput);
  const result = validateContract(contract);
  if (!result.ok) throw new CliError(`The built contract is invalid:\n- ${result.errors.join("\n- ")}`);
  fs.writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  ctx.say(`실행 폴더: ${runDir}`);
  return { contract, runDir, contractFile, target };
}

export const JUDGE_USAGE = `  pi-harness judge [--repo <dir>] --model <provider/id> [--run-dir <dir>] [--materials-dir <dir>] (--message-file <file> | --message <text>) [--effort low|medium|high|extreme] [--judge-thinking <level>] [--judge-timeout <seconds>] [--judge-mcp]
      runs only the judge (as run --contract-mode judge) and stops after writing contract.json`;

export async function judge(argv: string[]): Promise<PreparedRun> {
  const opts = parseRunArgs(["--contract-mode", "judge", ...argv]);
  if (opts.mode !== "judge") throw new CliError("judge always uses --contract-mode judge.");
  if (opts.passthrough.length > 0) throw new CliError("judge takes no pi arguments; it starts no work session.");
  childExtraArgs();
  const prepared = await prepareRun(opts, { reposDir: reposDirFor(), home: os.homedir(), say });
  say(`계약 파일: ${prepared.contractFile}`);
  return prepared;
}

export async function run(argv: string[]): Promise<void> {
  const opts = parseRunArgs(argv);
  contractBuilderFor(opts.mode);
  checkWorkPassthrough(opts.passthrough);
  if (opts.mode === "judge") childExtraArgs();
  const prepared = await prepareRun(opts, { reposDir: reposDirFor(), home: os.homedir(), say });
  await startWork({ contract: prepared.contract, runDir: prepared.runDir, passthrough: opts.passthrough });
}
