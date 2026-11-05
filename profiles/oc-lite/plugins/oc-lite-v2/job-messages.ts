import { readFile, stat, lstat, mkdir, chmod } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve, join } from "node:path"
import { createServer } from "node:http"
import { unlinkSync } from "node:fs"
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import type { Context } from "@opencode/plugin/promise/plugin"

type Notice = { idx: number; sessionId: string; nativeSessionId: string; inputId: string }
type Reconnect = Pick<Notice, "sessionId" | "nativeSessionId">
type Outcome = "steered" | "unknown" | "retry"

function primaryWorker(session: Awaited<ReturnType<Context["session"]["get"]>>, nativeId: string) {
  return session.id === nativeId && !session.parentID && session.time.archived === undefined
    && (session.agent === undefined || session.agent === "worker")
}

function ownedSession(ctx: Pick<Context, "location">, session: Awaited<ReturnType<Context["session"]["get"]>>, nativeId: string) {
  return primaryWorker(session, nativeId)
    && resolve(session.location.directory) === resolve(ctx.location.directory)
    && session.location.workspaceID === ctx.location.workspaceID
}

export async function reconnectSessions(ctx: Pick<Context, "session" | "location">, candidates: Reconnect[],
  reconnect: (candidate: Reconnect) => Promise<unknown>, signal?: AbortSignal) {
  if (!Array.isArray(candidates) || candidates.length > 100) throw new Error("Invalid reconnect batch")
  for (const candidate of candidates) {
    if (signal?.aborted) break
    if (!candidate || !/^job_[a-f0-9]{32}$/.test(candidate.sessionId)
      || !/^ses_[A-Za-z0-9]{8,128}$/.test(candidate.nativeSessionId)) throw new Error("Invalid reconnect route")
    try {
      const session = await ctx.session.get({ sessionID: candidate.nativeSessionId as any }, {
        signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) })
      if (ownedSession(ctx, session, candidate.nativeSessionId)) await reconnect(candidate)
    } catch {
      // Missing sessions, transient reads, or a still-live owner must not block other sessions.
    }
  }
}

export function arrivalText(idx: number) {
  return `[작업 메시지 알림 · idx ${idx}] 새 메시지가 도착했습니다. 발신자는 큐에서 확인하세요. 검수 메시지는 검수 전용 수신함으로 읽으며, 이 알림은 Aria 발신이나 완료 판정을 뜻하지 않습니다.`
}

export function currentNoticeSession(session: Context["session"]): Context["session"] {
  return new Proxy(session, { get(target, key) {
    if (key !== "prompt") return Reflect.get(target, key)
    return (input: any, ...rest: any[]) => {
      const idx = input.metadata?.job_message_notice
      return (target.prompt as any)(Number.isSafeInteger(idx) && idx > 0
        ? { ...input, text: arrivalText(idx) } : input, ...rest)
    }
  } })
}

export async function deliverNotice(ctx: Pick<Context, "session" | "storage">, notice: Notice): Promise<Outcome> {
  if (!Number.isSafeInteger(notice.idx) || notice.idx < 1 || !/^job_[a-f0-9]{32}$/.test(notice.sessionId)
    || !/^ses_[A-Za-z0-9]{8,128}$/.test(notice.nativeSessionId) || !/^msg_[a-f0-9]{32}$/.test(notice.inputId))
    throw new Error("Invalid arrival notice")
  const key = `job-messages/notice/${notice.sessionId}/${notice.idx}`
  const previous = await ctx.storage.get(key)
  if (previous === "steered") return "steered"
  if (previous === "sending" || previous === "unknown") return "unknown"
  let session
  try { session = await ctx.session.get({ sessionID: notice.nativeSessionId as any }, { signal: AbortSignal.timeout(10000) }) } catch { return "retry" }
  if (!primaryWorker(session, notice.nativeSessionId)) return "retry"
  await ctx.storage.set(key, "sending")
  try {
    const receipt = await ctx.session.prompt({ sessionID: notice.nativeSessionId as any,
      id: notice.inputId as any, text: arrivalText(notice.idx), delivery: "steer",
      metadata: { job_message_notice: notice.idx } }, { signal: AbortSignal.timeout(10000) })
    if (receipt.id !== notice.inputId || receipt.sessionID !== notice.nativeSessionId || receipt.delivery !== "steer"
      || receipt.type !== "user" || receipt.payload.text !== arrivalText(notice.idx)) throw new Error("Unconfirmed native notice")
    await ctx.storage.set(key, "steered")
    return "steered"
  } catch {
    await ctx.storage.set(key, "unknown")
    return "unknown"
  }
}

