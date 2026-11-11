export const ROLE_DEFINITIONS = [
  ["feature-refactoring", "feature, refactoring", "poteto-agent", "single", "grok"],
  ["bug-fix", "bug-fix", "poteto-agent", "single", "grok"],
  ["perf-issue", "perf-issue", "poteto-agent", "single", "grok"],
  ["hillclimb", "hillclimb", "poteto-agent", "single", "grok"],
  ["judgment-prose", "judgment and prose", "poteto-agent", "single", "claude"],
  ["hardest-tasks", "hardest tasks", "poteto-agent", "single", "claude"],
  ["how-explorer", "how explorer", "general", "single", "grok"],
  ["how-explainer", "how explainer", "general", "single", "claude"],
  ["why-investigators", "why investigators", "general", "single", "grok"],
  ["why-synthesizer", "why synthesizer", "general", "single", "claude"],
  ["reflect-tooling", "reflect tooling", "general", "single", "grok"],
  ["reflect-judgment-divergent-synthesizer", "reflect judgment, divergent, synthesizer", "general", "single", "claude"],
  ["arena-runners", "arena runners", "general", "panel", "claude,grok"],
  ["arena-cross-judge-pool", "arena cross-judge pool", "general", "pool", "claude,grok"],
  ["swarm-workers", "swarm workers", "general", "single", "grok"],
  ["architect-runners", "architect runners", "general", "panel", "claude,grok"],
  ["interrogate-reviewers", "interrogate reviewers", "general", "panel", "claude,grok"],
] as const
export type Role = typeof ROLE_DEFINITIONS[number][0]
export const BUDGETS = { unlimited: "max", large: "xhigh", medium: "high", small: "medium" } as const
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const
export type Difficulty = "standard" | "routine" | "judgment" | "hardest"
export type Config = { version: 1; budget: keyof typeof BUDGETS; roles: Record<Role, string | string[]>; families?: Record<string, string> }
export type Model = { providerID: string; id: string; family?: string; variants?: { id: string; settings?: Record<string, unknown>; body?: Record<string, unknown> }[] }
export type ModelRef = { providerID: string; id: string; variant?: string }
export const refString = (ref: ModelRef) => `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
export const isAlias = (value: string) => value === "auto" || value === "inherit-parent"
const reference = /^[^\s/#]+\/[^\s#]+(?:#[^\s#]+)?$/
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value)
function need(value: unknown, message: string): asserts value { if (!value) throw new Error(`pstack models: ${message}`) }
export function roleDefinition(id: string) {
  const role = ROLE_DEFINITIONS.find(row => row[0] === id)
  need(role, `unknown role ${id}`)
  return role
}
export function parseConfig(value: unknown): Config {
  need(record(value), "configuration must be an object")
  need(Object.keys(value).every(key => ["version", "budget", "roles", "families"].includes(key)), "unknown configuration field")
  need(value.version === 1 && Object.hasOwn(BUDGETS, value.budget), "version must be 1 and budget unlimited|large|medium|small")
  need(record(value.roles), "roles must be an object")
  need(Object.keys(value.roles).length === ROLE_DEFINITIONS.length, "provide all 17 roles")
  for (const [id, , , kind] of ROLE_DEFINITIONS) {
    const entry = value.roles[id]
    need(kind === "single" ? typeof entry === "string" : Array.isArray(entry) && entry.length > 0, `${id} requires ${kind === "single" ? "one model" : "a nonempty ordered model list"}`)
    for (const model of Array.isArray(entry) ? entry : [entry])
      need(typeof model === "string" && (isAlias(model) || reference.test(model)), `${id}: use provider/model[#variant], auto, or inherit-parent`)
  }
  if (value.families !== undefined) {
    need(record(value.families), "families must be an object")
    for (const [model, family] of Object.entries(value.families))
      need(reference.test(model) && !model.includes("#") && typeof family === "string" && /^[a-z0-9][a-z0-9.-]*$/.test(family), "families maps provider/model to a verified family name")
  }
  return value as Config
}
export function parseRef(value: string): ModelRef {
  need(reference.test(value), `invalid model reference ${value}`)
  const slash = value.indexOf("/"), [id, variant] = value.slice(slash + 1).split("#")
  return { providerID: value.slice(0, slash), id, ...(variant ? { variant } : {}) }
}
function findModel(value: string, catalog: Model[]) {
  const ref = parseRef(value)
  const model = catalog.find(m => m.providerID === ref.providerID && m.id === ref.id)
  need(model, `unavailable model ${ref.providerID}/${ref.id}`)
  if (ref.variant) need(model.variants?.some(v => v.id === ref.variant), `unavailable variant ${value}`)
  return { ref, model }
}
export function familyOf(ref: ModelRef, catalog: Model[], families: Record<string, string> = {}): string | undefined {
  const supplied = families[`${ref.providerID}/${ref.id}`]
  if (supplied) return supplied
  const model = catalog.find(m => m.providerID === ref.providerID && m.id === ref.id)
  const name = (model?.family || ref.id).toLowerCase()
  if (/(^|[/_-])claude/.test(name)) return "claude"
  if (/(^|[/_-])(?:grok|composer)/.test(name)) return "grok"
  if (/(^|[/_-])(?:gpt|o[134](?:-|$))/.test(name)) return "gpt"
  // Provider identity is not a model family (a proxy may serve many families).
  return model?.family?.toLowerCase()
}
function effortOf(variant: NonNullable<Model["variants"]>[number]) {
  const value = variant.settings?.reasoningEffort ?? variant.body?.reasoningEffort ?? variant.id
  return typeof value === "string" && EFFORTS.includes(value as any) ? EFFORTS.indexOf(value as any) : -1
}
export function selectModel(value: string, catalog: Model[], budget: Config["budget"] | undefined, difficulty: Difficulty, urgent: boolean, verification: boolean, excluded = new Set<string>()) {
  let { ref, model } = findModel(value, catalog)
  const notes: string[] = []
  // Only use advertised fast/standard siblings; never manufacture an ID.
  if (budget && !verification) {
    const id = urgent ? (ref.id.endsWith("-fast") ? ref.id : `${ref.id}-fast`) : ref.id.replace(/-fast$/, "")
    const sibling = catalog.find(m => m.providerID === ref.providerID && m.id === id)
    if (sibling && sibling.id !== model.id) { model = sibling; ref = { providerID: sibling.providerID, id: sibling.id }; notes.push(`speed: ${id}`) }
    else if (urgent && !sibling) notes.push("fast sibling unavailable; kept configured model")
  }
  if (!budget) { need(!excluded.has(refString(ref)), `model previously rejected: ${refString(ref)}`); return { model: refString(ref), notes } }
  const offset = { standard: 0, routine: -2, judgment: -1, hardest: 1 }[difficulty]
  const target = Math.max(0, Math.min(4, EFFORTS.indexOf(BUDGETS[budget]) + offset))
  const variants = (model.variants ?? []).map(v => ({ v, effort: effortOf(v) })).filter(x => x.effort >= 0)
  if (!variants.length) {
    notes.push("no advertised reasoning variants; budget not applicable")
    need(!excluded.has(refString(ref)), `model previously rejected: ${refString(ref)}`)
    return { model: refString(ref), notes }
  }
  const selected = variants.filter(v => v.effort <= target && !excluded.has(`${model.providerID}/${model.id}#${v.v.id}`)).sort((a, b) => b.effort - a.effort || Number(b.v.id === ref.variant) - Number(a.v.id === ref.variant))[0]
  need(selected, `${model.providerID}/${model.id} has no reasoning variant at or below ${EFFORTS[target]}; choose another model/budget`)
  if (selected.effort !== target) notes.push(`effort ${EFFORTS[target]} unavailable; using ${EFFORTS[selected.effort]}`)
  return { model: `${model.providerID}/${model.id}#${selected.v.id}`, notes }
}
export function prefix(role: Role, seat: number, difficulty: Difficulty, urgent: boolean) {
  return `[pstack:${role}:${seat}:${difficulty}:${urgent ? "urgent" : "normal"}]`
}
export function parseRoute(description: unknown) {
  if (typeof description !== "string" || !description.startsWith("[pstack:")) return undefined
  const match = description.match(/^\[pstack:([a-z-]+):(\d+):(standard|routine|judgment|hardest):(urgent|normal)\](?:\s|$)/)
  need(match, "invalid role routing prefix; copy the prefix returned by pstack_models")
  const role = roleDefinition(match[1])[0]
  return { role, seat: Number(match[2]), difficulty: match[3] as Difficulty, urgent: match[4] === "urgent" }
}
export type Resolution = { role: Role; kind: string; calls: { agent: string; model: string; descriptionPrefix: string; seat: number; notes: string[] }[]; skipped: string[] }
export function resolveRole(config: Config | undefined, role: Role, catalog: Model[], parent: ModelRef, base: ModelRef | undefined, difficulty: Difficulty = "standard", urgent = false, excluded = new Set<string>()): Resolution {
  const [, , agent, kind] = roleDefinition(role)
  const defaultModel = refString(base ?? parent)
  const defaultEntries = kind === "single" ? defaultModel : kind === "pool" ? [] : [defaultModel, defaultModel]
  const value = config?.roles[role] ?? defaultEntries
  const entries = Array.isArray(value) ? value : [value]
  const result: Resolution = { role, kind, calls: [], skipped: [] }
  const parentFamily = familyOf(parent, catalog, config?.families)
  if (kind === "pool" && !parentFamily) { result.skipped.push("parent model family unknown; cross-family judge not run"); return result }
  entries.forEach((choice, seat) => {
    if (kind === "pool" && (isAlias(choice) || result.calls.length)) return
    try {
      let selected: { model: string; notes: string[] }
      if (isAlias(choice)) {
        need(!excluded.has(refString(parent)), "parent model was rejected; cannot inherit it")
        selected = { model: refString(parent), notes: ["inherits exact parent model and variant; budget does not change aliases"] }
      } else {
        try { selected = selectModel(choice, catalog, config?.budget, difficulty, urgent, role === "swarm-workers", excluded) }
        catch (failure) {
          if (!config) throw failure
          const requested = parseRef(choice)
          const family = familyOf(requested, catalog, config.families)
          const candidates = family ? catalog.filter(m => familyOf(m, catalog, config.families) === family)
            .sort((a, b) => Number(b.id === requested.id) - Number(a.id === requested.id) || Number(b.providerID === requested.providerID) - Number(a.providerID === requested.providerID) || a.id.localeCompare(b.id)) : []
          let fallback: { model: string; notes: string[] } | undefined
          for (const model of candidates) {
            try { fallback = selectModel(`${model.providerID}/${model.id}`, catalog, config.budget, difficulty, urgent, role === "swarm-workers", excluded); break } catch { /* Try the next advertised same-family candidate. */ }
          }
          if (!fallback) {
            if (kind === "pool" || excluded.has(refString(parent))) throw failure
            findModel(refString(parent), catalog)
            fallback = { model: refString(parent), notes: ["same-family alternatives exhausted; inherited parent as the upstream final fallback"] }
          }
          selected = { model: fallback.model, notes: [`${choice} unavailable/rejected: ${(failure as Error).message}`, ...fallback.notes, `fallback: ${fallback.model}`] }
        }
      }
      // Explicit inheritance must override any fixed model on the native base agent.
      findModel(selected.model, catalog)
      if (kind === "pool") {
        const family = familyOf(parseRef(selected.model), catalog, config?.families)
        if (!family || family === parentFamily) { result.skipped.push(`seat ${seat}: family ${family ?? "unknown"} is not eligible`); return }
      }
      result.calls.push({ agent, model: selected.model, descriptionPrefix: prefix(role, seat, difficulty, urgent), seat, notes: selected.notes })
    } catch (error) {
      if (kind !== "pool") throw error
      result.skipped.push(`seat ${seat}: ${(error as Error).message}`)
    }
  })
  if (kind === "pool" && !result.calls.length) result.skipped.push("no eligible configured model in the ordered cross-judge pool; parent performs Phase D and reports missing cross-family review")
  return result
}
