import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { Model, Plugin } from "@opencode/plugin"
import YAML from "yaml"

type CardStatus = "working" | "review" | "done" | "blocked"
type RuntimeStatus = "busy" | "retry" | "idle" | "unknown"
type Card = {
  sessionID: string
  parentSessionID: string
  description: string
  scope?: string
  status: CardStatus
  startedAt: number
  updatedAt: number
  note?: string
}

const modelConfigEnv = "OPENCODE_O_A_MAX_MODEL_CONFIG"
const agents = new Set(["HTOrchestrator", "terraworker", "runner"])
const children: Record<string, readonly string[]> = {
  HTOrchestrator: ["terraworker", "runner"],
  terraworker: ["runner"],
  runner: [],
}
const contract = `## A-Max asynchronous delegation

- Dispatch independent terraworker scopes using the subagent tool with background: true and disjoint edit scopes. Runner is foreground only.
- Omit sessionID for new work. Reuse the exact sessionID returned by subagent for continuation of the same scope; never reconstruct an ID.
- Use a_max_board to coordinate cards. A finished child moves to Review; move it to Done only after evidence-based verification. Inspect and interrupt stuck work before continuing it.
- Give the user a brief update after dispatching background work. Do not poll or duplicate a worker's scope.`

const schema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
})
const string = { type: "string" as const }
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined
const output = (content: string) => ({ content })
const scope = (prompt: unknown) =>
  typeof prompt === "string"
    ? prompt
        .split(/\r?\n/)
        .map(
          (line) =>
            line.match(/^\s*(?:write\s+scope|scope)\s*:\s*(.+?)\s*$/i)?.[1],
        )
        .find(Boolean)
    : undefined

function modelFile() {
  const override = process.env[modelConfigEnv]
  if (override !== undefined) {
    if (!override) return
    if (!isAbsolute(override))
      throw new Error(`${modelConfigEnv} must be an absolute path`)
    return { path: override, optional: false }
  }
  const home =
    process.env.XDG_CONFIG_HOME ||
    (process.env.HOME && join(process.env.HOME, ".config"))
  return home
    ? { path: join(home, "opencode", "a-max-model.json"), optional: true }
    : undefined
}

async function externalModel() {
  const file = modelFile()
  if (!file) return
  let raw: string
  try {
    raw = await readFile(file.path, "utf8")
  } catch (error) {
    if (file.optional && (error as NodeJS.ErrnoException).code === "ENOENT")
      return
    throw new Error(
      `A-Max model config error: cannot read ${file.path}: ${String(error)}`,
    )
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`A-Max model config error: ${file.path} is not valid JSON`)
  }
  const config = record(value)
  if (
    Object.keys(config).sort().join(",") !== "effort,model" ||
    typeof config.model !== "string" ||
    typeof config.effort !== "string" ||
    !/^\S+\/\S+$/.test(config.model) ||
    !config.effort.trim() ||
    config.model !== config.model.trim() ||
    config.effort !== config.effort.trim()
  ) {
    throw new Error(
      `A-Max model config error: ${file.path} must contain exactly trimmed model and effort strings`,
    )
  }
  const [providerID, ...parts] = config.model.split("/")
  return { providerID, id: parts.join("/"), effort: config.effort }
}

