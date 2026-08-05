import plugin from "../oc-lite-topology"

const hooks = await plugin({} as never)
if ("tool" in hooks) throw new Error("oc-lite topology plugin must not register custom tools")

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

await check("worker", "runner", "allow")
await check("worker", "worker", "block")
await check("worker", "terraworker", "block")
await check("runner", "runner", "block")
await check("runner", "worker", "block")

await start("worker-prompt", "worker")
await hooks["tool.execute.before"]?.(
  { tool: "task", sessionID: "worker-prompt", callID: "runner" } as never,
  {
    args: {
      subagent_type: "runner",
      prompt: "Explore the oc-lite files.",
    },
  } as never,
)

console.log("oc-lite-topology-smoke-ok")
