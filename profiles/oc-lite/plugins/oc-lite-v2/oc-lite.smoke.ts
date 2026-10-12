import assert from "node:assert/strict"
import plugin, { agentModel } from "./index"
import { checkRunnerPolicy } from "../../../runner-policy.check"

const agents = new Map<string, any>()
agents.set("worker", { permissions: [], request: { body: {} }, model: { providerID: "legacy", id: "old-override" } })
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
assert.equal(agents.get("worker").model, undefined)
assert.deepEqual(agents.get("worker").request.body, {})
assert.deepEqual(agents.get("runner").model, { providerID: "openai", id: "gpt-6-luna" })
assert.deepEqual(agents.get("runner").request.body, { reasoningEffort: "high", textVerbosity: "low" })
assert.equal(agentModel(undefined, "worker"), undefined)
assert.deepEqual(agentModel("openai/gpt-6-sol#high", "worker"), { providerID: "openai", id: "gpt-6-sol", variant: "high" })
assert.deepEqual(agentModel("openrouter/anthropic/claude-sonnet-4.5#high", "worker"), { providerID: "openrouter", id: "anthropic/claude-sonnet-4.5", variant: "high" })
for (const bad of [null, "", "gpt-6-luna", "openai/", "/gpt-6-luna", "openai/a##high", "openai/a#", 42]) {
  assert.throws(() => agentModel(bad, "runner"), /oc-lite agent runner has invalid model/)
}
for (const agent of agents.values()) {
  assert.deepEqual(agent.permissions.length, new Set(agent.permissions.map((rule: object) => JSON.stringify(rule))).size)
}

const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.split(/([*?])/).map((part) => part === "*" ? "[\\s\\S]*" : part === "?" ? "[\\s\\S]" : part.replace(/[\\^$+.()|\[\]{}]/g, "\\$&")).join("")}$`).test(value)
function effect(agent: string, action: string, resource: string) {
  return agents.get(agent).permissions.reduce((result: string, rule: { action: string; resource: string; effect: string }) =>
    matches(rule.action, action) && (matches(rule.resource, resource) ||
      (action === "shell" && rule.resource.endsWith(" *") && resource === rule.resource.slice(0, -2))) ? rule.effect : result, "ask")
}
for (const child of ["worker", "terraworker", "general"]) assert.equal(effect("worker", "subagent", child), "deny")
assert.equal(effect("worker", "subagent", "runner"), "allow")
for (const child of ["worker", "runner"]) assert.equal(effect("runner", "subagent", child), "deny")
assert.equal(effect("worker", "edit", "src/file.ts"), "allow")
assert.equal(effect("runner", "edit", "src/file.ts"), "deny")
assert.equal(effect("runner", "read", ".env"), "deny")
assert.equal(effect("runner", "read", ".env.example"), "allow")
assert.equal(effect("runner", "read", "config/credentials.json"), "deny")
for (const name of ["opencodegoapikey.md", "cloudflarekey.md"]) {
  assert.equal(effect("runner", "read", `docs/${name}`), "deny")
  assert.equal(effect("runner", "read", `/Users/ck/Documents/freefy/docs/${name}`), "deny")
  assert.equal(effect("runner", "shell", `cat docs/${name}`), "deny")
}
assert.equal(effect("runner", "external_directory", "/Users/ck/Documents/freefy/*"), "allow")
assert.equal(effect("runner", "external_directory", "~/.ssh/id_ed25519"), "deny")
for (const command of ["git status --short", "bun test test/unit.test.ts"]) assert.equal(effect("runner", "shell", command), "allow")
// These are candidate shell resources checked against the loaded rules, not a
// simulation of scanner parsing or of subprocess exit statuses. The exact
// Python heredoc and any scanner rejection must be checked separately.
for (const command of [
  "cd /Users/ck/Documents/freefy",
  "npm run build:runtime",
  "cd /Users/ck/Documents/freefy && npm run build:runtime",
  "npm run test:sqlite-start",
  "npm run test:sqlite-gap-resume",
  "npm run test:trace-gap",
  "python3 -c 'from pathlib import Path; print(\"secret\" in Path(\"package.json\").read_text())'",
  "git check-ignore -v docs/opencodegoapikey.md docs/cloudflarekey.md",
  "git ls-files --error-unmatch docs/opencodegoapikey.md docs/cloudflarekey.md",
  "git ls-files --error-unmatch docs/opencodegoapikey.md",
  "git ls-files --error-unmatch docs/cloudflarekey.md",
]) assert.equal(effect("runner", "shell", command), "allow", `Runner freefy verification: ${command}`)
for (const command of [
  `node -e 'Promise.all(["health","status"].map(async p => { const d = await (await fetch("http://localhost:5129/api/" + p)).json(); console.log(p, d.status); }))'`,
  "find Runtime/dist/saves-node/images -type f -print", "sort", "head -30", "cd /Users/example/game",
  "curl -fsS http://localhost:5129/api/status", "jq '{status}'",
  "find docs/archive docs/archieve -type f -print0",
  "xargs -0 grep -Il '^version https://git-lfs.github.com/spec/v1$'",
  "find docs/archive docs/archieve -type f -print0 | xargs -0 grep -Il '^version https://git-lfs.github.com/spec/v1$'",
  String.raw`git config --local --name-only --get-regexp '^(lfs|filter\.lfs|remote\..*\.lfs)'`,
]) assert.equal(effect("runner", "shell", command), "allow", `Runner diagnostic: ${command}`)
for (const command of ["git commit -m result", "gh pr merge 96", "npm publish", "orca status --json"]) assert.equal(effect("runner", "shell", command), "deny")
for (const command of ["git add package.json", "git push origin main", "apply_patch change.patch", "cat config/secret.txt"]) {
  assert.equal(effect("runner", "shell", command), "deny", `Runner mutation/secret-content: ${command}`)
}
for (const command of ["rm -rf build", "git reset --hard HEAD~1", "git push --force origin HEAD", "sudo rm file"]) assert.equal(effect("worker", "shell", command), "deny")

const before = hooks.get("tool.execute.before")!
await checkRunnerPolicy((action, resource) => effect("runner", action, resource), (command, tool) =>
  before({ tool, agent: "runner", input: { command } }))
await before({ tool: "subagent", agent: "worker", input: { agent: "runner", prompt: "Inspect." } })
for (const [parent, child] of [["worker", "worker"], ["worker", "general"], ["runner", "runner"], ["runner", "worker"], ["runner", "general"]]) {
  assert.throws(() => before({ tool: "subagent", agent: parent, input: { agent: child } }), /oc-lite topology blocks/)
}
assert.throws(() => before({ tool: "subagent", agent: "worker", input: { subagent_type: "runner" } }), /oc-lite topology blocks/)
await before({ tool: "read", agent: "runner", input: {} })
const context = hooks.get("session.context")!
const request = { agent: "runner", options: {} as Record<string, unknown> }
await context(request)
assert.deepEqual(request.options, agents.get("runner").request.body)
for (const options of [{}, { reasoningEffort: "medium", textVerbosity: "high" }]) {
  const worker = { agent: "worker", model: { providerID: "openai", id: "gpt-6-sol", variant: "high" }, options }
  const original = structuredClone(worker)
  await context(worker)
  assert.deepEqual(worker, original, "Worker's selected model, variant and request options must remain untouched")
}
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
