import type { Plugin } from "@opencode-ai/plugin"
import { spawn, spawnSync } from "child_process"
import { appendFileSync, existsSync, mkdirSync } from "fs"
import { dirname, join } from "path"
import { createHash } from "crypto"

const CODEX_HOME = process.env.CODEX_HOME || "/Users/jsp1226/.codex"
const ROOT = join(CODEX_HOME, "self-improvement")
const HOOK = join(ROOT, "hooks", "self-improvement", "self_improvement_hook.py")
const STOP = join(ROOT, "hooks", "turn-history", "stop.sh")
const LOG = join(ROOT, "logs", "opencode-bridge.log")
const STOP_DELAY_MS = Number(process.env.AGENT_TURN_HISTORY_OPENCODE_STOP_DELAY_MS || "1000")

type Json = Record<string, unknown>

type SessionState = {
  started: boolean
  cwd: string
  sessionContext?: string
  sessionContextInjected: boolean
  pendingUserMessageID?: string
  processedTurns: Set<string>
}

const sessions = new Map<string, SessionState>()

function log(message: string): void {
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`)
  } catch {}
}

function asRecord(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function state(sessionID: string, cwd: string): SessionState {
  let current = sessions.get(sessionID)
  if (!current) {
    current = { started: false, cwd, sessionContextInjected: false, processedTurns: new Set() }
    sessions.set(sessionID, current)
  }
  if (cwd) current.cwd = cwd
  return current
}

function runCodexHook(event: "session-start" | "user-prompt-submit", payload: Json): string {
  if (!existsSync(HOOK)) return ""
  const proc = spawnSync("/usr/bin/python3", [HOOK, event], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME },
    timeout: 10_000,
  })
  if (proc.error) {
    log(`hook ${event} error=${proc.error.message}`)
    return ""
  }
  if (proc.status !== 0) log(`hook ${event} status=${proc.status} stderr=${proc.stderr}`)
  try {
    const parsed = JSON.parse(proc.stdout || "{}")
    const output = parsed?.hookSpecificOutput?.additionalContext
    return typeof output === "string" ? output : ""
  } catch (error) {
    log(`hook ${event} parse_error=${error instanceof Error ? error.message : String(error)}`)
    return ""
  }
}

function ensureStarted(sessionID: string, cwd: string): SessionState {
  const current = state(sessionID, cwd)
  if (!current.started) {
    current.started = true
    current.sessionContext = runCodexHook("session-start", {
      session_id: `opencode-${sessionID}`,
      opencode_session_id: sessionID,
      cwd: current.cwd,
    })
    log(`session-start session=${sessionID} context=${current.sessionContext ? "yes" : "no"}`)
  }
  return current
}

function syntheticPart(sessionID: string, messageID: string, index: number, text: string): Json {
  return {
    id: `prt_self_improvement_${hash(`${sessionID}:${messageID}:${index}:${text}`)}`,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
    metadata: { source: "codex-self-improvement" },
  }
}

function injectContexts(input: { sessionID: string; messageID?: string }, output: { message: Json; parts: unknown[] }, current: SessionState): void {
  const messageID = input.messageID || String(output.message.id || "")
  if (!messageID) return

  const contexts: string[] = []
  if (!current.sessionContextInjected) {
    current.sessionContextInjected = true
    if (current.sessionContext) contexts.push(current.sessionContext)
  }

  const promptContext = runCodexHook("user-prompt-submit", {
    session_id: `opencode-${input.sessionID}`,
    opencode_session_id: input.sessionID,
    cwd: current.cwd,
  })
  if (promptContext) contexts.push(promptContext)

  contexts.forEach((context, index) => output.parts.push(syntheticPart(input.sessionID, messageID, index, context)))
}

function runStop(sessionID: string, turnID: string, current: SessionState): void {
  if (!existsSync(STOP)) {
    log(`stop missing path=${STOP}`)
    return
  }
  const payload = {
    session_id: `opencode-${sessionID}`,
    opencode_session_id: sessionID,
    turn_id: turnID,
    cwd: current.cwd,
    transcript_format: "opencode-storage",
  }
  log(`schedule stop session=${sessionID} turn=${turnID} cwd=${current.cwd}`)
  setTimeout(() => {
    const env = { ...process.env, CODEX_HOME }
    delete env.AGENT_TURN_HISTORY_IN_STOP_WORKER
    const child = spawn(STOP, ["--payload-json", JSON.stringify(payload)], {
      detached: true,
      stdio: "ignore",
      env,
    })
    log(`spawned stop session=${sessionID} turn=${turnID} pid=${child.pid || ""}`)
    child.unref()
  }, Number.isFinite(STOP_DELAY_MS) && STOP_DELAY_MS >= 0 ? STOP_DELAY_MS : 1000)
}

function opencodeDbPath(): string {
  if (process.env.OPENCODE_DB_PATH) return process.env.OPENCODE_DB_PATH
  const dataHome = process.env.XDG_DATA_HOME || join(process.env.HOME || "", ".local", "share")
  return join(dataHome, "opencode", "opencode.db")
}

function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function queryJson<T extends Json>(query: string): T[] {
  const db = opencodeDbPath()
  if (!existsSync(db)) return []
  const proc = spawnSync("sqlite3", ["-json", db, query], {
    encoding: "utf8",
    timeout: 5_000,
  })
  if (proc.error) {
    log(`sqlite error=${proc.error.message}`)
    return []
  }
  if (proc.status !== 0) {
    log(`sqlite status=${proc.status} stderr=${proc.stderr}`)
    return []
  }
  try {
    const parsed = JSON.parse(proc.stdout || "[]")
    return Array.isArray(parsed) ? parsed.filter((item) => asRecord(item)) as T[] : []
  } catch (error) {
    log(`sqlite parse_error=${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

function latestUserMessageID(sessionID: string): string {
  const rows = queryJson<{ id?: string }>(`
    select id
    from message
    where session_id = ${sql(sessionID)}
      and json_extract(data, '$.role') = 'user'
    order by time_created desc, id desc
    limit 1
  `)
  return typeof rows[0]?.id === "string" ? rows[0].id : ""
}

function latestFinalAssistantID(sessionID: string, userMessageID: string): string {
  if (!userMessageID) return ""
  const rows = queryJson<{ id?: string; finish?: string }>(`
    select id, json_extract(data, '$.finish') as finish
    from message
    where session_id = ${sql(sessionID)}
      and json_extract(data, '$.role') = 'assistant'
      and json_extract(data, '$.parentID') = ${sql(userMessageID)}
      and json_extract(data, '$.time.completed') is not null
      and coalesce(json_extract(data, '$.finish'), '') <> 'tool-calls'
    order by time_created desc, id desc
    limit 1
  `)
  const row = rows[0]
  if (!row || typeof row.id !== "string") return ""
  log(`final assistant session=${sessionID} user=${userMessageID} assistant=${row.id} finish=${String(row.finish || "")}`)
  return row.id
}

function maybeCwd(properties: Json, fallback: string): string {
  const location = asRecord(properties.location)
  const info = asRecord(properties.info)
  if (typeof location?.cwd === "string") return location.cwd
  if (typeof info?.directory === "string") return info.directory
  if (typeof properties.cwd === "string") return properties.cwd
  return fallback
}

function eventSessionID(event: Json, properties: Json): string {
  const info = asRecord(properties.info)
  if (typeof properties.sessionID === "string") return properties.sessionID
  if (typeof info?.id === "string") return info.id
  if (typeof properties.id === "string") return properties.id
  if (typeof event.aggregateID === "string") return event.aggregateID
  if (typeof event.aggregate_id === "string") return event.aggregate_id
  return ""
}

export default (async ({ directory }) => {
  log(`plugin loaded directory=${directory}`)
  return {
    config: async () => {
      log("config hook called")
    },

    "chat.message": async (input: { sessionID: string; messageID?: string }, output: { message: Json; parts: unknown[] }) => {
      const messageID = input.messageID || String(output.message.id || "")
      log(`chat.message session=${input.sessionID} message=${messageID}`)
      const current = ensureStarted(input.sessionID, directory)
      if (messageID) current.pendingUserMessageID = messageID
      injectContexts(input, output, current)
    },

    event: async (input: { event: Json }) => {
      const event = input.event
      const properties = asRecord(event.properties) || asRecord(event.payload) || {}
      const sessionID = eventSessionID(event, properties)
      if (!sessionID) return

      const type = String(event.type || "").replace(/\.\d+$/, "")
      if (type === "session.created") {
        ensureStarted(sessionID, maybeCwd(properties, directory))
        return
      }

      const current = state(sessionID, maybeCwd(properties, directory))
      if (type === "session.next.moved") current.cwd = maybeCwd(properties, current.cwd)
      if (type !== "session.idle") {
        return
      }

      const userMessageID = current.pendingUserMessageID || latestUserMessageID(sessionID)
      if (!userMessageID) {
        log(`idle without user message session=${sessionID}`)
        return
      }
      const key = `${sessionID}:${userMessageID}`
      if (current.processedTurns.has(key)) return
      const assistantID = latestFinalAssistantID(sessionID, userMessageID)
      if (!assistantID) {
        log(`idle without final assistant session=${sessionID} user=${userMessageID}`)
        return
      }

      log(`turn finished event=${type} session=${sessionID} user=${userMessageID} assistant=${assistantID}`)
      current.processedTurns.add(key)
      runStop(sessionID, assistantID, current)
    },
  }
}) satisfies Plugin
