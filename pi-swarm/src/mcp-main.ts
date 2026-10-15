import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tmuxLauncher } from "./launcher.ts";
import { buildServer } from "./mcp-server.ts";

const dir = process.env.PI_SWARM_DIR;
const agent = process.env.PI_SWARM_AGENT;
if (dir === undefined || dir === "" || agent === undefined || agent === "") {
  console.error("PI_SWARM_DIR and PI_SWARM_AGENT are required");
  process.exit(1);
}
await buildServer(dir, agent, tmuxLauncher()).connect(new StdioServerTransport());
