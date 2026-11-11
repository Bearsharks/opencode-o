import { readFileSync, readdirSync, realpathSync, existsSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin, type Skill } from "@opencode/plugin"
import YAML from "yaml"
import { setupModelRouting } from "./model-routing"

export const profileRoot = fileURLToPath(new URL("../../", import.meta.url))

export function parseMarkdown(path: string) {
  const text = readFileSync(path, "utf8")
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) throw new Error(`pstack: missing YAML frontmatter in ${path}`)
  const front = YAML.parse(match[1])
  const content = text.slice(match[0].length).trim()
  if (!front || typeof front.description !== "string" || !front.description.trim() || !content)
    throw new Error(`pstack: missing description or body in ${path}`)
  return { front, content }
}

export function loadSkills(root = profileRoot): Skill.Info[] {
  return readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => {
      const path = join(root, "skills", entry.name, "SKILL.md")
      const { front, content } = parseMarkdown(path)
      if (front.name !== entry.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(front.name) || front.name.length > 64)
        throw new Error(`pstack: skill name must match directory: ${path}`)
      return { id: front.name, name: front.name, description: front.description, path, content, autoinvoke: front.metadata?.["opencode/autoinvoke"] !== false } as Skill.Info
    })
}

function isPinnedUpstreamSkill(skill: { id: string; path: string }) {
  const manifestPath = join(dirname(skill.path), "../../pstack/manifest.json")
  if (!existsSync(manifestPath)) return false
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const project = join(dirname(manifestPath), "../..")
  const entry = manifest.files?.[relative(project, skill.path)]
  return manifest.repository === "https://github.com/cursor/plugins" &&
    manifest.enabled_skills?.includes(skill.id) && entry?.source === `pstack/skills/${skill.id}/SKILL.md`
}

export default Plugin.define({
  id: "opencode-o-pstack",
  async setup(ctx) {
    await setupModelRouting(ctx, profileRoot)
    const skills = loadSkills()
    const definitions = ["pstack", "poteto-agent", "comment-sicko"].map(name => ({
      name, ...parseMarkdown(join(profileRoot, "agents", `${name}.md`)),
    }))
    await ctx.skill.transform(editor => {
      for (const skill of skills) {
        const existing = editor.get(skill.id)
        if (existing && realpathSync(existing.path) !== realpathSync(skill.path) && !isPinnedUpstreamSkill(existing))
          throw new Error(`pstack: conflicting skill ${skill.id} at ${existing.path}`)
        if (existing) editor.update(skill.id, value => Object.assign(value, skill))
        else editor.add(skill)
      }
    })
    await ctx.agent.transform(editor => {
      editor.default("pstack")
      for (const { name, front, content } of definitions) {
        if (front.mode !== (name === "pstack" ? "primary" : "subagent"))
          throw new Error(`pstack: invalid agent mode for ${name}`)
        editor.update(name, agent => {
          const system = content
          if (agent.system && agent.system !== system)
            throw new Error(`pstack: conflicting agent instructions for ${name}`)
          agent.description = front.description
          agent.mode = front.mode
          agent.system = system
          // Native agents.<name>.model and permission settings remain user-owned.
        })
      }
    })
    await ctx.command.transform(editor => {
      for (const skill of skills) editor.add({
        name: skill.id,
        description: skill.description,
        async execute(input) {
          await ctx.session.prompt({
            ...input.prompt,
            sessionID: input.sessionID,
            text: input.prompt.text + `\n\nLoad the ${skill.id} skill with skill({id: "${skill.id}"}), then follow it for the request above. Preserve the user's scope and authorization.`,
            delivery: input.delivery,
          })
        },
      })
    })
    await ctx.session.hook("compaction", event => {
      event.system.push({ type: "text", text: "Preserve the user's scope and corrections, the active pstack skill/playbook (or explicit opt-out), child session IDs, worktree paths, exact reviewed PR heads, verification evidence and next action. On resume reload the active skill using the skill tool. Do not restart finished work or revive an opted-out workflow." })
    })
  },
})
