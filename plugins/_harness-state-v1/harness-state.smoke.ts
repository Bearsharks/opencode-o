import plugin from "../harness-state"

const sessions = new Map<string, Array<{ id: string; title: string; parentID: string }>>()
const createdByParent = new Map<string, number>()
const promptCalls = new Map<string, number>()
let nextProbeOutput = JSON.stringify({
  scope_searched: ["src/example.ts"],
  findings: [{ claim: "example", evidence: ["src/example.ts:1"], confidence: "exact" }],
  counterexamples: [],
  not_verified: [],
  direct_verification_candidates: ["src/example.ts:1"],
})
let hooksRef: Awaited<ReturnType<typeof plugin>>

const fakeClient = {
  session: {
    children: async (options: { path: { id: string } }) => ({
      data: sessions.get(options.path.id) || [],
      request: {},
      response: {},
    }),
    create: async (options: { body: { parentID: string; title: string } }) => {
      const count = (createdByParent.get(options.body.parentID) || 0) + 1
      createdByParent.set(options.body.parentID, count)
      const session = {
        id: `${options.body.parentID}-probe-${count}`,
        title: options.body.title,
        parentID: options.body.parentID,
      }
      sessions.set(options.body.parentID, [...(sessions.get(options.body.parentID) || []), session])
      return { data: session, request: {}, response: {} }
    },
    prompt: async (options: {
      path: { id: string }
      body: { agent?: string; parts: Array<{ type: string; text: string }> }
    }) => {
      if (options.body.agent !== "probe") throw new Error("investigate did not prompt the probe agent")
      promptCalls.set(options.path.id, (promptCalls.get(options.path.id) || 0) + 1)
      await hooksRef["chat.message"]?.(
        { sessionID: options.path.id, agent: "probe" } as never,
        { message: {}, parts: [{ type: "text", text: "investigate" }] } as never,
      )
      await read(options.path.id, 20)
      return {
        data: { info: {}, parts: [{ type: "text", text: nextProbeOutput }] },
        request: {},
        response: {},
      }
    },
  },
}

const hooks = await plugin({ client: fakeClient } as never)
hooksRef = hooks
const harnessState = hooks.tool?.harness_state
const investigate = hooks.tool?.investigate
if (!harnessState) throw new Error("harness_state tool is missing")
if (!investigate) throw new Error("investigate tool is missing")
if (
  Object.keys(investigate.args).sort().join(",") !==
  "expected_evidence,question,scope,verification_goal"
) {
  throw new Error(`investigate exposes unexpected arguments: ${Object.keys(investigate.args).join(",")}`)
}

const taskOutput = (taskID: string, response = "done") => ({
  title: "task",
  output: `<task id="${taskID}" state="completed">\n<task_result>\n${response}\n</task_result>\n</task>`,
  metadata: { sessionId: taskID },
})

const start = async (sessionID: string, agent: string) => {
  await hooks["chat.message"]?.(
    { sessionID, agent } as never,
    { message: {}, parts: [{ type: "text", text: "start" }] } as never,
  )
}

async function read(sessionID: string, lines: number) {
  const result = {
    title: "read",
    output: `<content>\n${Array.from({ length: lines }, (_, index) => `line-${index}`).join("\n")}\n</content>`,
    metadata: {},
  }
  await hooksRef["tool.execute.after"]?.(
    { tool: "read", sessionID, callID: `read-${sessionID}`, args: {} } as never,
    result as never,
  )
  return result
}

const investigateArgs = {
  question: "Find exact evidence",
  scope: ["src"],
  expected_evidence: ["path:line"],
  verification_goal: "Identify the direct verification candidate",
}

const context = (sessionID: string, agent: string) =>
  ({
    sessionID,
    agent,
    directory: "/workspace",
    worktree: "/workspace",
    abort: new AbortController().signal,
    metadata: () => {},
  }) as never

await start("orchestrator-direct", "orchestrator")
const directRead = await read("orchestrator-direct", 8)
if (!directRead.output.includes("[read budget: 592L, 25K chars left]")) {
  throw new Error("orchestrator direct read did not charge 100%")
}

await start("worker-child", "terraworker")
const workerRead = await read("worker-child", 8)
if (!workerRead.output.includes("[read budget: 592L, 25K chars left]")) {
  throw new Error("worker did not receive an independent budget")
}

await start("orchestrator-parent", "orchestrator")
const workerResult = taskOutput("worker-child")
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: "orchestrator-parent",
    callID: "worker-task",
    args: { subagent_type: "terraworker", prompt: "work" },
  } as never,
  workerResult as never,
)
if (!workerResult.output.includes("[read budget: 598L, 25K chars left]")) {
  throw new Error("orchestrator did not receive the 25% worker read charge")
}

await start("probe-no-budget", "probe")
const probeRead = await read("probe-no-budget", 20)
if (probeRead.output.includes("[read budget:")) throw new Error("probe received an independent budget")

await start("orchestrator-investigate", "orchestrator")
const firstInvestigation = await investigate.execute(
  investigateArgs,
  context("orchestrator-investigate", "orchestrator"),
)
if (typeof firstInvestigation === "string" || !firstInvestigation.output.includes("[read budget: 598L")) {
  throw new Error("orchestrator investigate did not charge 10%")
}
if (
  typeof firstInvestigation === "string" ||
  JSON.parse(firstInvestigation.output.split("\n\n[read budget:")[0]).schema_valid !== true
) {
  throw new Error("valid investigate response was not wrapped as schema-valid")
}
await investigate.execute(investigateArgs, context("orchestrator-investigate", "orchestrator"))
if (createdByParent.get("orchestrator-investigate") !== 1) {
  throw new Error("same caller did not reuse exactly one probe slot")
}
if (promptCalls.get("orchestrator-investigate-probe-1") !== 2) {
  throw new Error("reused probe slot did not receive both prompts")
}

