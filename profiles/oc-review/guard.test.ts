import { test, expect } from "bun:test"
import { Effect } from "effect"
import guard from "./plugins/review-guard"

test("queue readers remain callable without Code Mode, arbitrary executors stay blocked", async () => {
  const tools = new Map<string, any>([
    ["job_messages_readPeerMessages", { options: { codemode: true } }],
    ["job_messages_createSession", { options: { codemode: true } }],
    ["job_messages_completeJob", {}], ["shell", {}], ["execute", {}],
    ["freefy_review_read", {}],
  ])
  const hooks = new Map<string, any>()
  const ctx = {
    tool: {
      transform: (fn: any) => Effect.sync(() => fn({
        list: () => [...tools].map(([id, tool]) => ({ ...tool, id })),
        remove: (id: string) => tools.delete(id),
        update: (id: string, fn: any) => { if (tools.has(id)) fn(tools.get(id)) },
      })),
      hook: (name: string, fn: any) => Effect.sync(() => hooks.set(name, fn)),
    },
    session: { hook: (name: string, fn: any) => Effect.sync(() => hooks.set(name, fn)) },
  }
  await Effect.runPromise(guard.effect(ctx))
  expect(tools.get("job_messages_readPeerMessages").options.codemode).toBe(false)
  expect(tools.has("execute")).toBe(false)
  expect(tools.has("job_messages_completeJob")).toBe(false)
  await Effect.runPromise(hooks.get("execute.before")({ agent: "worker", tool: "job_messages_readPeerMessages" }))
  for (const tool of ["execute", "shell", "patch", "subagent", "job_messages_completeJob"]) {
    const result = await Effect.runPromise(Effect.exit(hooks.get("execute.before")({ agent: "worker", tool })))
    expect(result._tag).toBe("Failure")
  }
})
