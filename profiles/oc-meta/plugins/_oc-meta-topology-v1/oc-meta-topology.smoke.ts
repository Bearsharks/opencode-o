import plugin from "../oc-meta-topology"

const hooks = await plugin({} as never)
if ("tool" in hooks) throw new Error("oc-meta topology plugin must not register custom tools")

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

await check("MetaOrchestrator", "runner", "allow")
await check("MetaOrchestrator", "MetaOrchestrator", "block")
await check("MetaOrchestrator", "worker", "block")
await check("MetaOrchestrator", "terraworker", "block")
await check("MetaOrchestrator", "HTOrchestrator", "block")
await check("runner", "runner", "block")
await check("runner", "MetaOrchestrator", "block")

await start("MetaOrchestrator-prompt", "MetaOrchestrator")
await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "MetaOrchestrator-prompt", callID: "runner" } as never,
  {
    args: {
      subagent_type: "runner",
      prompt: "Explore the oc-meta files.",
    },
  } as never,
)

console.log("oc-meta-topology-smoke-ok")