export default Plugin.define({
  id: "a-max",
  async setup(ctx) {
    const external = await externalModel()
    // OPENCODE_CONFIG_DIR loads the profile document, but V2 discovers Markdown
    // agents only from global agents/ and project .opencode/agents/. Load this
    // profile's files explicitly so oc-amax works from any project directory.
    const definitions = await Promise.all(
      [...agents].map(async (name) => {
        const markdown = await readFile(
          new URL(`../../agents/${name}.md`, import.meta.url),
          "utf8",
        )
        const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
        if (!match)
          throw new Error(`A-Max agent ${name} needs YAML frontmatter`)
        const front = record(YAML.parse(match[1]))
        return { name, front, system: markdown.slice(match[0].length).trim() }
      }),
    )
    const cards = new Map<string, Card>()
    const runtimes = new Map<string, RuntimeStatus>()
    const pending = new Map<string, { description: string; scope?: string }>()
    const early = new Map<string, { status: CardStatus; note?: string }>()
    const wokenFor = new Map<string, string>()

    async function recoverParentOnIdle(sessionID: string) {
      const review = [...cards.values()].filter(
        (card) =>
          card.parentSessionID === sessionID && card.status === "review",
      )
      if (
        ![...cards.values()].some((card) => card.parentSessionID === sessionID)
      )
        return
      try {
        const messages = await ctx.session.context({ sessionID })
        let lastUser = -1
        let lastAssistant = -1
        for (const [index, message] of messages.entries()) {
          if (message.type === "user") lastUser = index
          if (message.type === "assistant") lastAssistant = index
        }
        if (lastUser <= lastAssistant || lastUser < 0) return
        const user = messages[lastUser]
        if (wokenFor.get(sessionID) === user.id) return
        wokenFor.set(sessionID, user.id)
        await ctx.session.synthetic({
          sessionID,
          text: `Internal A-Max idle recovery: reconcile pending user messages first. ${review.length ? `Then review completed A-Max session IDs: ${review.map((card) => card.sessionID).join(", ")}; do not redispatch or accept without verification.` : "Do not redispatch or accept work without verification."}`,
          metadata: {
            source: "a-max-idle-resume",
            reviewSessionIDs: review.map((card) => card.sessionID),
          },
          resume: true,
        })
      } catch {
        // A failed wake must not alter cards or disrupt the event subscription.
      }
    }

    await ctx.agent.transform((editor) => {
      for (const { name, front, system } of definitions) {
        const discovered = Boolean(editor.get(name)?.system)
        editor.update(name, (agent) => {
          if (!discovered) {
            agent.system = system
            agent.description = text(front.description)
            agent.mode =
              front.mode === "subagent"
                ? "subagent"
                : front.mode === "all"
                  ? "all"
                  : "primary"
            agent.hidden = front.hidden === true
            if (typeof front.model === "string")
              agent.model = Model.Ref.parse(front.model)
            if (Array.isArray(front.permissions)) {
              for (const rule of front.permissions as (typeof agent.permissions)[number][]) {
                if (
                  !agent.permissions.some(
                    (current) =>
                      current.action === rule.action &&
                      current.resource === rule.resource &&
                      current.effect === rule.effect,
                  )
                )
                  agent.permissions.push(rule)
              }
            }
            const request = record(front.request)
            agent.request.body = {
              ...agent.request.body,
              ...record(request.body),
            }
            if (typeof front.steps === "number") agent.steps = front.steps
          }
          if (external) {
            agent.model = {
              providerID: external.providerID as never,
              id: external.id as never,
            }
            agent.request.body.reasoningEffort = external.effort
          }
          if (name === "HTOrchestrator") {
            if (!agent.system?.includes("## A-Max asynchronous delegation"))
              agent.system = `${agent.system || ""}\n\n${contract}`.trim()
            for (const tool of [
              "a_max_board",
              "a_max_move",
              "a_max_inspect",
              "a_max_interrupt",
            ]) {
              agent.permissions.push({
                action: tool,
                resource: "*",
                effect: "allow",
              })
            }
          } else {
            for (const tool of [
              "a_max_board",
              "a_max_move",
              "a_max_inspect",
              "a_max_interrupt",
            ]) {
              agent.permissions.push({
                action: tool,
                resource: "*",
                effect: "deny",
              })
            }
          }
        })
      }
    })
    if (external)
      await ctx.model.transform((editor) =>
        editor.default.set(external.providerID, external.id),
      )
    // Agent request.body is retained by V2 but not yet sent by its session runner.
    await ctx.session.hook("context", async (event) => {
      if (!agents.has(event.agent)) return
      const agent = await ctx.agent.get({ agentID: event.agent })
      for (const key of ["reasoningEffort", "textVerbosity"]) {
        const value = agent.data.request.body[key]
        if (value !== undefined) event.options[key] = value
      }
    })

    function transition(sessionID: string, status: CardStatus, note?: string) {
      const card = cards.get(sessionID)
      if (!card) {
        early.set(sessionID, { status, note })
        return
      }
      if (status === "review" && card.status !== "working") return
      if (card.status === "done" && status !== "done") return
      card.status = status
      card.updatedAt = Date.now()
      card.note = note
    }
    function own(sessionID: string, parent: string) {
      const card = cards.get(sessionID)
      if (!card || card.parentSessionID !== parent)
        throw new Error(
          `Unknown exact A-Max card ID: ${sessionID}. Copy sessionID from subagent or a_max_board.`,
        )
      return card
    }
    function authorized(agent: string) {
      if (agent !== "HTOrchestrator")
        throw new Error("A-Max card tools are available only to HTOrchestrator")
    }
    function board(parent: string, includeDone: boolean) {
      const visible = [...cards.values()].filter(
        (card) =>
          card.parentSessionID === parent &&
          (includeDone || card.status !== "done"),
      )
      const summary = (["busy", "retry", "idle", "unknown"] as const).map(
        (status) =>
          `${status}=${visible.filter((card) => (runtimes.get(card.sessionID) || "unknown") === status).length}`,
      )
      const lines = [
        `A-Max Kanban (${visible.length} cards)`,
        `Runtime snapshot: ${summary.join(" | ")}`,
      ]
      const idle = visible.filter(
        (card) =>
          card.status === "working" && runtimes.get(card.sessionID) === "idle",
      )
      if (idle.length)
        lines.push(
          `Working cards currently idle: ${idle.map((card) => card.sessionID).join(", ")}`,
        )
      for (const status of ["working", "review", "done", "blocked"] as const) {
        if (status === "done" && !includeDone) continue
        const group = visible
          .filter((card) => card.status === status)
          .sort((a, b) => a.startedAt - b.startedAt)
        lines.push(
          "",
          `## ${status[0].toUpperCase()}${status.slice(1)} (${group.length})`,
        )
        if (!group.length) lines.push("- empty")
        for (const card of group)
          lines.push(
            `- ${card.sessionID} | ${card.description} | worker=terraworker | runtime=${runtimes.get(card.sessionID) || "unknown"}${card.scope ? ` | scope=${card.scope}` : ""} | updated=${new Date(card.updatedAt).toISOString()}${card.note ? ` | note=${card.note}` : ""}`,
          )
      }
      return lines.join("\n")
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "a_max_board",
        description:
          "Show this session's background Terra cards, grouped by status. Done cards are omitted by default.",
        input: schema({ include_done: { type: "boolean" } }),
        execute: async (raw, context) => {
          authorized(context.agent)
          return output(
            board(context.sessionID, record(raw).include_done === true),
          )
        },
      })
      editor.add({
        name: "a_max_move",
        description:
          "Move an exact A-Max card to review, done, or blocked after verification.",
        input: schema(
          {
            session_id: string,
            status: { type: "string", enum: ["review", "done", "blocked"] },
            note: string,
          },
          ["session_id", "status"],
        ),
        execute: async (raw, context) => {
          authorized(context.agent)
          const args = record(raw)
          const card = own(String(args.session_id), context.sessionID)
          if (args.status === "done" && card.status !== "review")
            throw new Error(`${card.sessionID} must be in Review before Done`)
          transition(card.sessionID, args.status as CardStatus, text(args.note))
          return output(
            `A-Max card updated: sessionID=${card.sessionID} | description=${card.description} | status=${card.status}${card.note ? ` | note=${card.note}` : ""}`,
          )
        },
      })
      editor.add({
        name: "a_max_interrupt",
        description:
          "Interrupt one active background Terra card and move it to Blocked.",
        input: schema({ session_id: string, reason: string }, ["session_id"]),
        execute: async (raw, context) => {
          authorized(context.agent)
          const args = record(raw)
          const card = own(String(args.session_id), context.sessionID)
          if (card.status === "done")
            throw new Error(`${card.sessionID} is already Done`)
          await ctx.session.interrupt({ sessionID: card.sessionID })
          transition(
            card.sessionID,
            "blocked",
            `Parent interrupted${text(args.reason) ? `: ${text(args.reason)}` : ""}`,
          )
          return output(
            `Interrupted ${card.sessionID} and moved it to blocked.`,
          )
        },
      })
      editor.add({
        name: "a_max_inspect",
        description:
          "Inspect the latest session and tool status for an exact background Terra card.",
        input: schema({ session_id: string }, ["session_id"]),
        execute: async (raw, context) => {
          authorized(context.agent)
          const card = own(String(record(raw).session_id), context.sessionID)
          const [session, messages] = await Promise.all([
            ctx.session.get({ sessionID: card.sessionID }),
            ctx.session.context({ sessionID: card.sessionID }),
          ])
          const last = messages
            .flatMap((message) =>
              message.type === "assistant" ? message.content : [],
            )
            .filter((part) => part.type === "tool")
            .at(-1)
          return output(
            [
              `A-Max inspection ${card.sessionID}`,
              `card_status=${card.status}`,
              `runtime_status=${runtimes.get(card.sessionID) || "unknown"}`,
              `last_activity=${new Date(session.time.updated).toISOString()}`,
              `tool=${last?.name || "unknown"}`,
              `tool_status=${last?.state.status || "unknown"}`,
            ].join("\n"),
          )
        },
      })
    })

    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "subagent") return
      const args = record(event.input)
      const parent = event.agent
      const child = text(args.agent) || text(args.subagent_type)
      if (!agents.has(parent) || !child) return
      if (!children[parent]?.includes(child))
        throw new Error(`a-max topology blocks ${parent} -> ${child}`)
      if (child === "runner" && args.background === true)
        throw new Error("a-max requires runner tasks to stay foreground")
      if (child !== "terraworker") return
      const existing = text(args.sessionID) || text(args.task_id)
      if (existing && cards.has(existing)) {
        transition(existing, "working")
        early.delete(existing)
      }
      pending.set(`${event.sessionID}:${event.id}`, {
        description: text(args.description) || "Terra task",
        scope: scope(args.prompt),
      })
    })
    await ctx.tool.hook("execute.after", (event) => {
      if (event.tool !== "subagent") return
      if (event.status !== "completed") {
        pending.delete(`${event.sessionID}:${event.id}`)
        return
      }
      const args = record(event.input)
      const child = text(args.agent) || text(args.subagent_type)
      const result = event.result
      const metadata = record(result.metadata)
      const structured = record(result.output)
      const content =
        typeof result.content === "string"
          ? result.content
          : Array.isArray(result.content)
            ? result.content
                .filter((item) => item.type === "text")
                .map((item) => item.text)
                .join("\n")
            : ""
      const sessionID =
        text(metadata.sessionID) ||
        text(metadata.sessionId) ||
        text(structured.sessionID) ||
        text(args.sessionID) ||
        content.match(/<task id="([^"]+)"/)?.[1] ||
        content.match(/\bses_[a-zA-Z0-9]+\b/)?.[0]
      const captured = pending.get(`${event.sessionID}:${event.id}`)
      pending.delete(`${event.sessionID}:${event.id}`)
      if (child !== "terraworker" || args.background !== true || !sessionID)
        return
      const now = Date.now()
      const previous = cards.get(sessionID)
      const terminal = early.get(sessionID)
      cards.set(sessionID, {
        sessionID,
        parentSessionID: event.sessionID,
        description:
          captured?.description || previous?.description || "Terra task",
        scope: captured?.scope || previous?.scope,
        status: terminal?.status || "working",
        note: terminal?.note,
        startedAt: previous?.startedAt || now,
        updatedAt: now,
      })
      early.delete(sessionID)
    })

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        })) {
          const data = record(event.data)
          const sessionID = text(data.sessionID)
          if (event.type === "session.status" && sessionID) {
            const status = text(record(data.status).type) as RuntimeStatus
            runtimes.set(sessionID, status)
            if (
              status === "busy" &&
              cards.has(sessionID) &&
              cards.get(sessionID)?.status !== "done"
            )
              transition(sessionID, "working")
            if (status === "idle" && cards.has(sessionID))
              transition(sessionID, "review")
          }
          if (event.type === "session.idle" && sessionID) {
            runtimes.set(sessionID, "idle")
            if (cards.has(sessionID)) transition(sessionID, "review")
            else if (pending.size) early.set(sessionID, { status: "review" })
            void recoverParentOnIdle(sessionID)
          }
          if (event.type === "session.execution.failed" && sessionID)
            transition(
              sessionID,
              "blocked",
              String(data.error || "Background task failed"),
            )
          if (event.type === "session.deleted") {
            const id = text(record(data.info).id) || sessionID
            if (id && cards.has(id))
              transition(id, "blocked", "Background session was deleted")
          }
        }
      } catch (error) {
        if (!controller.signal.aborted)
          console.error("A-Max event subscription failed", error)
      }
    })()
    return () => {
      controller.abort()
      cards.clear()
      runtimes.clear()
      pending.clear()
      early.clear()
      wokenFor.clear()
    }
  },
})
