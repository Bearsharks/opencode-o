import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Model, Plugin } from "@opencode/plugin"
import YAML from "yaml"

const names = ["worker", "runner"] as const
const profileDirectory = fileURLToPath(new URL("../../", import.meta.url))
const basePermissions = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "external_directory", resource: "*", effect: "ask" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
  { action: "harness_state", resource: "*", effect: "deny" },
  { action: "investigate", resource: "*", effect: "deny" },
]

function sameRule(a: { action: string; resource: string; effect: string }, b: typeof a) {
  return a.action === b.action && a.resource === b.resource && a.effect === b.effect
}

export function agentModel(value: unknown, name: string) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !/^[^/#\s]+\/[^#\s]+(?:#[^/#\s]+)?$/.test(value))
    throw new Error(`oc-lite agent ${name} has invalid model; expected provider/model[#variant]`)
  try {
    return Model.Ref.parse(value)
  } catch (cause) {
    throw new Error(`oc-lite agent ${name} has invalid model ${value}`, { cause })
  }
}

export default Plugin.define({
  id: "oc-lite-topology",
  async setup(ctx) {
    // OPENCODE_CONFIG_DIR loads config, not agents/ Markdown from that directory.
    const definitions = await Promise.all(
      names.map(async (name) => {
        const markdown = await readFile(
          new URL(`../../agents/${name}.md`, import.meta.url),
          "utf8",
        )
        const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
        if (!match) throw new Error(`oc-lite agent ${name} needs YAML frontmatter`)
        const front = YAML.parse(match[1])
        if (!front || !Array.isArray(front.permissions))
          throw new Error(`oc-lite agent ${name} needs native V2 permissions`)
        return { name, front, model: agentModel(front.model, name), system: markdown.slice(match[0].length).trim() }
      }),
    )

    await ctx.agent.transform((editor) => {
      editor.default("worker")
      for (const { name, front, model, system } of definitions) {
        editor.update(name, (agent) => {
          if (agent.system && agent.system !== system)
            throw new Error(`oc-lite refuses conflicting ${name} agent instructions`)
          for (const rule of agent.permissions) {
            // Core adds absolute allowances for its output, temporary, and
            // config directories. Do not silently accept arbitrary additional
            // external-directory grants from another profile.
            const managedDirectory = rule.action === "external_directory" &&
              rule.effect === "allow" &&
              (rule.resource.includes("/opencode/") || rule.resource.startsWith(profileDirectory))
            if (!managedDirectory && ![...basePermissions, ...front.permissions].some((expected) => sameRule(rule, expected)))
              throw new Error(`oc-lite refuses pre-existing ${name} permission: ${rule.action}:${rule.resource}:${rule.effect}`)
          }
          agent.system = system
          agent.description = front.description
          agent.mode = front.mode
          agent.hidden = front.hidden === true
          // A primary without a model follows the session/UI selection. Do not
          // leave an earlier transform's override on this agent.
          if (model === undefined) delete agent.model
          else agent.model = model
          for (const rule of front.permissions) {
            if (
              !agent.permissions.some((existing) => sameRule(existing, rule))
            )
              agent.permissions.push(rule)
          }
          agent.request.body = { ...agent.request.body, ...front.request?.body }
        })
      }
    })

    // Agent request.body is retained but not yet sent by the V2 runner.
    // Only Runner has a request preference; Worker keeps the selected model's
    // own defaults and variant rather than imposing a reasoning effort.
    const runnerRequest = definitions.find((definition) => definition.name === "runner")!.front.request?.body
    await ctx.session.hook("context", (event) => {
      if (event.agent === "runner") {
        if (runnerRequest?.reasoningEffort !== undefined) event.options.reasoningEffort = runnerRequest.reasoningEffort
        if (runnerRequest?.textVerbosity !== undefined) event.options.textVerbosity = runnerRequest.textVerbosity
      }
    })

    // The V2 subagent tool passes `agent`, not V1 `subagent_type`. Guard the
    // operation even if a client bypasses the model-facing permission catalog.
    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "subagent") return
      const child = (event.input as { agent?: unknown } | null)?.agent
      if (event.agent === "worker" && child === "runner") return
      throw new Error(`oc-lite topology blocks ${event.agent} -> ${String(child)}`)
    })
  },
})
