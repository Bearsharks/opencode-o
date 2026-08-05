import plugin from "../a-max"

const abortCalls: Array<{ path: { id: string } }> = []
let abortResponse: { data: boolean; error?: unknown } = { data: true }
let statusCalls = 0
const messageCalls: Array<{ path: { id: string } }> = []
let parentWakeCalls = 0
let statusResponse: unknown = { data: {}, error: undefined }
let statusThrows = false
let inspectionMessages: unknown[] = []
const hooks = await plugin({
  client: {
    session: {
      async abort(request: { path: { id: string } }) {
        abortCalls.push(request)
        return abortResponse
      },
      async status() {
        statusCalls += 1
        if (statusThrows) throw new Error("status lookup failed")
        return statusResponse
      },
      async messages(request: { path: { id: string } }) {
        messageCalls.push(request)
        return { data: request.path.id === "task-inspect" ? inspectionMessages : [], error: undefined }
      },
      async promptAsync() {
        parentWakeCalls += 1
        return { data: undefined, error: undefined }
      },
    },
  },
} as never)
if (!hooks.tool?.a_max_board || !hooks.tool?.a_max_move || !hooks.tool?.a_max_interrupt || !hooks.tool?.a_max_inspect) {
  throw new Error("a-max tools are missing")
}

const config = {
  agent: {
    HTOrchestrator: {
      prompt: "MAX_BASE_PROMPT",
      permission: { task: { terraworker: "allow", runner: "allow" } },
    },
    terraworker: { prompt: "TERRA_BASE_PROMPT", permission: {} },
    runner: { prompt: "RUNNER_BASE_PROMPT", permission: {} },
  },
}
await hooks.config?.(config as never)

const ht = config.agent.HTOrchestrator
if (!ht.prompt.startsWith("MAX_BASE_PROMPT")) throw new Error("a-max replaced the Max prompt")
if (!ht.prompt.includes("## A-Max asynchronous delegation")) throw new Error("a-max async contract is missing")
if (
  ht.permission.a_max_board !== "allow" ||
  ht.permission.a_max_move !== "allow" ||
  ht.permission.a_max_interrupt !== "allow" ||
  ht.permission.a_max_inspect !== "allow"
) {
  throw new Error("HTOrchestrator a-max tool permissions are incorrect")
}
if (
  config.agent.terraworker.permission.a_max_board !== "deny" ||
  config.agent.terraworker.permission.a_max_move !== "deny" ||
  config.agent.terraworker.permission.a_max_interrupt !== "deny" ||
  config.agent.terraworker.permission.a_max_inspect !== "deny" ||
  config.agent.runner.permission.a_max_board !== "deny" ||
  config.agent.runner.permission.a_max_move !== "deny" ||
  config.agent.runner.permission.a_max_interrupt !== "deny" ||
  config.agent.runner.permission.a_max_inspect !== "deny"
) {
  throw new Error("worker a-max tool permissions are incorrect")
}

const start = async (sessionID: string, agent: string) => {
  await hooks["chat.message"]?.(
    { sessionID, agent } as never,
    { message: {}, parts: [{ type: "text", text: "start" }] } as never,
  )
}

const beforeTask = async (
  parent: string,
  child: string,
  input: Record<string, unknown>,
  expected: "allow" | "block",
) => {
  let blocked = false
  try {
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: parent, callID: String(input.description ?? child) } as never,
      { args: { subagent_type: child, prompt: "Scope: isolated files", ...input } } as never,
    )
  } catch {
    blocked = true
  }
  if ((expected === "block") !== blocked) {
    throw new Error(`expected ${parent} -> ${child} to ${expected}, blocked=${blocked}`)
  }
}

await start("parent", "HTOrchestrator")
await start("terra-parent", "terraworker")
await start("runner-parent", "runner")

