import assert from "node:assert/strict"
import plugin from "./index"

const agents = new Map<string, any>()
const hooks = new Map<string, Function>()
let defaultAgent: string | undefined
const ctx = {
  agent: {
    async transform(apply: Function) {
      const editor = {
        default(id: string) { defaultAgent = id },
        update(id: string, change: Function) {
          if (!agents.has(id)) agents.set(id, { permissions: [], request: { body: {} } })
          change(agents.get(id))
        },
      }
      apply(editor)
      apply(editor) // Replay must not accumulate duplicate rules.
    },
  },
  session: { async hook(name: string, callback: Function) { hooks.set(`session.${name}`, callback) } },
  tool: { async hook(name: string, callback: Function) { hooks.set(`tool.${name}`, callback) } },
}

await plugin.setup(ctx as never)
assert.equal(defaultAgent, "worker")
assert.deepEqual([...agents.keys()], ["worker", "runner"])
assert.equal(agents.get("worker").mode, "primary")
assert.equal(agents.get("runner").mode, "subagent")
assert.equal(agents.get("runner").hidden, false)
assert.match(agents.get("runner").system, /You are Runner/)
for (const agent of agents.values()) {
  assert.deepEqual(agent.model, { providerID: "opencode-go", id: "muse-spark-1.3-contributor" })
  assert.deepEqual(agent.permissions.length, new Set(agent.permissions.map((rule: object) => JSON.stringify(rule))).size)
}

const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.split(/([*?])/).map((part) => part === "*" ? ".*" : part === "?" ? "." : part.replace(/[\\^$+.()|\[\]{}]/g, "\\$&")).join("")}$`).test(value)
function effect(agent: string, action: string, resource: string) {
  return agents.get(agent).permissions.reduce((result: string, rule: { action: string; resource: string; effect: string }) =>
    matches(rule.action, action) && matches(rule.resource, resource) ? rule.effect : result, "ask")
}
for (const child of ["worker", "terraworker", "general"]) assert.equal(effect("worker", "subagent", child), "deny")
assert.equal(effect("worker", "subagent", "runner"), "allow")
for (const child of ["worker", "runner"]) assert.equal(effect("runner", "subagent", child), "deny")
assert.equal(effect("worker", "edit", "src/file.ts"), "allow")
assert.equal(effect("runner", "edit", "src/file.ts"), "deny")
assert.equal(effect("runner", "read", ".env"), "deny")
assert.equal(effect("runner", "read", ".env.example"), "allow")
assert.equal(effect("runner", "read", "config/credentials.json"), "deny")
for (const command of ["git status --short", "bun test test/unit.test.ts"]) assert.equal(effect("runner", "shell", command), "allow")
for (const command of ["git commit -m result", "gh pr merge 96", "npm publish", "orca status --json"]) assert.equal(effect("runner", "shell", command), "deny")
for (const command of ["rm -rf build", "git reset --hard HEAD~1", "git push --force origin HEAD", "sudo rm file"]) assert.equal(effect("worker", "shell", command), "deny")

const before = hooks.get("tool.execute.before")!
await before({ tool: "subagent", agent: "worker", input: { agent: "runner", prompt: "Inspect." } })
for (const [parent, child] of [["worker", "worker"], ["worker", "general"], ["runner", "runner"], ["runner", "worker"], ["runner", "general"]]) {
  assert.throws(() => before({ tool: "subagent", agent: parent, input: { agent: child } }), /oc-lite topology blocks/)
}
assert.throws(() => before({ tool: "subagent", agent: "worker", input: { subagent_type: "runner" } }), /oc-lite topology blocks/)
await before({ tool: "read", agent: "runner", input: {} })
const context = hooks.get("session.context")!
const request = { agent: "runner", options: {} as Record<string, unknown> }
await context(request)
assert.deepEqual(request.options, { reasoningEffort: "medium", textVerbosity: "low" })
agents.set("worker", { permissions: [], system: "Another user's worker", request: { body: {} } })
await assert.rejects(plugin.setup(ctx as never), /refuses conflicting worker agent instructions/)
agents.set("worker", { permissions: [{ action: "shell", resource: "rm -rf *", effect: "ask" }], request: { body: {} } })
await assert.rejects(plugin.setup(ctx as never), /refuses pre-existing worker permission/)
agents.delete("worker")
agents.set("runner", { permissions: [{ action: "read", resource: "*.env", effect: "allow" }], request: { body: {} } })
await assert.rejects(plugin.setup(ctx as never), /refuses pre-existing runner permission/)
agents.set("runner", { permissions: [{ action: "external_directory", resource: "/home/user/.ssh/*", effect: "allow" }], request: { body: {} } })
await assert.rejects(plugin.setup(ctx as never), /refuses pre-existing runner permission/)
console.log("oc-lite-v2-smoke-ok: 2 agents, permission matrix, hook allow/deny, replay")
