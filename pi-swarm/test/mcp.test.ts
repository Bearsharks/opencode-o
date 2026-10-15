import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_SERVER_PATH } from "../src/extension.ts";
import { runStart } from "../src/start.ts";
import { stateDirFor } from "../src/state.ts";
import { fakeLauncher, tempRoot } from "./helpers.ts";

test("the stdio MCP server exposes three tools and delivers send_message to the inbox", async (t) => {
  const root = tempRoot("swarm-mcp-");
  const home = path.join(root, "home");
  const repo = path.join(root, "proj");
  fs.mkdirSync(repo);
  await runStart({ cwd: repo, launcher: fakeLauncher(), home });
  const dir = stateDirFor(repo, home);

  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_PATH],
    env: { ...process.env, PI_SWARM_DIR: dir, PI_SWARM_AGENT: "front" } as Record<string, string>,
  });
  await client.connect(transport);
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), ["create_feature_owner", "list_agents", "send_message"]);

  const sent = await client.callTool({ name: "send_message", arguments: { to: "architect", text: "안녕" } });
  assert.notEqual(sent.isError, true);
  const inbox = path.join(dir, "agents/architect/inbox");
  const files = fs.readdirSync(inbox).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);
  const msg = JSON.parse(fs.readFileSync(path.join(inbox, files[0]!), "utf8"));
  assert.equal(msg.from, "front");
  assert.equal(msg.text, "안녕");

  const bad = await client.callTool({ name: "send_message", arguments: { to: "nobody", text: "x" } });
  assert.equal(bad.isError, true);
});