await beforeTask("parent", "terraworker", { description: "first", background: true }, "allow")
await beforeTask("parent", "terraworker", { description: "second", background: true }, "allow")
await beforeTask("parent", "runner", { description: "sync runner" }, "allow")
await beforeTask("parent", "runner", { description: "async runner", background: true }, "block")
await beforeTask("terra-parent", "runner", { description: "terra sync runner" }, "allow")
await beforeTask("terra-parent", "runner", { description: "terra async runner", background: true }, "block")
await beforeTask("runner-parent", "terraworker", { description: "invalid edge", background: true }, "block")

const finishTaskCall = async (callID: string, taskID: string, description: string) => {
  await hooks["tool.execute.after"]?.(
    {
      tool: "task",
      sessionID: "parent",
      callID,
      args: {
        subagent_type: "terraworker",
        description,
        prompt: `Scope: ${description}-scope`,
        background: true,
      },
    } as never,
    {
      title: description,
      output: `<task id="${taskID}" state="running"></task>`,
      metadata: { sessionId: taskID, background: true, jobId: taskID },
    } as never,
  )
}

await finishTaskCall("call-1", "task-1", "first")
await finishTaskCall("call-2", "task-2", "second")

const toolContext = {
  sessionID: "parent",
  messageID: "message",
  agent: "HTOrchestrator",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
} as never

const workingBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (!workingBoard.includes("## Working (2)") || !workingBoard.includes("task-1") || !workingBoard.includes("task-2")) {
  throw new Error(`parallel cards are missing:\n${workingBoard}`)
}

await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "task-1", status: { type: "busy" } } },
} as never)
await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "task-1", status: { type: "idle" } } },
} as never)
await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "task-2", status: { type: "busy" } } },
} as never)
await hooks.event?.({
  event: { type: "session.error", properties: { sessionID: "task-2", error: { name: "TestFailure" } } },
} as never)

const reviewBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (!reviewBoard.includes("## Review (1)") || !reviewBoard.includes("## Blocked (1)")) {
  throw new Error(`terminal card states are incorrect:\n${reviewBoard}`)
}

await hooks.tool.a_max_move.execute({ task_id: "task-1", status: "done", note: "verified" }, toolContext)
await hooks.event?.({
  event: { type: "session.error", properties: { sessionID: "task-1", error: { name: "LateError" } } },
} as never)
await hooks.event?.({
  event: {
    type: "session.deleted",
    properties: {
      info: {
        id: "task-1",
        projectID: "project",
        directory: "/tmp",
        title: "task",
        version: "1.18.4",
        time: { created: 1, updated: 2 },
      },
    },
  },
} as never)
const doneBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (!doneBoard.includes("## Done (1)") || !doneBoard.includes("note=verified")) {
  throw new Error(`reviewed card did not move to done:\n${doneBoard}`)
}
const withoutDoneBoard = String(await hooks.tool.a_max_board.execute({ include_done: false }, toolContext))
if (withoutDoneBoard.includes("## Done") || withoutDoneBoard.includes("- task-1 |")) {
  throw new Error(`a_max_board did not preserve include_done filtering:\n${withoutDoneBoard}`)
}

let prematureDoneBlocked = false
await finishTaskCall("call-3", "task-3", "third")
try {
  await hooks.tool.a_max_move.execute({ task_id: "task-3", status: "done" }, toolContext)
} catch {
  prematureDoneBlocked = true
}
if (!prematureDoneBlocked) throw new Error("working card moved directly to done")

