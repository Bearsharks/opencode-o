import fs from "node:fs";
import path from "node:path";
import { main, parseArgs, SessionManager } from "@earendil-works/pi-coding-agent";
import { harness } from "../harness/index.ts";
import { type ContractEntryData, ENTRY_CONTRACT } from "../harness/types.ts";
import { effortChildCommand, judgeChildCommand } from "../judge/child.ts";
import { startInteractive } from "./interactive.ts";
import { JUDGE_USAGE, judge, run, RUN_USAGE } from "./run.ts";
import { CliError, loadContract, checkWorkPassthrough, parseFlags, say, startWork } from "./work.ts";

export { CliError, checkWorkPassthrough, loadContract, workArgv } from "./work.ts";

const USAGE = `Usage:
  pi-harness [<pi args>]
      opens the pi TUI in the current folder (target repo: its git root); the first task message you type is judged into a
      contract (Esc or /harness-cancel cancels the judge), then that message starts the work with the contract injected
${RUN_USAGE}
${JUDGE_USAGE}
  pi-harness work --contract <file> [--run-dir <dir>] [-- <pi args>]
  pi-harness resume --session <path-or-id> [--run-dir <dir>] [-- <pi args>]`;

async function work(argv: string[]): Promise<void> {
  const flags = parseFlags(argv, ["--contract", "--run-dir"], []);
  const file = flags.values.get("--contract");
  if (file === undefined) throw new CliError(`work needs --contract <file>.\n${USAGE}`);
  const contract = loadContract(path.resolve(file));
  checkWorkPassthrough(flags.passthrough);
  const runDir = path.resolve(flags.values.get("--run-dir") ?? contract.paths.runDir);
  await startWork({ contract, runDir, passthrough: flags.passthrough });
}

export async function resolveSessionFile(arg: string, sessionDir?: string): Promise<string> {
  if (arg.includes("/") || arg.includes("\\") || arg.endsWith(".jsonl")) {
    const p = path.resolve(arg);
    if (!fs.existsSync(p)) throw new CliError(`Session file ${p} does not exist.`);
    return p;
  }
  const all = await SessionManager.listAll(sessionDir);
  const hit = all.find((s) => s.id === arg) ?? all.find((s) => s.id.startsWith(arg));
  if (hit === undefined) throw new CliError(`No session with id ${arg} was found.`);
  return hit.path;
}

export function readSessionContract(file: string): { data: ContractEntryData; cwd: string | undefined } {
  let data: ContractEntryData | undefined;
  let cwd: string | undefined;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let entry: { type?: string; customType?: string; data?: unknown; cwd?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "session" && typeof entry.cwd === "string" && entry.cwd !== "") cwd = entry.cwd;
    if (entry.type === "custom" && entry.customType === ENTRY_CONTRACT && entry.data !== undefined) data = entry.data as ContractEntryData;
  }
  if (data === undefined) throw new CliError(`Session ${file} has no harness contract; it was not started with pi-harness work.`);
  return { data, cwd };
}

async function resume(argv: string[]): Promise<void> {
  const flags = parseFlags(argv, ["--session", "--run-dir"], []);
  const arg = flags.values.get("--session");
  if (arg === undefined) throw new CliError(`resume needs --session <path-or-id>.\n${USAGE}`);
  const parsed = parseArgs(flags.passthrough);
  if (parsed.session !== undefined || parsed.continue || parsed.resume || parsed.fork !== undefined) {
    throw new CliError("Do not pass --session, --continue, --resume or --fork after \"--\"; use --session before it.");
  }
  const file = await resolveSessionFile(arg, parsed.sessionDir);
  const { data, cwd } = readSessionContract(file);
  const runDir = path.resolve(flags.values.get("--run-dir") ?? data.runDir ?? data.contract.paths.runDir);
  fs.mkdirSync(runDir, { recursive: true });
  process.chdir(cwd ?? data.contract.repo.root);
  await main(["--no-mcp", "--session", file, ...flags.passthrough], {
    extensionFactories: [{
      name: "harness",
      factory: harness({ contract: data.contract, runDir, mode: "resume" }),
    }],
  });
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === "run") await run(rest);
    else if (command === "judge") await judge(rest);
    else if (command === "work") await work(rest);
    else if (command === "resume") await resume(rest);
    else if (command === "judge-child" || command === "effort-child") {
      await (command === "judge-child" ? judgeChildCommand(rest) : effortChildCommand(rest));
      process.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
    }
    else if (command === "--help" || command === "-h") say(USAGE);
    else await startInteractive(argv);
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      say(`pi-harness: ${e.message}`);
      return 2;
    }
    throw e;
  }
}
