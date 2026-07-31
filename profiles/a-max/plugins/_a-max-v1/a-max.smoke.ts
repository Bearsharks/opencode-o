import plugin from "../a-max"

const hooks = await plugin({} as never)
if (!hooks.tool?.a_max_board || !hooks.tool?.a_max_move) {
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
if (ht.permission.a_max_board !== "allow" || ht.permission.a_max_move !== "allow") {
  throw new Error("HTOrchestrator a-max tool permissions are incorrect")
}
if (
  config.agent.terraworker.permission.a_max_board !== "deny" ||
  config.agent.runner.permission.a_max_board !== "deny"
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

let prematureDoneBlocked = false
await finishTaskCall("call-3", "task-3", "third")
try {
  await hooks.tool.a_max_move.execute({ task_id: "task-3", status: "done" }, toolContext)
} catch {
  prematureDoneBlocked = true
}
if (!prematureDoneBlocked) throw new Error("working card moved directly to done")

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
