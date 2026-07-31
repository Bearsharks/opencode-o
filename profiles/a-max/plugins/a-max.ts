import { tool, type Plugin } from "@opencode-ai/plugin"
import maxTopology from "../../max/plugins/max-topology"

const asyncContract = `
## A-Max asynchronous delegation

- Preserve every Max-mode delegation, evidence, permission, Runner handoff, self-improvement skill handoff, and completion contract above.
- Run independent implementation tasks as separate \`terraworker\` calls with \`background: true\`. A-Max imposes no fixed concurrency limit.
- Give each parallel Terra task a disjoint edit scope. Serialize overlapping work or continue the existing card with its \`task_id\`; never launch duplicate work against the same files or topic.
- Omit \`task_id\` to create a new parallel card. Reuse the original \`task_id\` for follow-up context, rework, or continuation of that card.
- Runner is synchronous only. Never set \`background: true\` for \`runner\`, whether Runner is called by HTOrchestrator or Terra.
- After dispatching background work, briefly tell the user what is running and continue the conversation or other non-overlapping work. Do not sleep, poll, ask workers for status, or duplicate their work.
- A background worker result moves its card to Review, not Done. Inspect the result, perform proportionate focused verification, then call \`a_max_move\` with \`status: "done"\`. Mark genuine failures or decision blockers as \`blocked\`.
- Use \`a_max_board\` when the user asks for status, when coordinating parallel scopes, and before making a final completion claim.
`.trim()

type Json = Record<string, unknown>
type CardStatus = "working" | "review" | "done" | "blocked"

type Card = {
  taskID: string
  parentSessionID: string
  worker: "terraworker"
  description: string
  scope?: string
  status: CardStatus
  startedAt: number
  updatedAt: number
  note?: string
}

type TerminalState = {
  status: "review" | "blocked"
  note?: string
  updatedAt: number
}

const idleResumeSource = "a-max-idle-resume"

function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function addToolPermission(agent: Json | undefined, name: string, action: "allow" | "deny") {
  if (!agent) return
  const permission = asRecord(agent.permission) ?? {}
  permission[name] = action
  agent.permission = permission
}

function appendAsyncContract(agent: Json | undefined) {
  if (!agent) return
  const prompt = asString(agent.prompt)
  if (!prompt || prompt.includes("## A-Max asynchronous delegation")) return
  agent.prompt = `${prompt}\n\n${asyncContract}`
}

function extractScope(prompt: unknown) {
  if (typeof prompt !== "string") return
  for (const line of prompt.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:write\s+scope|scope)\s*:\s*(.+?)\s*$/i)
    if (match?.[1]) return match[1]
  }
}

function errorText(value: unknown) {
  if (typeof value === "string") return value
  const record = asRecord(value)
  return asString(record?.message) ?? asString(record?.name) ?? "Background task failed"
}

function isIdleResumeMessage(message: Json, parts: unknown[]) {
  if (message.role !== "user") return false
  return parts.some((part) => {
    const text = asRecord(part)
    return text?.type === "text" && asRecord(text.metadata)?.source === idleResumeSource
  })
}

function hasUnhandledInput(messages: Array<{ info: unknown; parts: unknown[] }>) {
  const messageIndex = new Map<string, number>()
  let latestRelevantUser = -1
  let latestAssistantParent = -1

  for (const [index, message] of messages.entries()) {
    const info = asRecord(message.info)
    const id = asString(info?.id)
    if (id) messageIndex.set(id, index)
    if (info?.role === "user" && !isIdleResumeMessage(info ?? {}, message.parts)) {
      latestRelevantUser = index
    }
  }

  for (const message of messages) {
    const info = asRecord(message.info)
    if (info?.role !== "assistant") continue
    const parentIndex = messageIndex.get(asString(info?.parentID) ?? "")
    if (parentIndex !== undefined) latestAssistantParent = Math.max(latestAssistantParent, parentIndex)
  }

  return latestRelevantUser > latestAssistantParent
}

function formatTime(value: number) {
  return new Date(value).toISOString()
}

