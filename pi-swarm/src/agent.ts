import fs from "node:fs";
import path from "node:path";
import { main } from "@earendil-works/pi-coding-agent";
import { swarmExtension } from "./extension.ts";
import { agentDir, findAgent, readState, startMessageFile } from "./state.ts";

export type PreparedAgent = { cwd: string; argv: string[]; hasInitialMessage: boolean };

export function prepareAgent(dir: string, name: string): PreparedAgent {
  const row = findAgent(readState(dir), name);
  if (row === undefined) throw new Error(`agents.json에 ${name} 에이전트가 없습니다.`);
  const file = startMessageFile(dir, name);
  if (!fs.existsSync(file)) return { cwd: row.cwd, argv: [], hasInitialMessage: false };
  const content = fs.readFileSync(file, "utf8");
  fs.renameSync(file, path.join(agentDir(dir, name), "start-message.sent.md"));
  return { cwd: row.cwd, argv: ["--", content], hasInitialMessage: true };
}

export async function runAgent(name: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const dir = env.PI_SWARM_DIR;
  if (dir === undefined || dir === "") throw new Error("PI_SWARM_DIR가 설정되지 않았습니다.");
  const prepared = prepareAgent(dir, name);
  process.chdir(prepared.cwd);
  await main(prepared.argv, {
    extensionFactories: [{
      name: "swarm",
      factory: swarmExtension({ dir, name, hasInitialMessage: prepared.hasInitialMessage }),
    }],
  });
}
