import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { Context } from "@opencode/plugin/promise/plugin";

export async function installAgents(ctx: Context) {
  // Native agent discovery must not reload these unexpanded templates afterward.
  const directory = resolve(import.meta.dir, "../../agent-templates");
  const agents = readdirSync(directory).filter(name => name.endsWith(".md")).map(file => {
    const text = readFileSync(resolve(directory, file), "utf8");
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!match) throw new Error(`Invalid agent file: ${file}`);
    const metadata = parse(match[1]);
    if (metadata.name !== file.slice(0, -3) || metadata.mode !== "subagent") throw new Error(`Invalid subagent definition: ${file}`);
    return { ...metadata, system: match[2].replaceAll("@PSTACK_MODE_FILE@", resolve(directory, "../skills/poteto-mode/SKILL.md")) };
  });
  await ctx.agent.transform(editor => {
    for (const definition of agents) editor.update(definition.name, agent => {
      if (agent.system && agent.system !== definition.system) throw new Error(`Conflicting agent instructions: ${definition.name}`);
      agent.system = definition.system;
      agent.description = definition.description;
      agent.mode = "subagent";
    });
  });
}
