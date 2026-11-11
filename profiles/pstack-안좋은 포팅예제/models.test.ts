import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROLE_DEFINITIONS, parseConfig, resolveRole, parseRoute, selectModel, type Config, type Model } from "./plugins/pstack/roles"
import { setupModelRouting } from "./plugins/pstack/model-routing"

const variants = ["low", "medium", "high", "xhigh", "max"].map(id => ({ id, settings: { reasoningEffort: id } }))
const catalog: Model[] = [
  { providerID: "test", id: "parent", family: "gpt", variants },
  { providerID: "test", id: "code", family: "grok", variants: variants.slice(0, 4) },
  { providerID: "test", id: "code-fast", family: "grok", variants: variants.slice(0, 4) },
  { providerID: "test", id: "judge", family: "claude", variants },
]
const parent = { providerID: "test", id: "parent", variant: "high" }
function config(budget: Config["budget"] = "large"): Config {
  return parseConfig({ version: 1, budget, roles: Object.fromEntries(ROLE_DEFINITIONS.map(([id, , , kind]) => [id, kind === "single" ? "test/code#high" : ["test/code", "test/judge"]])) })
}

test("all 17 original role labels are represented and schema enforces scalars versus ordered panels", () => {
  expect(ROLE_DEFINITIONS).toHaveLength(17)
  expect(new Set(ROLE_DEFINITIONS.map(r => r[1])).size).toBe(17)
  const value = config()
  expect(() => parseConfig({ ...value, roles: { ...value.roles, unknown: "auto" } })).toThrow()
  expect(() => parseConfig({ ...value, roles: { ...value.roles, "arena-runners": "auto" } })).toThrow()
  expect(() => parseConfig({ ...value, roles: { ...value.roles, "how-explorer": ["auto"] } })).toThrow()
})

test("four budgets and per-task difficulty use advertised variants, with downward fallback", () => {
  for (const [budget, expected] of [["unlimited", "xhigh"], ["large", "xhigh"], ["medium", "high"], ["small", "medium"]] as const)
    expect(resolveRole(config(budget), "bug-fix", catalog, parent, undefined).calls[0].model).toBe(`test/code#${expected}`)
  expect(resolveRole(config(), "bug-fix", catalog, parent, undefined, "routine").calls[0].model).toBe("test/code#medium")
  expect(resolveRole(config(), "bug-fix", catalog, parent, undefined, "judgment").calls[0].model).toBe("test/code#high")
  const c = config(); c.roles["hardest-tasks"] = "test/judge"
  expect(resolveRole(c, "hardest-tasks", catalog, parent, undefined, "hardest").calls[0].model).toBe("test/judge#max")
})

test("urgency selects available fast sibling; verification keeps configured speed", () => {
  const c = config(); c.roles["swarm-workers"] = "test/code-fast"
  expect(resolveRole(c, "bug-fix", catalog, parent, undefined, "standard", true).calls[0].model).toBe("test/code-fast#xhigh")
  expect(resolveRole(c, "swarm-workers", catalog, parent, undefined).calls[0].model).toBe("test/code-fast#xhigh")
})

test("panel order, duplicates, one-seat panels and aliases retain exact counts and parent variants", () => {
  const c = config("unlimited"); c.roles["arena-runners"] = ["test/judge", "auto", "test/code", "inherit-parent", "test/judge"]
  const result = resolveRole(c, "arena-runners", catalog, parent, { providerID: "test", id: "code" })
  expect(result.calls.map(c => c.model)).toEqual(["test/judge#max", "test/parent#high", "test/code#xhigh", "test/parent#high", "test/judge#max"])
  expect(result.calls.map(c => c.seat)).toEqual([0, 1, 2, 3, 4])
  c.roles["architect-runners"] = ["inherit-parent"]
  expect(resolveRole(c, "architect-runners", catalog, parent, undefined).calls).toHaveLength(1)
})

test("ordered cross-judge pool excludes aliases and same-family seats and does not fake a judge", () => {
  const c = config(); c.roles["arena-cross-judge-pool"] = ["auto", "test/parent", "test/judge", "test/code"]
  const result = resolveRole(c, "arena-cross-judge-pool", catalog, parent, undefined)
  expect(result.calls).toHaveLength(1)
  expect(result.calls[0].seat).toBe(2)
  expect(result.calls[0].model).toBe("test/judge#xhigh")
  c.roles["arena-cross-judge-pool"] = ["auto", "test/parent"]
  expect(resolveRole(c, "arena-cross-judge-pool", catalog, parent, undefined).calls).toEqual([])
})

test("unconfigured roles preserve existing agent choices; explicit inheritance overrides them", () => {
  expect(resolveRole(undefined, "how-explorer", catalog, parent, { providerID: "test", id: "code", variant: "low" }).calls[0].model).toBe("test/code#low")
  const c = config(); c.roles["how-explorer"] = "inherit-parent"
  expect(resolveRole(c, "how-explorer", catalog, parent, { providerID: "test", id: "code" }).calls[0].model).toBe("test/parent#high")
})