type Settings = { configFile: string; stdio: string; baseUrl: string; tokenFile: string }
type Native = Pick<Context, "session" | "storage">
type ProcessConnection = Awaited<ReturnType<typeof startConnection>>
// The plugin is loaded per location. Keep the connection on the process across module reloads.
const registryKey = Symbol.for("oc-lite.job-messages.process.v1")
const host = process as typeof process & { [registryKey]?: Map<string, Promise<ProcessConnection>> }
const connections = host[registryKey] ??= new Map()

async function startConnection(ctx: Context, url: URL, token: string) {
  const runtimeId = randomUUID()
  const stop = new AbortController()
  const request = async (path: string, data: unknown, signal = stop.signal) => {
    const response = await fetch(new URL(path, url), { method: "POST", redirect: "error",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(data), signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]) })
    if (!response.ok) throw new Error("Job Messages service unavailable")
    const value = await response.json() as any
    if (value.error) throw new Error("Job Messages operation rejected")
    return value
  }
  let native: Native = { session: ctx.session, storage: ctx.storage }
  const locations = new Set<Pick<Context, "location" | "session">>()
  const credential = Buffer.from("Bearer " + createHmac("sha256", token).update(runtimeId).digest("hex"))
  const directory = join("/tmp", "oc-lite-jobs-" + process.getuid!())
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const dir = await lstat(directory)
  if (!dir.isDirectory() || dir.uid !== process.getuid!() || (dir.mode & 0o077))
    throw new Error("Unsafe Job Messages socket directory")
  const socket = join(directory, runtimeId + ".sock")
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? "")
    if (req.method !== "POST" || req.url !== "/steer" || supplied.length !== credential.length
      || !timingSafeEqual(supplied, credential)) { res.writeHead(403).end(); return }
    try {
      let body = ""
      for await (const chunk of req) {
        body += chunk
        if (body.length > 2048) { res.writeHead(413).end(); return }
      }
      const outcome = await deliverNotice(native, JSON.parse(body))
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ outcome }))
    } catch { res.writeHead(500).end() }
  })
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(socket, done) })
  server.unref()
  const removeSocket = () => { try { unlinkSync(socket) } catch { /* already removed on close */ } }
  process.once("exit", removeSocket)
  let timer: ReturnType<typeof setTimeout> | undefined
  async function heartbeat() {
    let afterSessionId: string | undefined
    do {
      const page = await request("/oc/processes", { runtimeId, afterSessionId })
      // Only recovery after a process exit uses the loaded locations as evidence.
      for (const location of locations) {
        await reconnectSessions(location, page.sessions,
          (candidate) => request("/oc/sessions/reconnect", { runtimeId, ...candidate }), stop.signal)
      }
      const next = page.nextSessionId
      if (next != null && (typeof next !== "string" || !/^job_[a-f0-9]{32}$/.test(next)
        || (afterSessionId !== undefined && next <= afterSessionId))) throw new Error("Invalid reconnect cursor")
      afterSessionId = next ?? undefined
    } while (afterSessionId && !stop.signal.aborted)
  }
  async function tick() {
    let delay = 20000
    try { await heartbeat() } catch { delay = 3000 }
    if (!stop.signal.aborted) { timer = setTimeout(tick, delay); timer.unref() }
  }
  async function close() {
    stop.abort()
    clearTimeout(timer)
    server.close()
    process.removeListener("exit", removeSocket)
    removeSocket()
    try { await request("/oc/runtimes/release", { runtimeId }, AbortSignal.timeout(3000)) } catch {}
  }
  try {
    await chmod(socket, 0o600)
    // Register before exposing the MCP tools, including when a new folder loads immediately.
    // An offline PM2 must not prevent OpenCode from starting. The heartbeat retries.
    await request("/oc/processes", { runtimeId }, AbortSignal.timeout(2000)).catch(() => {})
  } catch (error) { await close(); throw error }
  return { runtimeId, async call(nativeSessionId: string, name: string, arguments_: Record<string, unknown>) {
    const response = await request("/agent/mcp", { jsonrpc: "2.0", id: randomUUID(), method: "tools/call",
      params: { name, arguments: arguments_, _meta: {
        "ai.opencode/sessionID": nativeSessionId, "sessionmanager/runtimeId": runtimeId,
      } } })
    const result = response.result?.structuredContent
    if (!result?.success) throw new Error(result?.error || "Job Messages call failed")
    return result
  }, attach(context: Context) {
    native = { session: context.session, storage: context.storage }
    const location = { session: context.session, location: context.location }
    locations.add(location)
    if (!timer) { timer = setTimeout(tick, 0); timer.unref() }
    return () => { locations.delete(location) }
  } }
}

