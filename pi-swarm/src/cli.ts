import { runAgent } from "./agent.ts";
import { tmuxLauncher } from "./launcher.ts";
import { runStart } from "./start.ts";

const USAGE = "사용법: pi-swarm start | pi-swarm agent <name>";

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "start" && rest.length === 0) return await runStart({ cwd: process.cwd(), launcher: tmuxLauncher() });
    if (cmd === "agent" && rest.length === 1) {
      await runAgent(rest[0]!);
      return 0;
    }
    console.error(USAGE);
    return 2;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}