test("rejected native references are not selected again; same-family fallback is disclosed", () => {
  const c = config()
  const result = resolveRole(c, "bug-fix", catalog, parent, undefined, "standard", false, new Set(["test/code#xhigh"]))
  expect(result.calls[0].model).toBe("test/code#high")
  expect(result.calls[0].notes.length).toBeGreaterThan(0)
  expect(() => selectModel("test/missing", catalog, "large", "standard", false, false)).toThrow()
})

test("execution hook reads latest saved roles, applies actual native model, preserves resume identity and rejects invalid seats", async () => {
  const root = mkdtempSync(join(tmpdir(), "pstack-models-"))
  const previous = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = root
  const hooks = new Map<string, Function>(), tools = new Map<string, any>(), storage = new Map()
  const sessions = new Map<string, any>([["parent", { model: parent }], ["child", { agent: "general", parentID: "parent", model: { providerID: "test", id: "code", variant: "low" } }]])
  const ctx = {
    tool: { transform: async (apply: Function) => apply({ add: (tool: any) => tools.set(tool.name, tool) }), hook: async (name: string, fn: Function) => { hooks.set(name, fn) } },
    model: { list: async () => ({ data: catalog }) }, session: { get: async ({ sessionID }: any) => sessions.get(sessionID) },
    agent: { get: async () => ({ data: { model: { providerID: "test", id: "code" } } }) },
    storage: { get: async (key: string) => storage.get(key), set: async (key: string, value: any) => storage.set(key, value) },
  }
  try {
    const c = config(); writeFileSync(join(root, "pstack-models.json"), JSON.stringify(c))
    await setupModelRouting(ctx as never, root)
    const plan = (await tools.get("pstack_models").execute({ action: "resolve", role: "how-explainer" }, { sessionID: "parent" })).output
    const event = { tool: "subagent", sessionID: "parent", input: { agent: "general", description: plan.calls[0].descriptionPrefix + " Explain", prompt: "scope", model: "test/wrong" } }
    c.roles["how-explainer"] = "test/judge"; writeFileSync(join(root, "pstack-models.json"), JSON.stringify(c))
    await hooks.get("execute.before")!(event)
    expect(event.input.model).toBe("test/judge#xhigh")
    const follow = { ...event, input: { ...event.input, sessionID: "child" } }
    await hooks.get("execute.before")!(follow)
    expect(follow.input.model).toBe("test/code#low")
    await expect(hooks.get("execute.before")!({ ...event, input: { ...event.input, description: "[pstack:how-explainer:9:standard:normal] bad" } })).rejects.toThrow("seat 9")
    await hooks.get("execute.after")!({ ...event, status: "error", error: new Error("model unavailable") })
    await setupModelRouting(ctx as never, root)
    await hooks.get("execute.before")!(event)
    expect(event.input.model).not.toBe("test/judge#xhigh")
    const specialized = (await tools.get("pstack_models").execute({ action: "resolve", role: "judgment-prose", agent: "comment-sicko" }, { sessionID: "parent" })).output.calls[0]
    const comment = { tool: "subagent", sessionID: "parent", input: { agent: specialized.agent, description: specialized.descriptionPrefix + " Review comments", prompt: "scoped comments" } }
    await hooks.get("execute.before")!(comment)
    expect(comment.input.agent).toBe("comment-sicko")
    expect((comment.input as any).model).toBe("test/code#xhigh")
    const invalid = config(); invalid.roles["arena-cross-judge-pool"] = ["test/missing"]
    const validation = (await tools.get("pstack_models").execute({ action: "validate", config: invalid }, { sessionID: "parent" })).output
    expect(validation.valid).toBe(false)
    expect(parseRoute("ordinary task")).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("restored role consumers cover every original role, with no fixed replacement panel", async () => {
  const { readFileSync } = await import("node:fs")
  const { profileRoot, loadSkills } = await import("./plugins/pstack")
  const paths = ["poteto-mode/SKILL.md", "how/SKILL.md", "why/SKILL.md", "reflect/SKILL.md", "arena/SKILL.md", "swarm/SKILL.md", "architect/SKILL.md", "interrogate/SKILL.md"]
  const consumer = paths.map(path => readFileSync(join(profileRoot, "skills", path), "utf8")).join("\n")
  for (const [role] of ROLE_DEFINITIONS) expect(consumer).toContain(role)
  expect(loadSkills().filter(skill => skill.autoinvoke === false)).toHaveLength(57)
  for (const [name, count] of [["session-pickup", 5], ["autonomous-run", 6]] as const) {
    const body = readFileSync(join(profileRoot, "skills/poteto-mode/playbooks", `${name}.md`), "utf8")
    expect([...body.matchAll(/^(\d+)\. /gm)].map(m => Number(m[1]))).toEqual(Array.from({ length: count }, (_, i) => i + 1))
  }
})
