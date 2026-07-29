import plugin from "../max-topology"

const hooks = await plugin({} as never)
if ("tool" in hooks) throw new Error("max topology plugin must not register custom tools")

const start = async (sessionID: string, agent: string) => {
  await hooks["chat.message"]?.(
    { sessionID, agent } as never,
    { message: {}, parts: [{ type: "text", text: "start" }] } as never,
  )
}

const check = async (parent: string, child: string, expected: "allow" | "block") => {
  const sessionID = `${parent}-${child}`
  await start(sessionID, parent)
  let blocked = false
  try {
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID, callID: child } as never,
      { args: { subagent_type: child, prompt: "work" } } as never,
    )
  } catch {
    blocked = true
  }
  if ((expected === "block") !== blocked) {
    throw new Error(`expected ${parent} -> ${child} to ${expected}, blocked=${blocked}`)
  }
}

await check("HTOrchestrator", "terraworker", "allow")
await check("HTOrchestrator", "runner", "allow")
await check("HTOrchestrator", "lunaworker", "block")
await check("terraworker", "runner", "allow")
await check("terraworker", "terraworker", "block")
await check("runner", "terraworker", "block")
await check("runner", "runner", "block")

await start("runner-prompt", "HTOrchestrator")
await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "runner-prompt", callID: "runner" } as never,
  {
    args: {
      subagent_type: "runner",
      prompt: "Explore the max-profile files.",
    },
  } as never,
)

console.log("max-topology-smoke-ok")
