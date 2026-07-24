import plugin from "../harness-state"

const hooks = await plugin({} as never)
const harnessState = hooks.tool?.harness_state
if (!harnessState) throw new Error("harness_state tool is missing")

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

const read = async (sessionID: string, agent: string, lines: number) => {
  const result = {
    title: "read",
    output: `<content>\n${Array.from({ length: lines }, (_, index) => `line-${index}`).join("\n")}\n</content>`,
    metadata: {},
  }
  await hooks["tool.execute.after"]?.(
    { tool: "read", sessionID, callID: `read-${sessionID}`, agent, args: {} } as never,
    result as never,
  )
  return result
}

await start("orchestrator-direct", "orchestrator")
const directRead = await read("orchestrator-direct", "orchestrator", 8)
if (!directRead.output.includes("[read budget: 592L, 25K chars left]")) {
  throw new Error("orchestrator direct read did not charge 100%")
}

await start("worker-child", "terraworker")
const workerRead = await read("worker-child", "terraworker", 8)
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
    agent: "orchestrator",
    args: { subagent_type: "terraworker", prompt: "work" },
  } as never,
  workerResult as never,
)
if (!workerResult.output.includes("[read budget: 598L, 25K chars left]")) {
  throw new Error("orchestrator did not receive the 25% delegated read charge")
}

await start("probe-child", "probe")
const probeRead = await read("probe-child", "probe", 16)
if (!probeRead.output.includes("[read budget: 584L, 25K chars left]")) {
  throw new Error("probe did not receive an independent budget")
}

await start("luna-parent", "lunaworker")
const probeResult = taskOutput("probe-child")
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: "luna-parent",
    callID: "probe-task",
    agent: "lunaworker",
    args: { subagent_type: "probe", prompt: "inspect" },
  } as never,
  probeResult as never,
)
if (!probeResult.output.includes("[read budget: 596L, 25K chars left]")) {
  throw new Error("worker did not receive the 25% probe charge")
}

const nestedWorkerResult = taskOutput("luna-parent")
await start("nested-orchestrator", "orchestrator")
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: "nested-orchestrator",
    callID: "nested-worker-task",
    agent: "orchestrator",
    args: { subagent_type: "lunaworker", prompt: "work" },
  } as never,
  nestedWorkerResult as never,
)
if (!nestedWorkerResult.output.includes("[read budget: 599L, 25K chars left]")) {
  throw new Error("nested delegated usage did not compound at 25% per level")
}

await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "valid", callID: "valid", agent: "orchestrator" } as never,
  { args: { subagent_type: "probe", prompt: "inspect" } } as never,
)

const firstContinuityCall = { args: { subagent_type: "probe", prompt: "inspect" } }
await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "continuity-parent", callID: "continuity-first", agent: "orchestrator" } as never,
  firstContinuityCall as never,
)
if ("task_id" in firstContinuityCall.args) throw new Error("first child call unexpectedly received a task_id")
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: "continuity-parent",
    callID: "continuity-first",
    agent: "orchestrator",
    args: firstContinuityCall.args,
  } as never,
  taskOutput("continuity-child") as never,
)

const resumedContinuityCall = { args: { subagent_type: "probe", prompt: "continue" } } as {
  args: { subagent_type: string; prompt: string; task_id?: string }
}
await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "continuity-parent", callID: "continuity-resume", agent: "orchestrator" } as never,
  resumedContinuityCall as never,
)
if (resumedContinuityCall.args.task_id !== "continuity-child") {
  throw new Error("existing child task_id was not injected")
}

let differentTaskBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "continuity-parent", callID: "continuity-different", agent: "orchestrator" } as never,
    { args: { subagent_type: "probe", task_id: "different-child", prompt: "continue" } } as never,
  )
} catch {
  differentTaskBlocked = true
}
if (!differentTaskBlocked) throw new Error("different child task_id was not blocked")

let missingTaskIDBlocked = false
try {
  await hooks["tool.execute.after"]?.(
    {
      tool: "task",
      sessionID: "missing-task-id-parent",
      callID: "missing-task-id",
      agent: "orchestrator",
      args: { subagent_type: "probe", prompt: "inspect" },
    } as never,
    { title: "task", output: "done", metadata: {} } as never,
  )
} catch {
  missingTaskIDBlocked = true
}
if (!missingTaskIDBlocked) throw new Error("missing child task_id was not blocked")

let workerCallBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "invalid-worker", callID: "invalid", agent: "terraworker" } as never,
    { args: { subagent_type: "lunaworker", prompt: "work" } } as never,
  )
} catch {
  workerCallBlocked = true
}
if (!workerCallBlocked) throw new Error("worker was allowed to call another worker")

let probeCallBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "invalid-probe", callID: "invalid", agent: "probe" } as never,
    { args: { subagent_type: "terraworker", prompt: "work" } } as never,
  )
} catch {
  probeCallBlocked = true
}
if (!probeCallBlocked) throw new Error("probe was allowed to delegate")

const allocation = await harnessState.execute(
  {
    event: "allocate_read_budget",
    reason: "Need a focused follow-up",
    strategy: "Read the exact implementation boundary",
    requested_lines: 1200,
    requested_chars: 50_000,
  },
  { sessionID: "worker-child", agent: "terraworker" } as never,
)
const allocated = JSON.parse(String(allocation))
if (allocated.remaining_lines !== 1792 || allocated.remaining_chars !== 74_945) {
  throw new Error(`additional budget was not added to the worker's remaining budget: ${allocation}`)
}

console.log("smoke-ok")
