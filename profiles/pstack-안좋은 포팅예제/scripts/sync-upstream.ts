import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve, join, relative, dirname } from "node:path"
import { execFileSync } from "node:child_process"
import YAML from "yaml"
import { nativeMarkdown } from "./native-markdown"

const profile = resolve(import.meta.dir, "..")
const source = process.argv[2] && resolve(process.argv[2])
if (!source) throw new Error("Usage: bun profiles/pstack/scripts/sync-upstream.ts /path/to/cursor-plugins-checkout")
const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
if (execFileSync("git", ["-C", source, "status", "--porcelain", "--", "pstack", "cursor-team-kit/skills/deslop", "cursor-team-kit/skills/control-ui", "cursor-team-kit/skills/control-cli"], { encoding: "utf8" }).trim())
  throw new Error("Upstream checkout must be clean")
for (const path of ["pstack/skills/poteto-mode/SKILL.md", "pstack/agents/poteto-agent.md", "pstack/docs/guide/README.md", "pstack/LICENSE", "cursor-team-kit/skills/control-cli/SKILL.md", "cursor-team-kit/skills/control-ui/SKILL.md", "cursor-team-kit/skills/deslop/SKILL.md"]) {
  if (!existsSync(join(source, path))) throw new Error(`Missing upstream input: ${path}`)
}
const files: Record<string, { source: string; sha256: string }> = {}
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex")
function copy(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
}
// Only generated trees are replaced. Native workflow overrides and runtime are local.
for (const tree of ["skills", "docs/guide"]) rmSync(join(profile, tree), { recursive: true, force: true })
copy(join(source, "pstack/skills"), join(profile, "skills"))
copy(join(source, "pstack/docs/guide"), join(profile, "docs/guide"))
copy(join(source, "pstack/assets"), join(profile, "assets"))
copy(join(source, "pstack/LICENSE"), join(profile, "LICENSE"))
copy(join(source, "cursor-team-kit/LICENSE"), join(profile, "LICENSE.cursor-team-kit"))
for (const name of ["deslop", "control-ui", "control-cli"])
  copy(join(source, "cursor-team-kit/skills", name), join(profile, "skills", name))
copy(join(profile, "overrides/skills"), join(profile, "skills"))
if (existsSync(join(profile, "overrides/docs"))) copy(join(profile, "overrides/docs"), join(profile, "docs"))
for (const name of ["poteto-agent", "comment-sicko"]) {
  const original = readFileSync(join(source, "pstack/agents", `${name}.md`), "utf8")
  const match = original.match(/^---\n([\s\S]*?)\n---\n/)!;
  const front = YAML.parse(match[1])
  front.description = nativeMarkdown(front.description)
  delete front.is_background
  front.mode = "subagent"
  let body = original.slice(match[0].length)
  if (name === "poteto-agent") body = `\n# Poteto subagent\n\nYou are a scoped delegate. Your parent owns the playbook and shared todo list. Load poteto-mode with the native skill tool before working, then read the relevant principle leaf skills. Use the absolute skill path in your parent's brief if tool loading is unavailable. Follow only the delegated scope; do not restart the parent playbook. Keep the model selected by your parent. Resolve the appropriate configured pstack role before delegating any subtask. Return changed files, evidence, unresolved issues, and the next action for the parent.\n`
  writeFileSync(join(profile, "agents", `${name}.md`), `---\n${YAML.stringify(front)}---\n${nativeMarkdown(body)}`)
}
const config = JSON.parse(readFileSync(join(profile, "opencode.jsonc"), "utf8"))
delete config.commands
for (const item of readdirSync(join(profile, "skills"), { withFileTypes: true }).filter(x => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const path = join(profile, "skills", item.name, "SKILL.md")
  const text = readFileSync(path, "utf8")
  const match = text.match(/^---\n([\s\S]*?)\n---\n/)!
  if (!match) throw new Error(`Missing frontmatter: ${path}`)
  const front = YAML.parse(match[1])
  front.name = item.name
  front.description = nativeMarkdown(front.description)
  const originalSkill = join(source, "pstack/skills", item.name, "SKILL.md")
  const originalFront = existsSync(originalSkill) ? YAML.parse(readFileSync(originalSkill, "utf8").match(/^---\n([\s\S]*?)\n---\n/)![1]) : front
  front.metadata = { ...front.metadata, "opencode/autoinvoke": originalFront["disable-model-invocation"] !== true }
  delete front["disable-model-invocation"]
  delete front.icon
  delete front.color
  const paths = front.paths
  delete front.paths
  const body = (paths ? `Apply to matching files: ${Array.isArray(paths) ? paths.join(", ") : paths}.\n\n` : "") + text.slice(match[0].length).trim()
  writeFileSync(path, `---\n${YAML.stringify(front)}---\n\n${nativeMarkdown(body)}\n`)
}
writeFileSync(join(profile, "opencode.jsonc"), JSON.stringify(config, null, 2) + "\n")
function rewriteMarkdown(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== "node_modules") rewriteMarkdown(path) }
    else if (entry.name.endsWith(".md")) writeFileSync(path, nativeMarkdown(readFileSync(path, "utf8")))
  }
}
for (const tree of ["skills", "docs/guide"]) rewriteMarkdown(join(profile, tree))
function inventory(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== "node_modules") inventory(path); continue }
    const rel = relative(profile, path)
    const skill = rel.split("/")[1]
    const origin = rel.startsWith("skills/") ? (["deslop", "control-ui", "control-cli"].includes(skill) ? "cursor-team-kit" : existsSync(join(profile, "overrides", rel)) ? "local override" : "pstack") : "pstack"
    files[rel] = { source: origin, sha256: hash(readFileSync(path)) }
  }
}
for (const tree of ["skills", "docs/guide"]) inventory(join(profile, tree))
for (const name of ["poteto-agent", "comment-sicko"]) {
  const path = `agents/${name}.md`
  files[path] = { source: "pstack (adapted)", sha256: hash(readFileSync(join(profile, path))) }
}
writeFileSync(join(profile, "upstream.json"), JSON.stringify({ repository: "https://github.com/cursor/plugins", commit, reference: { repository: "https://github.com/falentio/opencode-pstack", commit: "14fc4a66fc5f0265fb4068b16dee8045abdeac89", usage: "Design reference only; no package or runtime code installed" }, files }, null, 2) + "\n")
console.log(`Synced ${readdirSync(join(profile, "skills")).length} skills from ${commit}`)
