import type { Plugin } from "@opencode-ai/plugin"

const agents = new Set(["HTOrchestrator", "terraworker", "runner"])
const allowedChildren = {
  HTOrchestrator: new Set(["terraworker", "runner"]),
  terraworker: new Set(["runner"]),
  runner: new Set<string>(),
} as const

type Json = Record<string, unknown>

const sessionAgents = new Map<string, string>()

function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function allowedChild(parent: string, child: string) {
  if (!(parent in allowedChildren)) return false
  return allowedChildren[parent as keyof typeof allowedChildren].has(child)
}

export default (async () => ({
  "chat.message": async (input) => {
    if (!input.agent || !agents.has(input.agent)) return
    sessionAgents.set(input.sessionID, input.agent)
  },

  "tool.execute.before": async (input, result) => {
    if (input.tool !== "task") return
    const parent = sessionAgents.get(input.sessionID)
    if (!parent || !agents.has(parent)) return
    const child = asString(asRecord(result.args)?.subagent_type)
    if (!child) return
    if (!allowedChild(parent, child)) throw new Error(`a-max topology blocks ${parent} -> ${child}`)
  },
})) satisfies Plugin