function renderBoard(cards: Card[], includeDone: boolean) {
  const visible = includeDone ? cards : cards.filter((card) => card.status !== "done")
  const columns: Array<{ status: CardStatus; title: string }> = [
    { status: "working", title: "Working" },
    { status: "review", title: "Review" },
    { status: "done", title: "Done" },
    { status: "blocked", title: "Blocked" },
  ]

  const lines = [`A-Max Kanban (${visible.length} card${visible.length === 1 ? "" : "s"})`]
  for (const column of columns) {
    if (!includeDone && column.status === "done") continue
    const items = visible
      .filter((card) => card.status === column.status)
      .sort((left, right) => left.startedAt - right.startedAt)
    lines.push("", `## ${column.title} (${items.length})`)
    if (items.length === 0) {
      lines.push("- empty")
      continue
    }
    for (const card of items) {
      const details = [
        `worker=${card.worker}`,
        ...(card.scope ? [`scope=${card.scope}`] : []),
        `updated=${formatTime(card.updatedAt)}`,
        ...(card.note ? [`note=${card.note}`] : []),
      ]
      lines.push(`- ${card.taskID} | ${card.description} | ${details.join(" | ")}`)
    }
  }
  return lines.join("\n")
}

export default (async (input) => {
  const maxHooks = await maxTopology(input)
  const cards = new Map<string, Card>()
  const busySessions = new Set<string>()
  const terminalBeforeRegistration = new Map<string, TerminalState>()

  function transition(taskID: string, status: CardStatus, note?: string) {
    const card = cards.get(taskID)
    if (!card) return
    if (status === "review" && card.status !== "working") return
    card.status = status
    card.updatedAt = Date.now()
    card.note = note
  }

  function recordTerminal(taskID: string, state: TerminalState) {
    const card = cards.get(taskID)
    if (card) {
      if (card.status === "done") return
      transition(taskID, state.status, state.note)
      return
    }
    terminalBeforeRegistration.set(taskID, state)
  }

  async function recoverParentOnIdle(parentSessionID: string) {
    const reviewTaskIDs = [...cards.values()]
      .filter((card) => card.parentSessionID === parentSessionID && card.status === "review")
      .map((card) => card.taskID)

    try {
      const messagesResponse = await input.client.session.messages({ path: { id: parentSessionID } })
      if (messagesResponse.error || !messagesResponse.data || !hasUnhandledInput(messagesResponse.data)) return

      const reviewInstruction = reviewTaskIDs.length
        ? `Then review completed A-Max task IDs: ${reviewTaskIDs.map((taskID) => `\`${taskID}\``).join(", ")}, using matching ${reviewTaskIDs.map((taskID) => `<task id="${taskID}">`).join(", ")} results already in this session; do not redispatch or accept work without verification.`
        : "Only pending user messages need reconciliation; do not redispatch or accept work without verification."
      const promptResponse = await input.client.session.promptAsync({
        path: { id: parentSessionID },
        body: {
          agent: "HTOrchestrator",
          parts: [
            {
              type: "text",
              text: `Internal A-Max idle recovery: reconcile pending user-authored messages first. ${reviewInstruction}`,
              synthetic: true,
              metadata: { source: idleResumeSource, reviewTaskIDs },
            },
          ],
        },
      })
      if (promptResponse.error) return
    } catch {
      // An idle recovery failure must not alter cards or disrupt OpenCode's event hook.
    }
  }

  const board = tool({
    description:
      "Show this parent session's A-Max background Terra cards grouped as Working, Review, Done, and Blocked.",
    args: {
      include_done: tool.schema.boolean().optional().describe("Include completed cards. Defaults to true."),
    },
    async execute(args, context) {
      if (context.agent !== "HTOrchestrator") {
        throw new Error("a_max_board is available only to HTOrchestrator")
      }
      const ownCards = [...cards.values()].filter((card) => card.parentSessionID === context.sessionID)
      return renderBoard(ownCards, args.include_done !== false)
    },
  })

  const move = tool({
    description:
      "Move one A-Max card after orchestration review. A working card cannot be marked done before its worker result reaches Review.",
    args: {
      task_id: tool.schema.string().describe("Background Terra task/session ID shown by task or a_max_board"),
      status: tool.schema.enum(["review", "done", "blocked"]),
      note: tool.schema.string().optional().describe("Compact verification result or blocker"),
    },
    async execute(args, context) {
      if (context.agent !== "HTOrchestrator") {
        throw new Error("a_max_move is available only to HTOrchestrator")
      }
      const card = cards.get(args.task_id)
      if (!card || card.parentSessionID !== context.sessionID) {
        throw new Error(`Unknown A-Max card for this session: ${args.task_id}`)
      }
      if (args.status === "done" && card.status !== "review") {
        throw new Error(`A-Max card ${args.task_id} must be in Review before it can move to Done`)
      }
      transition(args.task_id, args.status, args.note)
      return `Moved ${args.task_id} to ${args.status}.`
    },
  })

  return {
    ...maxHooks,

    config: async (config) => {
      await maxHooks.config?.(config)
      const agentConfig = asRecord(config.agent)
      const orchestrator = asRecord(agentConfig?.HTOrchestrator)
      const terra = asRecord(agentConfig?.terraworker)
      const runner = asRecord(agentConfig?.runner)

      appendAsyncContract(orchestrator)
      addToolPermission(orchestrator, "a_max_board", "allow")
      addToolPermission(orchestrator, "a_max_move", "allow")
      addToolPermission(terra, "a_max_board", "deny")
      addToolPermission(terra, "a_max_move", "deny")
      addToolPermission(runner, "a_max_board", "deny")
      addToolPermission(runner, "a_max_move", "deny")
    },

    tool: {
      ...maxHooks.tool,
      a_max_board: board,
      a_max_move: move,
    },

    "tool.execute.before": async (input, output) => {
      await maxHooks["tool.execute.before"]?.(input, output)
      if (input.tool !== "task") return
      const args = asRecord(output.args)
      const child = asString(args?.subagent_type)
      if (!child) return
      if (child === "runner" && args?.background === true) {
        throw new Error("a-max requires runner tasks to stay foreground")
      }

      const taskID = asString(args?.task_id)
      if (child === "terraworker" && taskID && cards.has(taskID)) {
        busySessions.delete(taskID)
        terminalBeforeRegistration.delete(taskID)
        transition(taskID, "working")
      }
    },

    "tool.execute.after": async (input, output) => {
      await maxHooks["tool.execute.after"]?.(input, output)
      if (input.tool !== "task") return
      const args = asRecord(input.args)
      const worker = asString(args?.subagent_type)
      const metadata = asRecord(output.metadata)
      const taskID =
        asString(metadata?.sessionId) ?? asString(metadata?.sessionID) ?? asString(metadata?.jobId) ?? asString(args?.task_id)
      if (worker !== "terraworker" || metadata?.background !== true || !taskID) return

      const now = Date.now()
      const existing = cards.get(taskID)
      const pendingTerminal = terminalBeforeRegistration.get(taskID)
      const next: Card = {
        taskID,
        parentSessionID: input.sessionID,
        worker: "terraworker",
        description: asString(args?.description) ?? existing?.description ?? "Terra task",
        scope: extractScope(args?.prompt) ?? existing?.scope,
        status: pendingTerminal?.status ?? "working",
        startedAt: existing?.startedAt ?? now,
        updatedAt: pendingTerminal?.updatedAt ?? now,
        note: pendingTerminal?.note,
      }
      cards.set(taskID, next)
      terminalBeforeRegistration.delete(taskID)
    },

    event: async ({ event }) => {
      await maxHooks.event?.({ event })
      if (event.type === "session.status") {
        const taskID = event.properties.sessionID
        if (event.properties.status.type === "busy") {
          busySessions.add(taskID)
          terminalBeforeRegistration.delete(taskID)
          const card = cards.get(taskID)
          if (card && card.status !== "done") transition(taskID, "working")
          return
        }
        if (event.properties.status.type === "idle" && busySessions.has(taskID)) {
          recordTerminal(taskID, { status: "review", updatedAt: Date.now() })
        }
        return
      }

      if (event.type === "session.idle") {
        const taskID = event.properties.sessionID
        if (busySessions.has(taskID)) {
          recordTerminal(taskID, { status: "review", updatedAt: Date.now() })
        }
        if ([...cards.values()].some((card) => card.parentSessionID === taskID)) {
          await recoverParentOnIdle(taskID)
        }
        return
      }

      if (event.type === "session.error" && event.properties.sessionID) {
        recordTerminal(event.properties.sessionID, {
          status: "blocked",
          note: errorText(event.properties.error),
          updatedAt: Date.now(),
        })
        return
      }

      if (event.type === "session.deleted") {
        const taskID = event.properties.info.id
        if (cards.get(taskID)?.status !== "done" && cards.has(taskID)) {
          transition(taskID, "blocked", "Background session was deleted")
        }
      }
    },

    dispose: async () => {
      await maxHooks.dispose?.()
      cards.clear()
      busySessions.clear()
      terminalBeforeRegistration.clear()
    },
  }
}) satisfies Plugin
