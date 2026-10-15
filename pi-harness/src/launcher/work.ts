import fs from "node:fs";
import { main, parseArgs } from "@earendil-works/pi-coding-agent";
import { renderUserSummary } from "../contract/render.ts";
import type { Contract } from "../contract/schema.ts";
import { validateContract } from "../contract/validate.ts";
import { harness } from "../harness/index.ts";
import { INITIAL_GOAL_SENTINEL } from "../harness/types.ts";

export class CliError extends Error {}

export type Flags = { values: Map<string, string>; booleans: Set<string>; passthrough: string[] };

export function parseFlags(argv: string[], valueFlags: string[], booleanFlags: string[]): Flags {
  const flags: Flags = { values: new Map(), booleans: new Set(), passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      flags.passthrough = argv.slice(i + 1);
      break;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (valueFlags.includes(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value === "") throw new CliError(`${name} needs a value.`);
      flags.values.set(name, value);
    } else if (booleanFlags.includes(arg)) {
      flags.booleans.add(arg);
    } else {
      throw new CliError(`Unknown argument "${arg}". Pass pi arguments after "--".`);
    }
  }
  return flags;
}

export function say(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function loadContract(file: string): Contract {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new CliError(`Cannot read contract ${file}: ${(e as Error).message}`);
  }
  const result = validateContract(data);
  if (!result.ok) throw new CliError(`Contract ${file} is invalid:\n- ${result.errors.join("\n- ")}`);
  return data as Contract;
}

export function checkWorkPassthrough(passthrough: string[]): void {
  if (passthrough.includes("--")) throw new CliError("pi arguments must not contain a second \"--\".");
  const parsed = parseArgs(passthrough);
  if (parsed.messages.length > 0) {
    throw new CliError(`pi arguments must not contain a message (${JSON.stringify(parsed.messages[0])}); the first message is the contract goal.`);
  }
  const conflicts = [
    parsed.session !== undefined ? "--session" : undefined,
    parsed.continue ? "--continue" : undefined,
    parsed.resume ? "--resume" : undefined,
    parsed.fork !== undefined ? "--fork" : undefined,
  ].filter((f) => f !== undefined);
  if (conflicts.length > 0) throw new CliError(`${conflicts.join(", ")} cannot be used with work; use "pi-harness resume".`);
  if (parsed.mode === "rpc") throw new CliError("--mode rpc is not supported by work: rpc mode does not send the first message.");
  if (parsed.model !== undefined || parsed.thinking !== undefined) {
    say("Note: --model and --thinking from the contract runtime override the ones given after \"--\".");
  }
}

export function workArgv(contract: Contract, passthrough: string[]): string[] {
  return [
    ...passthrough,
    "--model", contract.runtime.model,
    "--thinking", contract.runtime.thinkingLevel,
    "--no-mcp",
    "--", INITIAL_GOAL_SENTINEL,
  ];
}

export type StartWorkOptions = { contract: Contract; runDir: string; passthrough: string[] };

export async function startWork(opts: StartWorkOptions): Promise<void> {
  const { contract, runDir } = opts;
  fs.mkdirSync(runDir, { recursive: true });
  const root = fs.realpathSync(contract.repo.root);
  say(renderUserSummary(contract));
  say("");
  process.chdir(root);
  await main(workArgv(contract, opts.passthrough), {
    extensionFactories: [{
      name: "harness",
      factory: harness({ contract, runDir, mode: "start" }),
    }],
  });
}
