import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "./index"

const previous = process.env.OPENCODE_O_A_MAX_MODEL_CONFIG
process.env.OPENCODE_O_A_MAX_MODEL_CONFIG = ""
const agents = new Map<string, any>()
const tools = new Map<string, any>()
const hooks = new Map<string, Function>()
const interrupted: string[] = []
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
  event: { async *subscribe() {} },
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
  assert.equal(runner.hidden, true)
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
    /Review/,
  )
  await tools
    .get("a_max_move")
    .execute({ session_id: "ses_test123", status: "review" }, parent)
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