const boardLine = (board: string, taskID: string) => board.split("\n").find((line) => line.startsWith(`- ${taskID} |`)) ?? ""
statusCalls = 0
statusResponse = {
  data: { "task-1": { type: "busy" }, "task-2": { type: "retry" } },
  error: undefined,
}
const runtimeBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (
  statusCalls !== 1 ||
  !boardLine(runtimeBoard, "task-1").includes("runtime=busy") ||
  !boardLine(runtimeBoard, "task-2").includes("runtime=retry") ||
  !boardLine(runtimeBoard, "task-3").includes("runtime=idle") ||
  !runtimeBoard.includes("Working cards currently idle: task-3")
) {
  throw new Error(`a_max_board did not render one shared runtime snapshot:\n${runtimeBoard}`)
}
const stableRuntimeBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (statusCalls !== 2 || stableRuntimeBoard !== runtimeBoard || abortCalls.length !== 0 || parentWakeCalls !== 0) {
  throw new Error("a_max_board did not remain read-only with one lookup per invocation")
}

statusCalls = 0
statusResponse = {}
const malformedRuntimeBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (statusCalls !== 1 || !boardLine(malformedRuntimeBoard, "task-1").includes("runtime=unknown")) {
  throw new Error(`a_max_board did not handle a malformed status response:\n${malformedRuntimeBoard}`)
}
statusThrows = true
const thrownRuntimeBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
statusThrows = false
if (!boardLine(thrownRuntimeBoard, "task-1").includes("runtime=unknown")) {
  throw new Error(`a_max_board did not handle a thrown status lookup:\n${thrownRuntimeBoard}`)
}

statusCalls = 0
const otherParentBoard = String(
  await hooks.tool.a_max_board.execute({ include_done: true }, { ...toolContext, sessionID: "other-parent" }),
)
if (statusCalls !== 0 || !otherParentBoard.includes("A-Max Kanban (0 cards)")) {
  throw new Error("a_max_board did not preserve parent visibility")
}
let boardRejected = false
try {
  await hooks.tool.a_max_board.execute({ include_done: true }, { ...toolContext, agent: "terraworker" })
} catch {
  boardRejected = true
}
if (!boardRejected || statusCalls !== 0) throw new Error("a_max_board authorization called the child SDK")
statusResponse = { data: {}, error: undefined }

await finishTaskCall("call-interrupt", "task-interrupt", "interruptible")
await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "task-interrupt", status: { type: "busy" } } },
} as never)
const interruptResult = String(
  await hooks.tool.a_max_interrupt.execute({ task_id: "task-interrupt", reason: "parent requested pause" }, toolContext),
)
if (
  abortCalls.length !== 1 ||
  abortCalls[0]?.path.id !== "task-interrupt" ||
  !interruptResult.includes("Interrupted task-interrupt")
) {
  throw new Error("a_max_interrupt did not confirm the exact child abort")
}
const interruptedBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (!interruptedBoard.includes("## Blocked (2)") || !interruptedBoard.includes("note=Parent interrupted: parent requested pause")) {
  throw new Error(`successful interrupt did not block its card with its reason:\n${interruptedBoard}`)
}
await hooks.event?.({
  event: { type: "session.status", properties: { sessionID: "task-interrupt", status: { type: "idle" } } },
} as never)
await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "task-interrupt" } } } as never)
const lateIdleBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (!lateIdleBoard.includes("## Blocked (2)") || lateIdleBoard.includes("## Review (1)\n- task-interrupt")) {
  throw new Error(`late idle overwrote an interrupted card:\n${lateIdleBoard}`)
}

await beforeTask("parent", "terraworker", { task_id: "task-interrupt", description: "continue interrupted", background: true }, "allow")
const continuedBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (!continuedBoard.includes("## Working (2)") || !continuedBoard.includes("task-interrupt")) {
  throw new Error(`same-task continuation did not restore Working:\n${continuedBoard}`)
}

