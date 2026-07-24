import plugin from "./advisor-state"

const hooks = await plugin({} as never)
const advisorState = hooks.tool?.advisor_state
if (!advisorState) throw new Error("advisor_state tool is missing")

const advisorOutput = (taskID: string, response: string) => ({
  title: "advisor",
  output: `<task id="${taskID}" state="completed">\n<task_result>\n${response}\n</task_result>\n</task>`,
  metadata: { sessionId: taskID },
})

const ownerSessionID = "smoke-owner"
const advisorTaskID = "smoke-advisor"
await hooks["chat.message"]?.(
  { sessionID: ownerSessionID, agent: "driver" } as never,
  { message: {}, parts: [{ type: "text", text: "start" }] } as never,
)

let mutationBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "edit", sessionID: ownerSessionID, callID: "edit-1", agent: "driver" },
    { args: {} },
  )
} catch {
  mutationBlocked = true
}
if (!mutationBlocked) throw new Error("mutation was allowed before advisor")

let malformedAskBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: ownerSessionID, callID: "bad-ask", agent: "driver" },
    { args: { subagent_type: "advisor", prompt: "ask=choose_direction" } },
  )
} catch {
  malformedAskBlocked = true
}
if (!malformedAskBlocked) throw new Error("non-canonical advisor ask was accepted")

let firstResumeBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "fresh-owner", callID: "old-task", agent: "driver" },
    { args: { subagent_type: "advisor", task_id: "unrelated-task", prompt: '{"ask":"choose_direction"}' } },
  )
} catch {
  firstResumeBlocked = true
}
if (!firstResumeBlocked) throw new Error("first advisor consultation resumed an existing task")

await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: ownerSessionID, callID: "advisor-first", agent: "driver" },
  { args: { subagent_type: "advisor", prompt: '{"ask":"choose_direction"}' } },
)
let invalidResponseBlocked = false
try {
  await hooks["tool.execute.after"]?.(
    {
      tool: "task",
      sessionID: ownerSessionID,
      callID: "advisor-first",
      agent: "driver",
      args: { subagent_type: "advisor", prompt: '{"ask":"choose_direction"}' },
    },
    advisorOutput(advisorTaskID, '{"decision":"act"}'),
  )
} catch (error) {
  invalidResponseBlocked = error instanceof Error && error.message.includes(advisorTaskID)
}
if (!invalidResponseBlocked) throw new Error("invalid advisor response did not preserve its retry task_id")

let missingResumeBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: ownerSessionID, callID: "advisor-missing-resume", agent: "driver" },
    { args: { subagent_type: "advisor", prompt: '{"ask":"choose_direction"}' } },
  )
} catch {
  missingResumeBlocked = true
}
if (!missingResumeBlocked) throw new Error("advisor retry created a fresh task")

await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: ownerSessionID, callID: "advisor-retry", agent: "driver" },
  { args: { subagent_type: "advisor", task_id: advisorTaskID, prompt: '{"ask":"choose_direction"}' } },
)
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: ownerSessionID,
    callID: "advisor-retry",
    agent: "driver",
    args: { subagent_type: "advisor", task_id: advisorTaskID, prompt: '{"ask":"choose_direction"}' },
  },
  advisorOutput(
    advisorTaskID,
    '{"decision":"act","summary":"proceed","plan":["edit"]}',
  ),
)
await hooks["tool.execute.before"]?.(
  { tool: "edit", sessionID: ownerSessionID, callID: "edit-2", agent: "driver" },
  { args: {} },
)

let wrongResumeBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: ownerSessionID, callID: "advisor-wrong-resume", agent: "driver" },
    { args: { subagent_type: "advisor", task_id: "different-task", prompt: '{"ask":"finalize_claim"}' } },
  )
} catch {
  wrongResumeBlocked = true
}
if (!wrongResumeBlocked) throw new Error("a different advisor task was accepted")

