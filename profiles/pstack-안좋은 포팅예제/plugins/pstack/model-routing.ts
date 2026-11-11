import { readFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { ROLE_DEFINITIONS, BUDGETS, parseConfig, parseRoute, resolveRole, roleDefinition, refString, type Config, type Model, type ModelRef, type Role, type Difficulty, selectModel, isAlias } from "./roles"

type Context = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]
const data = (value: any) => Array.isArray(value) ? value : value?.data ?? value
export function readModelConfig(path: string): { config?: Config; revision: string | null } {
  if (!existsSync(path)) return { revision: null }
  const text = readFileSync(path, "utf8")
  return { config: parseConfig(JSON.parse(text)), revision: createHash("sha256").update(text).digest("hex") }
}
export async function setupModelRouting(ctx: Context, profileRoot: string) {
  const path = join(process.env.OPENCODE_CONFIG_DIR || profileRoot, "pstack-models.json")
  const rejectedKey = (sessionID: string) => `models/rejected/${sessionID}`
  async function catalog(): Promise<Model[]> { return data(await ctx.model.list()) }
  async function parent(sessionID: string): Promise<ModelRef> {
    const current = data(await ctx.session.get({ sessionID } as never))
    if (!current?.model) throw new Error("pstack models: parent session has no selected model")
    return current.model
  }
  async function base(role: Role, agentID: string = roleDefinition(role)[2]): Promise<ModelRef | undefined> {
    return data(await ctx.agent.get({ agentID } as never))?.model
  }
  async function resolve(sessionID: string, role: Role, difficulty: Difficulty = "standard", urgent = false, config = readModelConfig(path).config, agentID?: string) {
    const blocked = new Set<string>((await ctx.storage.get(rejectedKey(sessionID))) as string[] | undefined ?? [])
    const result = resolveRole(config, role, await catalog(), await parent(sessionID), await base(role, agentID), difficulty, urgent, blocked)
    if (agentID) for (const call of result.calls) call.agent = agentID
    return result
  }
  await ctx.tool.transform(editor => editor.add({
    name: "pstack_models",
    description: "Inspect/validate pstack's 17 user-configured model roles and reasoning budget, or resolve a role/panel into native subagent calls. Read-only: does not save settings or spawn. Copy each descriptionPrefix into subagent.description; execution re-resolves and enforces its model. Panels return one call per configured entry, including duplicate and inherit-parent entries. The ordered cross-judge pool returns at most one eligible different-family judge.",
    options: { codemode: false },
    input: { type: "object", properties: {
      action: { type: "string", enum: ["inspect", "catalog", "resolve", "validate"] },
      role: { type: "string", enum: ROLE_DEFINITIONS.map(r => r[0]) },
      difficulty: { type: "string", enum: ["standard", "routine", "judgment", "hardest"] },
      agent: { type: "string", description: "Optional native agent override for specialized roles such as comment-sicko; native permissions and topology still apply." },
      urgent: { type: "boolean" }, query: { type: "string" },
      config: { type: "object", additionalProperties: true },
    }, required: ["action"], additionalProperties: false },
    output: { anyOf: [{ type: "object", additionalProperties: true }, { type: "array", items: { type: "object", additionalProperties: true } }] },
    async execute(input: any, context) {
      let output: any
      if (input.action === "catalog") {
        const models = await catalog()
        output = models.filter(m => !input.query || `${m.providerID}/${m.id}`.includes(input.query)).map(m => ({
          model: `${m.providerID}/${m.id}`, family: m.family,
          variants: (m.variants ?? []).map(v => ({ id: v.id, effort: v.settings?.reasoningEffort ?? v.body?.reasoningEffort })),
        }))
      } else if (input.action === "resolve") {
        if (!input.role) throw new Error("pstack models: resolve requires role")
        output = await resolve(context.sessionID, input.role, input.difficulty, input.urgent, readModelConfig(path).config, input.agent)
      } else {
        const saved = readModelConfig(path)
        const candidate = input.action === "validate" ? parseConfig(input.config) : saved.config
        const resolved = []
        for (const [role, label, agent, kind, upstreamFamilies] of ROLE_DEFINITIONS) {
          try { resolved.push({ role, label, agent, kind, upstreamFamilies, ...await resolve(context.sessionID, role, "standard", false, candidate) }) }
          catch (error) { resolved.push({ role, label, error: (error as Error).message }) }
        }
        const errors: string[] = []
        if (input.action === "validate" && candidate) {
          const models = await catalog()
          for (const [role, choice] of Object.entries(candidate.roles)) for (const value of Array.isArray(choice) ? choice : [choice]) {
            if (isAlias(value)) continue
            try { selectModel(value, models, candidate.budget, "standard", false, role === "swarm-workers") }
            catch (error) { errors.push(`${role}: ${(error as Error).message}`) }
          }
        }
        output = { path, revision: saved.revision, configured: !!candidate, budget: candidate?.budget ?? null,
          budgets: BUDGETS, config: candidate ?? null, roles: resolved,
          valid: errors.length === 0 && resolved.every(r => !("error" in r)), errors,
          note: candidate ? "Saved role choices authorize their model overrides; aliases inherit the exact parent model, not the base agent's fixed model." : "No role table saved. Current agent models are preserved; panels show two existing-model seats and cross-judge is unavailable until configured. Setup must show and confirm all 17 entries before saving." }
      }
      return { output, content: JSON.stringify(output) }
    },
  }))
  await ctx.tool.hook("execute.before", async event => {
    if (event.tool !== "subagent") return
    const input = event.input as any
    const route = parseRoute(input?.description)
    if (!route) return
    if (input.sessionID) {
      const child = data(await ctx.session.get({ sessionID: input.sessionID } as never))
      if (child.parentID !== event.sessionID || child.agent !== input.agent || !child.model)
        throw new Error("pstack models: follow-up must use this parent's existing child and agent")
      // A settings edit applies to new children, not an in-flight review's identity.
      input.model = refString(child.model)
      return
    }
    const plan = await resolve(event.sessionID, route.role, route.difficulty, route.urgent, readModelConfig(path).config, input.agent)
    const call = plan.calls.find(c => c.seat === route.seat)
    if (!call) throw new Error(`pstack models: seat ${route.seat} unavailable; ${plan.skipped.join("; ")}`)
    input.model = call.model
  })
  await ctx.tool.hook("execute.after", async event => {
    if (event.tool !== "subagent" || event.status !== "error") return
    const input = event.input as any
    if (!parseRoute(input?.description) || typeof input.model !== "string") return
    // Only explicit model-resolution failures count; task failures do not reject a model.
    if (!/model.{0,40}(?:unavailable|not found|not valid|invalid)|(?:unavailable|invalid|unknown).{0,25}model/i.test(String((event.error as any)?.message ?? event.error))) return
    const set = new Set<string>((await ctx.storage.get(rejectedKey(event.sessionID))) as string[] | undefined ?? [])
    set.add(input.model)
    await ctx.storage.set(rejectedKey(event.sessionID), [...set])
  })
}
