import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "./index"

const previous = process.env.OPENCODE_O_A_MAX_MODEL_CONFIG
process.env.OPENCODE_O_A_MAX_MODEL_CONFIG = ""
const agents = new Map<string, any>()
const tools = new Map<string, any>()
const hooks = new Map<string, Function>()
const interrupted: string[] = []
const events: { event: any; handled: () => void }[] = []
let wake: (() => void) | undefined
async function emit(type: string, data: Record<string, unknown>) {
  let handled!: () => void
  const finished = new Promise<void>((resolve) => (handled = resolve))
  events.push({ event: { type, data }, handled })
  wake?.()
  await finished
}
async function* subscribe(signal: AbortSignal) {
  while (!signal.aborted) {
    if (!events.length)
      await new Promise<void>((resolve) => {
        wake = resolve
        signal.addEventListener("abort", resolve, { once: true })
      })
    wake = undefined
    const item = events.shift()
    if (!item) continue
    yield item.event
    // The consumer requests the next item only after handling this event.
    item.handled()
  }
}
let selectedModel: [string, string] | undefined
const context = {
  agent: {
    async transform(apply: Function) {
      apply({
        get: (id: string) => agents.get(id),
        update(id: string, modify: Function) {
          if (!agents.has(id))
            agents.set(id, {
              permissions: [],
              request: { body: {} },
              mode: "primary",
              hidden: false,
            })
          modify(agents.get(id))
        },
      })
    },
    async get({ agentID }: { agentID: string }) {
      return { data: agents.get(agentID) }
    },
  },
  model: {
    async transform(apply: Function) {
      apply({
        default: {
          set(provider: string, model: string) {
            selectedModel = [provider, model]
          },
        },
      })
    },
  },
  session: {
    async hook(_name: string, callback: Function) {
      hooks.set(`session.${_name}`, callback)
    },
    async interrupt({ sessionID }: { sessionID: string }) {
      interrupted.push(sessionID)
    },
    async get() {
      return { time: { updated: 1_000 } }
    },
    async context() {
      return []
    },
  },
  tool: {
    async transform(apply: Function) {
      apply({ add: (value: any) => tools.set(value.name, value) })
    },
    async hook(name: string, callback: Function) {
      hooks.set(`tool.${name}`, callback)
    },
  },
  event: { subscribe({ signal }: { signal: AbortSignal }) { return subscribe(signal) } },
}

