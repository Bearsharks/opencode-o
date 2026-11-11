import { test, expect } from "bun:test"
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import plugin, { loadSkills, profileRoot, parseMarkdown } from "./plugins/pstack"

function harness(options: { skill?: any; agent?: any } = {}) {
  const agents = new Map<string, any>()
  const skills = new Map<string, any>()
  const hooks = new Map<string, Function>()
  const commands = new Map<string, any>()
  const prompts: any[] = []
  let defaultAgent: string | undefined
  if (options.skill) skills.set(options.skill.id, options.skill)
  if (options.agent) agents.set("poteto-agent", options.agent)
  const ctx = {
    tool: { async transform(apply: Function) { apply({ add() {} }) }, async hook(name: string, fn: Function) { hooks.set(`tool.${name}`, fn) } },
    skill: { async transform(apply: Function) { apply({
      get: (id: string) => skills.get(id),
      add: (skill: any) => skills.set(skill.id, skill),
      update: (id: string, update: Function) => update(skills.get(id)),
    }) } },
    agent: { async transform(apply: Function) { apply({
      remove: (id: string) => agents.delete(id),
      default: (id: string) => { defaultAgent = id },
      update(id: string, update: Function) {
        if (!agents.has(id)) agents.set(id, { id, permissions: [], request: { body: {} } })
        update(agents.get(id))
      },
    }) } },
    command: { async transform(apply: Function) { apply({ add: (command: any) => commands.set(command.name, command) }) } },
    session: { async prompt(input: any) { prompts.push(input) }, async hook(name: string, fn: Function) { hooks.set(name, fn) } },
  }
  return { ctx, agents, skills, hooks, commands, prompts, defaultAgent: () => defaultAgent }
}

test("every installed skill is served with absolute references and a slash command", async () => {
  const h = harness()
  await plugin.setup(h.ctx as never)
  const dirs = readdirSync(join(profileRoot, "skills")).filter(name => statSync(join(profileRoot, "skills", name)).isDirectory())
  expect([...h.skills.keys()].sort()).toEqual(dirs.sort())
  for (const [name, skill] of h.skills) {
    expect(resolve(skill.path)).toBe(skill.path)
    expect(skill.content).not.toContain("OpenCode adapter")
    expect(skill.autoinvoke).toBe(parseMarkdown(skill.path).front.metadata?.["opencode/autoinvoke"] !== false)
    expect(h.commands.has(name)).toBe(true)
    expect(typeof h.commands.get(name).execute).toBe("function")
  }
  expect(h.defaultAgent()).toBe("pstack")
  expect(h.agents.get("poteto-agent").mode).toBe("subagent")
  expect(h.agents.get("comment-sicko").mode).toBe("subagent")
  expect(h.agents.get("pstack").mode).toBe("primary")
})

test("native model and permissions survive profile registration and repeated transforms", async () => {
  const model = { providerID: "test", id: "reviewer" }
  const permissions = [{ action: "edit", resource: "*", effect: "deny" }]
  const h = harness({ agent: { model, permissions } })
  await plugin.setup(h.ctx as never)
  await plugin.setup(h.ctx as never)
  expect(h.agents.get("poteto-agent").model).toEqual(model)
  expect(h.agents.get("poteto-agent").permissions).toEqual(permissions)
})

test("foreign same-name skills and agents fail visibly", async () => {
  const h = harness({ skill: { id: "poteto-mode", path: import.meta.filename } })
  await expect(plugin.setup(h.ctx as never)).rejects.toThrow("conflicting skill")
  const other = harness({ agent: { system: "unrelated instructions" } })
  await expect(plugin.setup(other.ctx as never)).rejects.toThrow("conflicting agent")
})

test("malformed installed skills cannot be silently skipped", () => {
  const root = mkdtempSync(join(tmpdir(), "pstack-catalog-"))
  try {
    mkdirSync(join(root, "skills/broken"), { recursive: true })
    writeFileSync(join(root, "skills/broken/SKILL.md"), "---\nname: wrong\ndescription: Test\n---\nBody")
    expect(() => loadSkills(root)).toThrow("name must match")
    writeFileSync(join(root, "skills/broken/SKILL.md"), "No frontmatter")
    expect(() => loadSkills(root)).toThrow("missing YAML")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("native skills need no adapter injection and compaction preserves opt-out", async () => {
  const h = harness()
  await plugin.setup(h.ctx as never)
  expect(h.hooks.has("context")).toBe(false)
  const compaction = { system: [] as any[] }
  h.hooks.get("compaction")!(compaction)
  expect(compaction.system[0].text).toContain("explicit opt-out")
  expect(compaction.system[0].text).toContain("exact reviewed PR heads")
})

test("pinned upstream inventory includes every skill and its supporting files", () => {
  const manifest = JSON.parse(readFileSync(join(profileRoot, "upstream.json"), "utf8"))
  for (const [path, value] of Object.entries(manifest.files) as [string, { sha256: string }][]) {
    expect(createHash("sha256").update(readFileSync(join(profileRoot, path))).digest("hex")).toBe(value.sha256)
  }
  for (const skill of loadSkills()) expect(manifest.files[`skills/${skill.name}/SKILL.md`]).toBeDefined()
  const upstreamSkills = Object.keys(manifest.files).filter(path => /^skills\/[^/]+\/SKILL\.md$/.test(path))
  expect(loadSkills().map(skill => `skills/${skill.name}/SKILL.md`).sort()).toEqual(upstreamSkills.sort())
})


test("native commands preserve literal input and attachments without template evaluation", async () => {
  const h = harness()
  await plugin.setup(h.ctx as never)
  const prompt = { text: '조사만 !`printf sentinel` $ARGUMENTS $(not-a-command)', files: [{ uri: 'file:///fixture', mention: { start: 0, end: 3, text: '조사만' } }] }
  await h.commands.get("setup-pstack").execute({ sessionID: "ses_fixture", prompt, delivery: "queue" })
  expect(h.prompts).toHaveLength(1)
  expect(h.prompts[0].text.startsWith(prompt.text + "\n\n")).toBe(true)
  expect(h.prompts[0].files).toEqual(prompt.files)
  expect(h.prompts[0].delivery).toBe("queue")
  expect(h.prompts[0].text).toContain('skill({id: "setup-pstack"})')
})

test("profile prefers its native skill over a project's pinned upstream copy without changing that file", async () => {
  const root = mkdtempSync(join(tmpdir(), "pstack-project-"))
  try {
    const path = join(root, ".agents/skills/how/SKILL.md")
    mkdirSync(join(root, ".agents/skills/how"), { recursive: true })
    mkdirSync(join(root, ".agents/pstack"), { recursive: true })
    writeFileSync(path, "pinned original")
    writeFileSync(join(root, ".agents/pstack/manifest.json"), JSON.stringify({ repository: "https://github.com/cursor/plugins", enabled_skills: ["how"], files: { ".agents/skills/how/SKILL.md": { source: "pstack/skills/how/SKILL.md" } } }))
    const h = harness({ skill: { id: "how", path, content: "pinned original" } })
    await plugin.setup(h.ctx as never)
    expect(h.skills.get("how").path).toBe(join(profileRoot, "skills/how/SKILL.md"))
    expect(readFileSync(path, "utf8")).toBe("pinned original")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