const probeOwnerSessionID = "smoke-probe-owner"
const driverProbeTaskID = "smoke-driver-probe"
await hooks["chat.message"]?.(
  { sessionID: probeOwnerSessionID, agent: "driver" } as never,
  { message: {}, parts: [{ type: "text", text: "start" }] } as never,
)
await hooks["chat.message"]?.(
  { sessionID: driverProbeTaskID, agent: "probe-code" } as never,
  { message: {}, parts: [{ type: "text", text: "probe" }] } as never,
)
const probeRead = { title: "read", output: "<content>\na\nb\nc\nd\ne\nf\ng\nh\n</content>", metadata: {} }
await hooks["tool.execute.after"]?.(
  { tool: "read", sessionID: driverProbeTaskID, callID: "probe-read", agent: "probe-code", args: {} },
  probeRead,
)
if (probeRead.output.includes("read budget")) throw new Error("probe child received driver budget feedback")
const driverProbeResult = {
  title: "probe-code",
  output: `<task id="${driverProbeTaskID}" state="completed"><task_result>plain evidence is accepted</task_result></task>`,
  metadata: { sessionId: driverProbeTaskID },
}
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: probeOwnerSessionID,
    callID: "probe-task",
    agent: "driver",
    args: { subagent_type: "probe-code", prompt: "inspect" },
  },
  driverProbeResult,
)
if (!driverProbeResult.output.includes("[read budget: 598L, 25K chars left]")) {
  throw new Error("driver probe did not charge one quarter of its read usage")
}

const advisorProbeTaskID = "smoke-advisor-probe"
await hooks["chat.message"]?.(
  { sessionID: advisorProbeTaskID, agent: "probe-code" } as never,
  { message: {}, parts: [{ type: "text", text: "probe" }] } as never,
)
await hooks["tool.execute.after"]?.(
  { tool: "read", sessionID: advisorProbeTaskID, callID: "advisor-probe-read", agent: "probe-code", args: {} },
  { title: "read", output: "<content>\na\nb\nc\nd\ne\nf\ng\nh\n</content>", metadata: {} },
)
const advisorProbeResult = {
  title: "probe-code",
  output: `<task id="${advisorProbeTaskID}" state="completed"><task_result>evidence</task_result></task>`,
  metadata: { sessionId: advisorProbeTaskID },
}
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: advisorTaskID,
    callID: "advisor-probe-task",
    agent: "advisor",
    args: { subagent_type: "probe-code", prompt: "inspect" },
  },
  advisorProbeResult,
)
if (advisorProbeResult.output.includes("read budget")) throw new Error("advisor probe consumed driver budget")

await hooks["tool.execute.before"]?.(
  { tool: "edit", sessionID: "smoke-build", callID: "build-edit", agent: "build" },
  { args: {} },
)
await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "smoke-build", callID: "build-advisor", agent: "build" },
  { args: { subagent_type: "advisor", prompt: "not a driver advisor request" } },
)
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: "smoke-build",
    callID: "build-advisor",
    agent: "build",
    args: { subagent_type: "advisor", prompt: "not a driver advisor request" },
  },
  advisorOutput("smoke-build-advisor", "not json"),
)

let invalidAllocationBlocked = false
try {
  await advisorState.execute(
    {
      event: "allocate_read_budget",
      reason: "inspect final target",
      strategy: "read one focused range",
      requested_lines: 0,
      requested_chars: 10_000,
    },
    { sessionID: ownerSessionID, agent: "driver" } as never,
  )
} catch {
  invalidAllocationBlocked = true
}
if (!invalidAllocationBlocked) throw new Error("invalid read allocation was accepted")

const allocated = JSON.parse(
  String(
    await advisorState.execute(
      {
        event: "allocate_read_budget",
        reason: "inspect final target",
        strategy: "read one focused implementation range and its focused test",
        requested_lines: 1_200,
        requested_chars: 50_000,
      },
      { sessionID: ownerSessionID, agent: "driver" } as never,
    ),
  ),
)
if (
  allocated.allocated_lines !== 1_200 ||
  allocated.allocated_chars !== 50_000 ||
  allocated.remaining_lines !== 1_800 ||
  allocated.remaining_chars !== 75_000 ||
  allocated.allocation_count !== 1
) {
  throw new Error("requested read budget was not added")
}

console.log("smoke-ok")
