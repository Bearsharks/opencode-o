import { test, expect } from "bun:test"
import { Effect } from "effect"
import guard from "./plugins/review-guard"

test("only review tools remain callable; Aria and raw messaging tools stay blocked", async () => {
  const tools = new Map<string, any>([
    ["job_messages_readPeerMessages", { options: { codemode: true } }],
    ["job_messages_createSession", { options: { codemode: true } }],
    ["job_messages_completeJob", {}], ["shell", {}], ["execute", {}],
    ["freefy_review_inbox", {}], ["freefy_review_read", {}],
    ["freefy_review_list", {}], ["freefy_review_search", {}], ["freefy_review_check", {}], ["freefy_review_submit", {}],
    ["job_messages_sendMessage", {}], ["job_messages_readAgentMessages", {}], ["job_messages_sendPeerMessage", {}],
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
  expect(tools.has("job_messages_readPeerMessages")).toBe(false)
  expect(tools.has("job_messages_createSession")).toBe(false)
  expect([...tools.keys()].sort()).toEqual(["freefy_review_inbox", "freefy_review_read", "freefy_review_list",
    "freefy_review_search", "freefy_review_check", "freefy_review_submit"].sort())
  expect(tools.has("execute")).toBe(false)
  expect(tools.has("job_messages_completeJob")).toBe(false)
  await Effect.runPromise(hooks.get("execute.before")({ agent: "worker", tool: "freefy_review_inbox" }))
  for (const tool of ["execute", "shell", "patch", "subagent", "job_messages_completeJob", "job_messages_sendMessage", "job_messages_readAgentMessages", "job_messages_createSession", "job_messages_readPeerMessages", "job_messages_sendPeerMessage"]) {
    const result = await Effect.runPromise(Effect.exit(hooks.get("execute.before")({ agent: "worker", tool })))
    expect(result._tag).toBe("Failure")
  }
})
