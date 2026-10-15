import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Launcher } from "./launcher.ts";
import { createFeatureOwner, listAgents, sendMessage } from "./tools.ts";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

async function wrap(fn: () => string | Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (e) {
    return { content: [{ type: "text", text: (e as Error).message }], isError: true };
  }
}

export function buildServer(dir: string, agent: string, launcher: Launcher): McpServer {
  const server = new McpServer({ name: "swarm", version: "0.0.0" });
  server.registerTool("list_agents", {
    description: "List all agents in this swarm.",
  }, () => wrap(() => listAgents(dir)));
  server.registerTool("send_message", {
    description: "Send a message to another agent.",
    inputSchema: { to: z.string(), text: z.string() },
  }, ({ to, text }) => wrap(() => sendMessage(dir, agent, to, text)));
  server.registerTool("create_feature_owner", {
    description: "Create a feature owner agent with its own branch and worktree.",
    inputSchema: { name: z.string(), feature: z.string(), context: z.string() },
  }, (args) => wrap(async () => JSON.stringify(await createFeatureOwner(dir, args, launcher), null, 2)));
  return server;
}
