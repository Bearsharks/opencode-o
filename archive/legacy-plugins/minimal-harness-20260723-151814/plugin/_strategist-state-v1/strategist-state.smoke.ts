import plugin from "./strategist-state"

const hooks = await plugin({} as never)
const strategistState = hooks.tool?.strategist_state
if (!strategistState) throw new Error("strategist_state tool is missing")

const taskOutput = (taskID: string, response: string) => ({
  title: "task",
  output: `<task id="${taskID}" state="completed">\n<task_result>\n${response}\n</task_result>\n</task>`,
  metadata: { sessionId: taskID },
})

const startDriver = async (sessionID: string) => {
  await hooks["chat.message"]?.(
    { sessionID, agent: "driver" } as never,
    { message: {}, parts: [{ type: "text", text: "start" }] } as never,
  )
}

const ownerSessionID = "smoke-owner"
const strategistTaskID = "smoke-strategist"
await startDriver(ownerSessionID)

await hooks["tool.execute.before"]?.(
  { tool: "edit", sessionID: ownerSessionID, callID: "edit", agent: "driver" } as never,
  { args: {} } as never,
)

let malformedAskBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: ownerSessionID, callID: "bad-ask", agent: "driver" } as never,
    { args: { subagent_type: "strategist", prompt: "ask=plan" } } as never,
  )
} catch {
  malformedAskBlocked = true
}
if (!malformedAskBlocked) throw new Error("non-canonical strategist ask was accepted")

let legacyAskBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "legacy-ask-owner", callID: "legacy-ask", agent: "driver" } as never,
    { args: { subagent_type: "strategist", prompt: '{"ask":"continue_or_replan"}' } } as never,
  )
} catch {
  legacyAskBlocked = true
}
if (!legacyAskBlocked) throw new Error("legacy strategist ask was accepted")

await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "advise-owner", callID: "advise", agent: "driver" } as never,
  { args: { subagent_type: "strategist", prompt: '{"ask":"advise"}' } } as never,
)

let firstResumeBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "fresh-owner", callID: "old-task", agent: "driver" } as never,
    { args: { subagent_type: "strategist", task_id: "unrelated", prompt: '{"ask":"plan"}' } } as never,
  )
} catch {
  firstResumeBlocked = true
}
if (!firstResumeBlocked) throw new Error("first strategist consultation resumed an existing task")

await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: ownerSessionID, callID: "first", agent: "driver" } as never,
  { args: { subagent_type: "strategist", prompt: '{"ask":"plan"}' } } as never,
)

let invalidResponseBlocked = false
try {
  await hooks["tool.execute.after"]?.(
    {
      tool: "task",
      sessionID: ownerSessionID,
      callID: "first",
      agent: "driver",
      args: { subagent_type: "strategist", prompt: '{"ask":"plan"}' },
    } as never,
    taskOutput(strategistTaskID, '{"decision":"act"}') as never,
  )
} catch (error) {
  invalidResponseBlocked = error instanceof Error && error.message.includes(strategistTaskID)
}
if (!invalidResponseBlocked) throw new Error("invalid strategist response did not preserve its retry task_id")

let missingResumeBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: ownerSessionID, callID: "missing-resume", agent: "driver" } as never,
    { args: { subagent_type: "strategist", prompt: '{"ask":"plan"}' } } as never,
  )
} catch {
  missingResumeBlocked = true
}
if (!missingResumeBlocked) throw new Error("strategist retry created a fresh task")

await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: ownerSessionID, callID: "retry", agent: "driver" } as never,
  { args: { subagent_type: "strategist", task_id: strategistTaskID, prompt: '{"ask":"plan"}' } } as never,
)
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: ownerSessionID,
    callID: "retry",
    agent: "driver",
    args: { subagent_type: "strategist", task_id: strategistTaskID, prompt: '{"ask":"plan"}' },
  } as never,
  taskOutput(
    strategistTaskID,
    '{"decision":"act","summary":"proceed","plan":[{"free_form":"open plan item"}]}',
  ) as never,
)

let wrongResumeBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: ownerSessionID, callID: "wrong-resume", agent: "driver" } as never,
    { args: { subagent_type: "strategist", task_id: "different", prompt: '{"ask":"review"}' } } as never,
  )
} catch {
  wrongResumeBlocked = true
}
if (!wrongResumeBlocked) throw new Error("a different strategist task was accepted")

const directSessionID = "smoke-direct"
await startDriver(directSessionID)
const directRead = { title: "read", output: "<content>\na\nb\nc\nd\ne\nf\ng\nh\n</content>", metadata: {} }
await hooks["tool.execute.after"]?.(
  { tool: "read", sessionID: directSessionID, callID: "direct-read", agent: "driver", args: {} } as never,
  directRead as never,
)
if (!directRead.output.includes("[read budget: 592L, 25K chars left]")) {
  throw new Error("direct read did not charge full usage")
}

const probeOwnerSessionID = "smoke-probe-owner"
const driverProbeTaskID = "smoke-driver-probe"
await startDriver(probeOwnerSessionID)
await hooks["chat.message"]?.(
  { sessionID: driverProbeTaskID, agent: "probe-code" } as never,
  { message: {}, parts: [{ type: "text", text: "probe" }] } as never,
)
await hooks["tool.execute.after"]?.(
  { tool: "read", sessionID: driverProbeTaskID, callID: "probe-read", agent: "probe-code", args: {} } as never,
  { title: "read", output: "<content>\na\nb\nc\nd\ne\nf\ng\nh\n</content>", metadata: {} } as never,
)
const driverProbeResult = taskOutput(driverProbeTaskID, "evidence")
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: probeOwnerSessionID,
    callID: "probe-task",
    agent: "driver",
    args: { subagent_type: "probe-code", prompt: "inspect" },
  } as never,
  driverProbeResult as never,
)
if (!driverProbeResult.output.includes("[read budget: 598L, 25K chars left]")) {
  throw new Error("driver probe did not charge one quarter of its read usage")
}

const strategistProbeTaskID = "smoke-strategist-probe"
await hooks["chat.message"]?.(
  { sessionID: strategistProbeTaskID, agent: "probe-code" } as never,
  { message: {}, parts: [{ type: "text", text: "probe" }] } as never,
)
await hooks["tool.execute.after"]?.(
  { tool: "read", sessionID: strategistProbeTaskID, callID: "strategist-probe-read", agent: "probe-code", args: {} } as never,
  { title: "read", output: "<content>\na\nb\nc\nd\ne\nf\ng\nh\n</content>", metadata: {} } as never,
)
const strategistProbeResult = taskOutput(strategistProbeTaskID, "evidence")
await hooks["tool.execute.after"]?.(
  {
    tool: "task",
    sessionID: strategistTaskID,
    callID: "strategist-probe-task",
    agent: "strategist",
    args: { subagent_type: "probe-code", prompt: "inspect" },
  } as never,
  strategistProbeResult as never,
)
if (strategistProbeResult.output.includes("read budget")) {
  throw new Error("strategist probe consumed driver budget")
}

console.log("smoke-ok")