export async function setupJobMessages(ctx: Context, options: {
  required?: boolean,
  configPath?: string,
  connected?: (transport: Pick<ProcessConnection, "runtimeId" | "call">) => void | Promise<void>,
} = {}) {
  const configPath = options.configPath || process.env.OPENCODE_JOB_MESSAGES_CONFIG || join(homedir(), "Documents/SessionManager/state/job-messages/oc-lite.json")
  let settings: Settings
  try { settings = JSON.parse(await readFile(configPath, "utf8")) }
  catch (error: any) { if (error?.code === "ENOENT" && !options.required) return; throw new Error("Invalid Job Messages configuration") }
  const url = new URL(settings.baseUrl)
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/"
    || url.search || url.hash) throw new Error("Job Messages requires a loopback URL")
  const info = await stat(settings.tokenFile)
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
    throw new Error("Job Messages token must be private to this user")
  const token = (await readFile(settings.tokenFile, "utf8")).trim()
  if (token.length < 40) throw new Error("Invalid Job Messages token")
  const key = JSON.stringify([resolve(settings.configFile), url.href, createHmac("sha256", token).update("config").digest("hex")])
  let pending = connections.get(key)
  if (!pending) {
    pending = startConnection(ctx, url, token)
    connections.set(key, pending)
    pending.catch(() => connections.delete(key))
  }
  const connection = await pending
  const runtimeId = connection.runtimeId
  await ctx.mcp.transform((editor) => {
    const command = ["/usr/bin/python3", "-B", settings.stdio, "--config", settings.configFile,
      "--role", "agent", "--runtime-id", runtimeId]
    const existing = editor.get("job_messages")
    if (existing && JSON.stringify((existing as any).command) !== JSON.stringify(command))
      throw new Error("Conflicting job_messages MCP configuration")
    editor.set("job_messages", { type: "local", command, protocol: "legacy" })
  })
  await ctx.tool.hook("execute.before", (event) => {
    if (event.tool.startsWith("job_messages_") && event.agent !== "worker")
      throw new Error("Job Messages belongs to the primary worker")
  })
   // Refresh wording even when the shared connection predates this module.
   const detach = connection.attach({ ...ctx, session: currentNoticeSession(ctx.session) })
  try { await options.connected?.({ runtimeId, async call(nativeSessionId, name, arguments_) {
    // A shared process may retain a connection created before this module reload.
    // Build the caller here; do not require a service restart to add its method.
    const response = await fetch(new URL("/agent/mcp", url), { method: "POST", redirect: "error",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: {
        name, arguments: arguments_, _meta: { "ai.opencode/sessionID": nativeSessionId, "sessionmanager/runtimeId": runtimeId },
      } }), signal: AbortSignal.timeout(35000) })
    const value = await response.json() as any
    const result = value.result?.structuredContent
    if (!response.ok || !result?.success) throw new Error(result?.error || "Job Messages call failed")
    return result
  } }) } catch (error) { detach(); throw error }
  return detach
}
