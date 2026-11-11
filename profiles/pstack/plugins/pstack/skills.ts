import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parse } from "yaml";
import type { Skill } from "@opencode/schema/skill";

export function loadSkills(directory: string): Skill.Info[] {
  const folders = (path: string): string[] => existsSync(resolve(path, "SKILL.md")) ? [path] : readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules").sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => folders(resolve(path, entry.name)));
  const skills = folders(directory).map(folder => {
    const path = resolve(folder, "SKILL.md");
    const text = readFileSync(path, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    if (!match) throw new Error(`Invalid skill frontmatter: ${path}`);
    const meta = parse(match[1]);
    meta.autoinvoke = meta.metadata?.["opencode/autoinvoke"];
    if (meta.name !== basename(folder) || typeof meta.description !== "string" || typeof meta.autoinvoke !== "boolean") {
      throw new Error(`Skill requires name, description and explicit native invocation policy: ${path}`);
    }
    return { id: meta.name, name: meta.name, description: meta.description, autoinvoke: meta.autoinvoke, path, content: match[2] };
  });
  if (new Set(skills.map(skill => skill.id)).size !== skills.length) throw new Error("Duplicate skill names in profile");
  return skills;
}
