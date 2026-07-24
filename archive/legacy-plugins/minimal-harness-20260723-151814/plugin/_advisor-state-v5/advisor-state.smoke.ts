import plugin from "./advisor-state"

const hooks = await plugin({} as never)

await hooks["tool.execute.before"]?.(
  { tool: "edit", sessionID: "owner", callID: "edit", agent: "driver" } as never,
  { args: {} } as never,
)

let malformedAskBlocked = false
try {
  await hooks["tool.execute.before"]?.(
    { tool: "task", sessionID: "owner", callID: "bad-ask", agent: "driver" } as never,
    { args: { subagent_type: "advisor", prompt: "ask=choose_direction" } } as never,
  )
} catch {
  malformedAskBlocked = true
}

if (!malformedAskBlocked) throw new Error("v5 no longer validates advisor calls")