try {
  const cleanup = await plugin.setup(context as never)
  const ht = agents.get("HTOrchestrator")
  const terra = agents.get("terraworker")
  const runner = agents.get("runner")
  assert.equal(ht.mode, "primary")
  assert.equal(terra.mode, "subagent")
  assert.equal(runner.mode, "subagent")
  assert.match(ht.system, /Own the user's goal/)
  assert.match(ht.system, /## A-Max asynchronous delegation/)
  assert.match(terra.system, /implementation worker/)
  for (const system of [ht.system, terra.system]) {
    assert.match(system, /accepted goal/)
    assert.match(system, /entrypoint/)
    assert.match(system, /restriction/)
    assert.match(system, /build outputs\/static assets/)
  }
  for (const heading of ["Changes", "Verification", "Unresolved", "Contract deviations", "Parent action"])
    assert.ok(terra.system.includes(heading), `Terra report missing ${heading}`)
  assert.match(ht.system, /Review, not Done/)
  const runnerSource = await readFile(new URL("../../agents/runner.md", import.meta.url), "utf8")
  assert.equal(runner.hidden, /^hidden:\s*true\s*$/m.test(runnerSource))
  assert.equal(
    runner.permissions.some(
      (rule: any) => rule.action === "edit" && rule.effect === "deny",
    ),
    true,
  )
  assert.equal(
    runner.permissions.some(
      (rule: any) => rule.action === "a_max_board" && rule.effect === "deny",
    ),
    true,
  )
  // The plugin's agent.transform above loads these real Markdown permissions.
  // Mirror V2's documented ordered, whole-value wildcard resolution, not a
  // grep for the presence of an allow rule (a later deny would override it).
  function permission(action: string, resource: string) {
    let result = "ask"
    for (const rule of runner.permissions) {
      if (rule.action !== action) continue
      const pattern = String(rule.resource)
      const expression = new RegExp("^" + pattern.split(/([*?])/).map((part: string) =>
        part === "*" ? ".*" : part === "?" ? "." :
          part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")).join("") + "$")
      if (expression.test(resource) ||
        (action === "shell" && pattern.endsWith(" *") && resource === pattern.slice(0, -2)))
        result = rule.effect
    }
    return result
  }
  const manyTests = `node --test ${Array.from({ length: 11 }, (_, index) =>
    `Runtime/dist/test/case-${index + 1}.test.js`).join(" ")}`
  const permitted = [
    "npm run check", "npm run docs:check", "npm run lint", "npm run build",
    "npm run build:runtime", "npm test", "npm run test:launcher",
    "npm run check:a-max", "npm run test:a-max",
    "npm --prefix Runtime run compile:core", "npm --prefix Runtime test",
    "bun run check:a-max",
    "node --test Tools/launcher.test.mjs",
    "node --test Runtime/dist/test/combat.test.js",
    "node --test Runtime/dist/test/ai/combat.test.js",
    "node --test Runtime/dist/test/combat.test.js Runtime/dist/test/inventory.test.js",
    "node --test Runtime/dist/test/a.test.js Runtime/dist/test/b.test.js Runtime/dist/test/c.test.js",
    manyTests,
    "node --test dist/test/combat.test.js",
    "node --test dist/test/ai/combat.test.js dist/test/ai/state/inventory.test.js",
    "node --test dist/test/combat.test.js dist/test/inventory.test.js",
    "node --test dist/test/a.test.js dist/test/b.test.js dist/test/c.test.js",
    "node --test Runtime/dist/test/a.test.js dist/test/b.test.js Runtime/dist/test/c.test.js",
    "node Runtime/scripts/check-boundary.mjs", "git status --short",
  ]
  const prohibited = [
    "npm install", "npm ci", "npm uninstall", "npm update", "npm publish",
    "npm exec tsc", "npx tsc", "npm run setup", "npm run play",
    "npm run image:generate", "npm run build -- --watch",
    "node -e 'console.log(1)'", "node --eval '1'", "node <<EOF",
    "node arbitrary.js", "bun run install", "bun run arbitrary", "python3 -c print(1)",
    "node --test Runtime/dist/test/a.test.js --import=./evil.mjs Runtime/dist/test/b.test.js",
    "node --test Runtime/dist/test/a.test.js -e 1 Runtime/dist/test/b.test.js",
    "node --test dist/test/a.test.js --require=./evil.js dist/test/b.test.js",
    "git add .", "git commit -m x", "git push", "git reset --hard",
    "git clean -fd", "kill -9 123", "launchctl restart service",
    "curl -fsS http://127.0.0.1:3000/health",
  ]
  for (const command of permitted)
    assert.equal(permission("shell", command), "allow", `runner shell: ${command}`)
  for (const command of prohibited)
    assert.equal(permission("shell", command), "deny", `runner shell: ${command}`)
  // For separately scanned shell resources, an approved check cannot make
  // the second prohibited resource authorized (scanner itself is not mocked).
  assert.equal(permission("shell", "npm run lint"), "allow")
  assert.equal(permission("shell", "npm install"), "deny")
  assert.equal(permission("edit", "src/feature.ts"), "deny")
  assert.equal(permission("subagent", "terraworker"), "deny")
  for (const heading of ["Findings", "Commands", "Uncertainty", "Contract deviations", "Parent action"])
    assert.ok(runner.system.includes(heading), `Runner report missing ${heading}`)
  assert.equal(
    ht.permissions.some(
      (rule: any) =>
        rule.action === "subagent" &&
        rule.resource === "terraworker" &&
        rule.effect === "allow",
    ),
    true,
  )
  assert.deepEqual([...tools.keys()].sort(), [
    "a_max_board",
    "a_max_inspect",
    "a_max_interrupt",
    "a_max_move",
  ])

  const before = hooks.get("tool.execute.before")!
  const after = hooks.get("tool.execute.after")!
  const runnerShell = (command: string, tool = "shell") => before({
    tool, agent: "runner", sessionID: "runner-session", id: "shell-call",
    input: { command },
  })
  for (const command of permitted.filter((item) => item.startsWith("node --test")))
    assert.doesNotThrow(() => runnerShell(command), `runner focused command: ${command}`)
  assert.doesNotThrow(() => runnerShell("node --test dist/test/combat.test.js", "bash"))
  for (const command of [
    "node --test",
    "node --test ",
    "node --test --import=./evil.mjs Runtime/dist/test/a.test.js",
    "node --test Runtime/dist/test/../../outside.test.js",
    "node --test dist/test/a.test.js --import=./evil.mjs dist/test/b.test.js",
    "node --test dist/test/a.test.js --require=./evil.js dist/test/b.test.js",
    "node --test dist/test/a.test.js -r ./evil.js dist/test/b.test.js",
    "node --test Runtime/dist/test/$(node -e '1').test.js",
    "node --test Runtime/dist/test/a.test.js && node -e '1'",
    "node --test Runtime/dist/test/a.test.js | cat",
    "node --test Runtime/dist/test/a.test.js; node -e '1'",
    "npm run lint; node --test Runtime/dist/test/a.test.js",
  ])
    for (const tool of ["shell", "bash"])
      assert.throws(() => runnerShell(command, tool), /literal compiled test paths/, `${tool}: ${command}`)
  assert.throws(
    () =>
      before({
        tool: "subagent",
        agent: "runner",
        sessionID: "parent",
        input: { agent: "terraworker" },
        id: "call-no",
      }),
    /topology blocks/,
  )
  assert.throws(
    () =>
      before({
        tool: "subagent",
        agent: "HTOrchestrator",
        sessionID: "parent",
        input: { agent: "runner", background: true },
        id: "call-runner",
      }),
    /foreground/,
  )
  before({
    tool: "subagent",
    agent: "HTOrchestrator",
    sessionID: "parent",
    input: {
      agent: "terraworker",
      background: true,
      description: "Implement scope",
      prompt: "Scope: src/feature.ts",
    },
    id: "call-terra",
  })
  after({
    tool: "subagent",
    agent: "HTOrchestrator",
    status: "completed",
    sessionID: "parent",
    id: "call-terra",
    input: { agent: "terraworker", background: true },
    result: {
      content: "Background sessionID: ses_test123",
      metadata: { sessionID: "ses_test123" },
    },
  })
  const parent = { agent: "HTOrchestrator", sessionID: "parent" }
  const board = await tools.get("a_max_board").execute({}, parent)
  assert.match(board.content, /ses_test123 \| Implement scope/)
  assert.match(board.content, /scope=src\/feature.ts/)
  await assert.rejects(
    tools
      .get("a_max_move")
      .execute({ session_id: "ses_test123", status: "done" }, parent),
    /still running/,
  )
  await emit("session.execution.succeeded", { sessionID: "ses_test123" })
  const inspection = await tools
    .get("a_max_inspect")
    .execute({ session_id: "ses_test123" }, parent)
  assert.match(inspection.content, /card_status=review/)
  await tools
    .get("a_max_move")
    .execute({ session_id: "ses_test123", status: "done" }, parent)
  const all = await tools
    .get("a_max_board")
    .execute({ include_done: true }, parent)
  assert.match(all.content, /## Done \(1\)/)
  await assert.rejects(
    tools.get("a_max_interrupt").execute({ session_id: "ses_test123" }, parent),
    /already Done/,
  )
  await assert.rejects(
    tools
      .get("a_max_board")
      .execute({}, { agent: "terraworker", sessionID: "parent" }),
    /only to HTOrchestrator/,
  )
  assert.deepEqual(interrupted, [])
  function dispatch(id: string, call: string, continuation = false) {
    const input = {
      agent: "terraworker",
      background: true,
      ...(continuation ? { sessionID: id } : {}),
      description: "68-test report",
    }
    before({ tool: "subagent", agent: "HTOrchestrator", sessionID: "parent", id: call, input })
    after({
      tool: "subagent", agent: "HTOrchestrator", status: "completed",
      sessionID: "parent", id: call, input,
      result: { content: `Background sessionID: ${id}`, metadata: { sessionID: id } },
    })
  }
  async function status(id: string, expected: string) {
    const result = await tools.get("a_max_board").execute({ include_done: true }, parent)
    const section = result.content.split(`## ${expected} (`)[1]?.split(/\n## /)[0]
    assert.ok(section, `Missing ${expected} section`)
    assert.ok(section.includes(`- ${id} |`), `${id} not in ${expected} section`)
  }
  const child = "ses_68tests"
  dispatch(child, "call-68")
  await assert.rejects(
    tools.get("a_max_move").execute({ session_id: child, status: "review" }, parent),
    /still running/,
  )
  await emit("session.execution.started", { sessionID: child })
  await emit("session.status", { sessionID: child, status: { type: "idle" } })
  await emit("session.idle", { sessionID: child })
  await status(child, "Working") // idle is not proof the execution succeeded
  await assert.rejects(
    tools.get("a_max_move").execute({ session_id: child, status: "review" }, parent),
    /still running/,
  )
  await emit("session.execution.succeeded", { sessionID: child })
  await status(child, "Review")
  await tools.get("a_max_move").execute({ session_id: child, status: "done", note: "Reviewed 68 tests" }, parent)
  await status(child, "Done")
  await emit("session.idle", { sessionID: child })
  await status(child, "Done")

  // A continued run reopens even an accepted card; execute.after must not
  // replace an early terminal event or resurrect a stale Done state.
  before({ tool: "subagent", agent: "HTOrchestrator", sessionID: "parent", id: "continue",
    input: { agent: "terraworker", background: true, sessionID: child } })
  await status(child, "Working")
  await assert.rejects(
    tools.get("a_max_move").execute({ session_id: child, status: "done" }, parent),
    /still running/,
  )
  await emit("session.execution.succeeded", { sessionID: child })
  after({ tool: "subagent", agent: "HTOrchestrator", status: "completed", sessionID: "parent",
    id: "continue", input: { agent: "terraworker", background: true, sessionID: child },
    result: { content: `Background sessionID: ${child}`, metadata: { sessionID: child } } })
  await status(child, "Review")

  // A new child can complete before its background tool result registers a card.
  const earlyID = "ses_early"
  before({ tool: "subagent", agent: "HTOrchestrator", sessionID: "parent", id: "early",
    input: { agent: "terraworker", background: true, description: "Early terminal" } })
  await emit("session.execution.started", { sessionID: earlyID })
  await emit("session.idle", { sessionID: earlyID })
  await emit("session.execution.succeeded", { sessionID: earlyID })
  after({ tool: "subagent", agent: "HTOrchestrator", status: "completed", sessionID: "parent",
    id: "early", input: { agent: "terraworker", background: true },
    result: { content: `Background sessionID: ${earlyID}`, metadata: { sessionID: earlyID } } })
  await status(earlyID, "Review")
  await tools.get("a_max_move").execute({ session_id: earlyID, status: "done" }, parent)

  // A first run finishing during registration then restarting on the same ID
  // must not import the old terminal state into the new active run.
  const restarted = "ses_restarted"
  before({ tool: "subagent", agent: "HTOrchestrator", sessionID: "parent", id: "restart",
    input: { agent: "terraworker", background: true } })
  await emit("session.execution.succeeded", { sessionID: restarted })
  await emit("session.execution.started", { sessionID: restarted })
  after({ tool: "subagent", agent: "HTOrchestrator", status: "completed", sessionID: "parent",
    id: "restart", input: { agent: "terraworker", background: true },
    result: { metadata: { sessionID: restarted } } })
  await status(restarted, "Working")
  await emit("session.execution.succeeded", { sessionID: restarted })
  await status(restarted, "Review")

  const failed = "ses_failed"
  dispatch(failed, "call-failed")
  await emit("session.execution.failed", { sessionID: failed, error: { message: "build failed" } })
  await status(failed, "Blocked")
  await assert.rejects(
    tools.get("a_max_move").execute({ session_id: failed, status: "done" }, parent),
    /Review/,
  )

  await cleanup?.()

  const directory = await mkdtemp(join(tmpdir(), "a-max-v2-smoke-"))
  try {
    const config = join(directory, "model.json")
    await writeFile(
      config,
      JSON.stringify({ model: "openai/gpt-5.6-sol", effort: "high" }),
    )
    process.env.OPENCODE_O_A_MAX_MODEL_CONFIG = config
    agents.clear()
    const externalCleanup = await plugin.setup(context as never)
    assert.deepEqual(selectedModel, ["openai", "gpt-5.6-sol"])
    for (const agent of agents.values()) {
      assert.equal(agent.model.id, "gpt-5.6-sol")
      assert.equal(agent.request.body.reasoningEffort, "high")
    }
    const event = {
      agent: "terraworker",
      options: {} as Record<string, unknown>,
    }
    await hooks.get("session.context")!(event)
    assert.equal(event.options.reasoningEffort, "high")
    await externalCleanup?.()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  console.log("a-max-v2-smoke-ok")
} finally {
  if (previous === undefined) delete process.env.OPENCODE_O_A_MAX_MODEL_CONFIG
  else process.env.OPENCODE_O_A_MAX_MODEL_CONFIG = previous
}