await start("terra-investigate", "terraworker")
const terraInvestigation = await investigate.execute(
  investigateArgs,
  context("terra-investigate", "terraworker"),
)
if (typeof terraInvestigation === "string" || !terraInvestigation.output.includes("[read budget: 596L")) {
  throw new Error("terra investigate did not charge 20%")
}

await start("luna-investigate", "lunaworker")
const lunaInvestigation = await investigate.execute(
  investigateArgs,
  context("luna-investigate", "lunaworker"),
)
if (typeof lunaInvestigation === "string" || !lunaInvestigation.output.includes("[read budget: 590L")) {
  throw new Error("luna investigate did not charge 50%")
}
if (createdByParent.get("terra-investigate") !== 1 || createdByParent.get("luna-investigate") !== 1) {
  throw new Error("new caller sessions did not receive new probe slots")
}

sessions.set("recovered-caller", [
  { id: "recovered-probe", title: "harness:probe", parentID: "recovered-caller" },
])
await start("recovered-caller", "orchestrator")
await investigate.execute(investigateArgs, context("recovered-caller", "orchestrator"))
if (createdByParent.has("recovered-caller") || promptCalls.get("recovered-probe") !== 1) {
  throw new Error("existing probe child was not recovered by title")
}

await start("task-parent", "orchestrator")
await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "task-parent", callID: "terra-first" } as never,
  { args: { subagent_type: "terraworker", prompt: "work" } } as never,
)
await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "task-parent", callID: "luna-fresh" } as never,
  { args: { subagent_type: "lunaworker", task_id: "fresh-worker", prompt: "work" } } as never,
)

let rawProbeBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "task-parent", callID: "raw-probe" } as never,
    { args: { subagent_type: "probe", prompt: "inspect" } } as never,
  )
} catch {
  rawProbeBlocked = true
}
if (!rawProbeBlocked) throw new Error("raw task to probe was not blocked")

await start("worker-task-parent", "terraworker")
let workerTaskBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "worker-task-parent", callID: "worker-task" } as never,
    { args: { subagent_type: "lunaworker", prompt: "work" } } as never,
  )
} catch {
  workerTaskBlocked = true
}
if (!workerTaskBlocked) throw new Error("worker was allowed to call another worker")

let probeAllocationBlocked = false
try {
  await harnessState.execute(
    {
      event: "allocate_read_budget",
      reason: "probe should not allocate",
      strategy: "none",
      requested_lines: 1,
      requested_chars: 1,
    },
    context("probe-no-budget", "probe"),
  )
} catch {
  probeAllocationBlocked = true
}
if (!probeAllocationBlocked) throw new Error("probe was allowed to allocate a budget")

nextProbeOutput = "not json"
await start("invalid-investigation", "orchestrator")
const malformedInvestigation = await investigate.execute(
  investigateArgs,
  context("invalid-investigation", "orchestrator"),
)
if (typeof malformedInvestigation === "string" || !malformedInvestigation.output.includes("[read budget: 598L")) {
  throw new Error("malformed investigate response did not charge Probe reads")
}
const malformed = JSON.parse(malformedInvestigation.output.split("\n\n[read budget:")[0])
if (
  malformed.schema_valid !== false ||
  malformed.schema_warnings?.[0]?.message !== "Probe returned malformed JSON" ||
  malformed.probe_result_text !== "not json"
) {
  throw new Error(`malformed investigate response was not preserved: ${malformedInvestigation.output}`)
}

nextProbeOutput = JSON.stringify({
  scope_searched: ["src/example.ts"],
  findings: [{ claim: "example", evidence: ["src/example.ts:1"], confidence: "exact" }],
  counterexamples: [{ claim: "wrong item type", evidence: ["src/example.ts:2"] }],
  not_verified: [],
  direct_verification_candidates: ["src/example.ts:1"],
})
const invalidInvestigation = await investigate.execute(
  investigateArgs,
  context("invalid-investigation", "orchestrator"),
)
if (typeof invalidInvestigation === "string") throw new Error("schema-invalid investigate response returned a string")
const invalid = JSON.parse(invalidInvestigation.output)
if (
  invalid.schema_valid !== false ||
  invalid.schema_warnings?.[0]?.path !== "counterexamples[0]" ||
  invalid.probe_result?.counterexamples?.[0]?.claim !== "wrong item type"
) {
  throw new Error(`schema-invalid investigate response was not preserved: ${invalidInvestigation.output}`)
}

const allocation = await harnessState.execute(
  {
    event: "allocate_read_budget",
    reason: "Need a focused follow-up",
    strategy: "Read the exact implementation boundary",
    requested_lines: 1200,
    requested_chars: 50_000,
  },
  context("worker-child", "terraworker"),
)
const allocated = JSON.parse(String(allocation))
if (allocated.remaining_lines !== 1792 || allocated.remaining_chars !== 74_945) {
  throw new Error(`additional budget was not added to the worker's remaining budget: ${allocation}`)
}

console.log("smoke-ok")
