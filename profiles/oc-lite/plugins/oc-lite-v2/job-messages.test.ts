import { test, expect } from "bun:test"
import { deliverNotice, arrivalText, reconnectSessions, currentNoticeSession } from "./job-messages"

test("an old shared transport cannot label peer notices as Aria", async () => {
  const calls: any[] = []
  const session = currentNoticeSession({ prompt: async (value: any) => { calls.push(value) } } as any)
  await session.prompt({ text: "[아리아 메시지 알림]", metadata: { job_message_notice: 539 } } as any)
  expect(calls[0].text.startsWith("[작업 메시지 알림 · idx 539]")).toBe(true)
  await session.prompt({ text: "ordinary user input" } as any)
  expect(calls[1].text).toBe("ordinary user input")
})

const notice = { idx: 42, sessionId: "job_" + "a".repeat(32), nativeSessionId: "ses_worker0001",
  inputId: "msg_" + "b".repeat(32), lease: "private-lease" }

function context(overrides: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>()
  const calls: any[] = []
  return { calls, storage, ctx: {
    location: { directory: "/owned/work" },
    storage: { async get(key: string) { return storage.get(key) }, async set(key: string, value: unknown) { storage.set(key, value) } },
    session: {
      async get() { return { id: notice.nativeSessionId, location: { directory: "/owned/work" }, agent: "worker", time: {}, ...overrides } },
      async prompt(input: any) { calls.push(input); return { id: input.id, sessionID: input.sessionID, type: "user", delivery: input.delivery, payload: { text: input.text } } },
    },
  } as any }
}

test("uses native steer on the exact session and never forwards the body", async () => {
  const fake = context()
  expect(await deliverNotice(fake.ctx, { ...notice, body: "PRIVATE REPLY" } as any)).toBe("steered")
  expect(fake.calls).toEqual([{ sessionID: notice.nativeSessionId, id: notice.inputId,
    text: arrivalText(42), delivery: "steer", metadata: { job_message_notice: 42 } }])
  expect(JSON.stringify(fake.calls)).not.toContain("PRIVATE REPLY")
  expect(await deliverNotice(fake.ctx, notice)).toBe("steered")
  expect(fake.calls.length).toBe(1)
})

test("unknown native delivery is not retried after losing the receipt", async () => {
  const fake = context()
  fake.ctx.session.prompt = async (input: any) => { fake.calls.push(input); throw new Error("connection lost") }
  expect(await deliverNotice(fake.ctx, notice)).toBe("unknown")
  expect(await deliverNotice(fake.ctx, notice)).toBe("unknown")
  expect(fake.calls.length).toBe(1)
})

test("a persisted sending marker prevents crash replay", async () => {
  const fake = context()
  fake.storage.set(`job-messages/notice/${notice.sessionId}/${notice.idx}`, "sending")
  expect(await deliverNotice(fake.ctx, notice)).toBe("unknown")
  expect(fake.calls).toEqual([])
})

test("does not send to a different session, subagent, archived session, or agent", async () => {
  for (const change of [{ id: "ses_other0001" },
    { parentID: "ses_parent0001" }, { time: { archived: 1 } }, { agent: "runner" }]) {
    const fake = context(change)
    expect(await deliverNotice(fake.ctx, notice)).toBe("retry")
    expect(fake.calls).toEqual([])
  }
})

test("delivers on the same process after a directory or workspace move", async () => {
  for (const location of [{ directory: "/new/worktree" }, { directory: "/owned/work", workspaceID: "new-workspace" }]) {
    const fake = context({ location })
    expect(await deliverNotice(fake.ctx, notice)).toBe("steered")
    expect(fake.calls[0].sessionID).toBe(notice.nativeSessionId)
  }
})

test("invalid routing does not reach OpenCode", async () => {
  const fake = context()
  await expect(deliverNotice(fake.ctx, { ...notice, nativeSessionId: "guessed" })).rejects.toThrow()
  expect(fake.calls).toEqual([])
})