const expectInterruptRejected = async (args: Record<string, unknown>, context = toolContext) => {
  let rejected = false
  try {
    await hooks.tool.a_max_interrupt.execute(args, context)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error("a_max_interrupt unexpectedly succeeded")
}

await finishTaskCall("call-abort-failure", "task-abort-failure", "abort failure")
abortResponse = { data: false }
await expectInterruptRejected({ task_id: "task-abort-failure" })
let failedAbortBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (!failedAbortBoard.includes("## Working (3)") || !failedAbortBoard.includes("task-abort-failure")) {
  throw new Error(`unconfirmed abort moved its card:\n${failedAbortBoard}`)
}
abortResponse = { data: true, error: { name: "AbortError" } }
await expectInterruptRejected({ task_id: "task-abort-failure" })
failedAbortBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (!failedAbortBoard.includes("task-abort-failure") || failedAbortBoard.includes("note=Parent interrupted")) {
  throw new Error(`abort error falsely reported success:\n${failedAbortBoard}`)
}
abortResponse = { data: true }

await expectInterruptRejected({ task_id: "task-1" })
await expectInterruptRejected({ task_id: "task-interrupt" }, { ...toolContext, sessionID: "other-parent" })
await expectInterruptRejected({ task_id: "task-interrupt" }, { ...toolContext, agent: "terraworker" })

const inspectStartedAt = Date.now() - 5_000
statusResponse = { data: { "task-inspect": { type: "busy" } }, error: undefined }
inspectionMessages = [
  {
    info: { time: { created: inspectStartedAt - 1_000, updated: inspectStartedAt } },
    parts: [
      { type: "text", text: "PRIVATE_REASONING must not be returned" },
      {
        type: "tool",
        tool: "apply_patch",
        state: {
          status: "running",
          time: { start: inspectStartedAt },
          input: { patch: "RAW_PATCH_TEXT", token: "SECRET_TOKEN" },
        },
      },
    ],
  },
]
await finishTaskCall("call-inspect", "task-inspect", "inspectible")
const beforeInspectBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
const abortCountBeforeInspect = abortCalls.length
statusCalls = 0
const inspection = String(await hooks.tool.a_max_inspect.execute({ task_id: "task-inspect" }, toolContext))
if (
  statusCalls !== 1 ||
  messageCalls.length !== 1 ||
  messageCalls[0]?.path.id !== "task-inspect" ||
  !inspection.includes("A-Max inspection task-inspect") ||
  !inspection.includes("card_status=working") ||
  !inspection.includes("runtime_status=busy") ||
  !inspection.includes("tool=apply_patch") ||
  !inspection.includes("tool_status=running") ||
  (!inspection.includes("tool_started=") && !inspection.includes("tool_running_for="))
) {
  throw new Error(`a_max_inspect did not report compact running operational state:\n${inspection}`)
}
if (inspection.includes("PRIVATE_REASONING") || inspection.includes("RAW_PATCH_TEXT") || inspection.includes("SECRET_TOKEN")) {
  throw new Error(`a_max_inspect exposed tool input or reasoning:\n${inspection}`)
}
const afterInspectBoard = String(await hooks.tool.a_max_board.execute({ include_done: true }, toolContext))
if (abortCalls.length !== abortCountBeforeInspect || afterInspectBoard !== beforeInspectBoard) {
  throw new Error("a_max_inspect mutated a card or interrupted its child")
}

statusCalls = 0
statusResponse = { data: {}, error: undefined }
const idleInspection = String(await hooks.tool.a_max_inspect.execute({ task_id: "task-inspect" }, toolContext))
if (statusCalls !== 1 || !idleInspection.includes("runtime_status=idle")) {
  throw new Error(`a_max_inspect did not treat a missing status entry as idle:\n${idleInspection}`)
}
statusCalls = 0
statusResponse = { data: {}, error: { name: "StatusError" } }
const failedInspection = String(await hooks.tool.a_max_inspect.execute({ task_id: "task-inspect" }, toolContext))
if (statusCalls !== 1 || !failedInspection.includes("runtime_status=unknown")) {
  throw new Error(`a_max_inspect did not treat a status API error as unknown:\n${failedInspection}`)
}
statusCalls = 0
statusThrows = true
const thrownInspection = String(await hooks.tool.a_max_inspect.execute({ task_id: "task-inspect" }, toolContext))
statusThrows = false
if (statusCalls !== 1 || !thrownInspection.includes("runtime_status=unknown")) {
  throw new Error(`a_max_inspect did not treat a thrown status lookup as unknown:\n${thrownInspection}`)
}

const expectInspectRejected = async (context: typeof toolContext) => {
  let rejected = false
  try {
    await hooks.tool.a_max_inspect.execute({ task_id: "task-inspect" }, context)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error("a_max_inspect unexpectedly succeeded")
}
await expectInspectRejected({ ...toolContext, sessionID: "other-parent" })
await expectInspectRejected({ ...toolContext, agent: "runner" })
if (statusCalls !== 1 || messageCalls.length !== 4) throw new Error("rejected inspection called the child SDK")

type StoredMessage = {
  info: { id: string; role: "user" | "assistant"; parentID?: string }
  parts: Array<Record<string, unknown>>
}

const persistedMessages = new Map<string, StoredMessage[]>()
const wakeCalls: Array<Record<string, any>> = []
let promptFailure = false

const fakeClient = {
  session: {
    async messages({ path }: { path: { id: string } }) {
      return { data: persistedMessages.get(path.id) ?? [], error: undefined }
    },
    async promptAsync(request: Record<string, any>) {
      wakeCalls.push(request)
      if (promptFailure) throw new Error("fake promptAsync failure")
      const sessionID = request.path.id
      const messageID = `wake-${wakeCalls.length}`
      const messages = persistedMessages.get(sessionID) ?? []
      messages.push({ info: { id: messageID, role: "user" }, parts: request.body.parts })
      persistedMessages.set(sessionID, messages)
      return { data: undefined, error: undefined }
    },
  },
}

const recoveryHooks = await plugin({ client: fakeClient } as never)

const appendMessages = (sessionID: string, ...messages: StoredMessage[]) => {
  const existing = persistedMessages.get(sessionID) ?? []
  existing.push(...messages)
  persistedMessages.set(sessionID, existing)
}

const userMessage = (id: string, text: string, synthetic = false): StoredMessage => ({
  info: { id, role: "user" },
  parts: [{ type: "text", text, synthetic }],
})

const assistantMessage = (id: string, parentID: string): StoredMessage => ({
  info: { id, role: "assistant", parentID },
  parts: [],
})

const recoveryContext = (sessionID: string) => ({ ...toolContext, sessionID })

appendMessages("unrelated-session", userMessage("unrelated-input", "must not wake"))
await recoveryHooks.event?.({ event: { type: "session.idle", properties: { sessionID: "unrelated-session" } } } as never)
if (wakeCalls.length !== 0) throw new Error("A-Max woke a session without A-Max cards")

const registerReviewTask = async (parent: string, taskID: string) => {
  await recoveryHooks["tool.execute.after"]?.(
    {
      tool: "task",
      sessionID: parent,
      callID: `call-${taskID}`,
      args: {
        subagent_type: "terraworker",
        description: taskID,
        prompt: `Scope: ${taskID}-scope`,
        background: true,
      },
    } as never,
    {
      title: taskID,
      output: `<task id="${taskID}" state="running"></task>`,
      metadata: { sessionId: taskID, background: true, jobId: taskID },
    } as never,
  )
  await recoveryHooks.event?.({
    event: { type: "session.status", properties: { sessionID: taskID, status: { type: "busy" } } },
  } as never)
  await recoveryHooks.event?.({ event: { type: "session.idle", properties: { sessionID: taskID } } } as never)
  const board = String(await recoveryHooks.tool?.a_max_board.execute({ include_done: true }, recoveryContext(parent)))
  if (!board.includes("## Review (1)") && !board.includes("## Review (2)")) {
    throw new Error(`child idle did not move ${taskID} to Review:\n${board}`)
  }
}

const recoveredParent = "recovery-parent"
await registerReviewTask(recoveredParent, "review-task-1")
await registerReviewTask(recoveredParent, "review-task-2")
if (wakeCalls.length !== 0) throw new Error("child idle woke a child or parent session")

appendMessages(recoveredParent, userMessage("user-consumed", "already handled"), assistantMessage("assistant-1", "user-consumed"))
await recoveryHooks.event?.({ event: { type: "session.idle", properties: { sessionID: recoveredParent } } } as never)
if (wakeCalls.length !== 0) throw new Error("consumed user input triggered an idle wake")

appendMessages(recoveredParent, userMessage("task-result-1", "completed task result body", true))
await recoveryHooks.event?.({
  event: { type: "session.status", properties: { sessionID: recoveredParent, status: { type: "idle" } } },
} as never)
if (wakeCalls.length !== 0) throw new Error("session.status idle triggered an A-Max recovery wake")
await recoveryHooks.event?.({ event: { type: "session.idle", properties: { sessionID: recoveredParent } } } as never)
if (wakeCalls.length !== 1) throw new Error(`unhandled task result issued ${wakeCalls.length} wakes instead of one`)
const firstWake = wakeCalls[0]
const firstWakePart = firstWake.body.parts[0]
if (
  firstWake.path.id !== recoveredParent ||
  firstWake.body.agent !== "HTOrchestrator" ||
  firstWake.body.parts.length !== 1 ||
  firstWakePart.synthetic !== true ||
  firstWakePart.metadata.source !== "a-max-idle-resume" ||
  JSON.stringify(firstWakePart.metadata.reviewTaskIDs) !== JSON.stringify(["review-task-1", "review-task-2"]) ||
  !firstWakePart.text.includes("review-task-1") ||
  !firstWakePart.text.includes("review-task-2") ||
  !firstWakePart.text.includes('<task id="review-task-1">') ||
  !firstWakePart.text.includes('<task id="review-task-2">') ||
  firstWakePart.text.includes("completed task result body")
) {
  throw new Error("idle wake request is missing required A-Max recovery details")
}

appendMessages(recoveredParent, assistantMessage("assistant-after-wake", "wake-1"))
await recoveryHooks.event?.({ event: { type: "session.idle", properties: { sessionID: recoveredParent } } } as never)
if (wakeCalls.length !== 1) throw new Error("persisted wake plus its assistant response recursed")

const coalescedParent = "coalesced-parent"
await registerReviewTask(coalescedParent, "coalesced-task-1")
await registerReviewTask(coalescedParent, "coalesced-task-2")
appendMessages(
  coalescedParent,
  userMessage("pending-user", "do not duplicate this user message"),
  userMessage("task-result-2", "do not duplicate this task result", true),
  userMessage("task-result-3", "or this task result", true),
)
await recoveryHooks.event?.({ event: { type: "session.idle", properties: { sessionID: coalescedParent } } } as never)
if (wakeCalls.length !== 2) throw new Error("coalesced pending input did not issue exactly one wake")
const coalescedWakeText = wakeCalls[1].body.parts[0].text
if (
  !coalescedWakeText.includes("coalesced-task-1") ||
  !coalescedWakeText.includes("coalesced-task-2") ||
  coalescedWakeText.includes("do not duplicate")
) {
  throw new Error("coalesced wake did not name Review tasks without copying inputs")
}

const failingParent = "failing-parent"
await registerReviewTask(failingParent, "failing-task")
appendMessages(failingParent, userMessage("failing-pending", "needs recovery"))
promptFailure = true
await recoveryHooks.event?.({ event: { type: "session.idle", properties: { sessionID: failingParent } } } as never)
promptFailure = false
const failureBoard = String(await recoveryHooks.tool?.a_max_board.execute({ include_done: true }, recoveryContext(failingParent)))
if (!failureBoard.includes("## Review (1)") || !failureBoard.includes("failing-task")) {
  throw new Error("client failure changed card status")
}

console.log("a-max-smoke-ok")