test("reconnects only the original worker in this exact location", async () => {
  for (const change of [{}, { id: "ses_other0001" }, { location: { directory: "/other" } },
    { location: { directory: "/owned/work", workspaceID: "other-workspace" } },
    { parentID: "ses_parent0001" }, { time: { archived: 1 } }, { agent: "runner" }]) {
    const fake = context(change)
    const calls: unknown[] = []
    const candidate = { sessionId: notice.sessionId, nativeSessionId: notice.nativeSessionId }
    await reconnectSessions(fake.ctx, [candidate], async (route) => { calls.push(route) })
    expect(calls).toEqual(Object.keys(change).length ? [] : [candidate])
    expect(fake.calls).toEqual([])
  }
})

test("one unreadable session does not block reconnecting the others", async () => {
  const fake = context()
  const get = fake.ctx.session.get
  fake.ctx.session.get = async (input: any) => {
    if (input.sessionID === "ses_missing0001") throw new Error("not found")
    return get()
  }
  const calls: unknown[] = []
  await reconnectSessions(fake.ctx, [
    { sessionId: "job_" + "c".repeat(32), nativeSessionId: "ses_missing0001" }, notice,
  ], async (route) => { calls.push(route.nativeSessionId) })
  expect(calls).toEqual([notice.nativeSessionId])
})


test("review mode hides the MCP catalog while controller APIs and default Aria mode remain available", async () => {
  const { setupJobMessages } = await import("./job-messages")
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  for (const exposeModelTools of [true, false]) {
    const root = await mkdtemp("/tmp/oc-message-visibility-")
    const requests: any[] = []
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
      const body = await req.json() as any
      requests.push(body)
      return Response.json(body.method === "tools/call"
        ? { result: { structuredContent: { success: true } } } : { sessions: [] })
    } })
    let detach: (() => void) | undefined
    try {
      await writeFile(root + "/token", "fixture-token-".repeat(6), { mode: 0o600 })
      await writeFile(root + "/settings.json", JSON.stringify({ configFile: root + "/service.json",
        stdio: root + "/stdio.py", baseUrl: `http://127.0.0.1:${server.port}/`, tokenFile: root + "/token" }))
      const mcp = new Map<string, any>()
      const tools = new Map(["job_messages_createSession", "job_messages_sendMessage",
        "job_messages_completeJob", "job_messages_readAgentMessages", "job_messages_readPeerMessages",
        "job_messages_sendPeerMessage", "freefy_request_review", "shell", "subagent"].map(id => [id, { id }]))
      const fake = context()
      const ctx = { ...fake.ctx,
        tool: { hook: async () => {}, transform: async (apply: any) => apply({
          list: () => [...tools.values()], remove: (id: string) => tools.delete(id),
        }) },
        mcp: { transform: async (apply: any) => apply({
          get: (name: string) => mcp.get(name), set: (name: string, value: any) => mcp.set(name, value),
          remove: (name: string) => mcp.delete(name),
        }) },
      }
      detach = await setupJobMessages(ctx as any, { configPath: root + "/settings.json", exposeModelTools,
        connected: async channel => {
          for (const name of ["createSession", "sendPeerMessage", "readPeerMessages"])
            await channel.call("ses_fixture0001", name, {})
        } })
      expect(mcp.has("job_messages")).toBe(true)
      expect(tools.has("job_messages_createSession")).toBe(exposeModelTools)
      expect([...tools.keys()].filter(id => id.startsWith("job_messages_")).length).toBe(exposeModelTools ? 6 : 0)
      for (const id of ["freefy_request_review", "shell", "subagent"]) expect(tools.has(id)).toBe(true)
      expect(requests.filter(row => row.method === "tools/call").map(row => row.params.name))
        .toEqual(["createSession", "sendPeerMessage", "readPeerMessages"])
    } finally { detach?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
  }
})
