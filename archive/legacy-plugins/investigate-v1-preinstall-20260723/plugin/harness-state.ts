import { tool, type Plugin } from "@opencode-ai/plugin"

const READ_BUDGET_LINES = 600
const READ_BUDGET_CHARS = 25_000
const agents = new Set(["orchestrator", "terraworker", "lunaworker", "probe"])
const workers = new Set(["terraworker", "lunaworker"])

type Json = Record<string, unknown>
type ReadUsage = {
  lines: number
  chars: number
}
type ReadBudget = ReadUsage & {
  allocation_count: number
  charge_count: number
}

const readBudgets = new Map<string, ReadBudget>()
const turnReadUsage = new Map<string, ReadUsage>()
const childTasks = new Map<string, Map<string, string>>()

function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function readContent(output: string): string | undefined {
  const start = output.indexOf("<content>")
  const end = output.lastIndexOf("</content>")
  if (start === -1 || end <= start) return
  return output
    .slice(start + "<content>".length, end)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "")
}

function initialBudget(): ReadBudget {
  return {
    lines: READ_BUDGET_LINES,
    chars: READ_BUDGET_CHARS,
    allocation_count: 0,
    charge_count: 0,
  }
}

function budget(sessionID: string) {
  const current = readBudgets.get(sessionID)
  if (current) return current
  const next = initialBudget()
  readBudgets.set(sessionID, next)
  return next
}

function addTurnUsage(sessionID: string, usage: ReadUsage) {
  const current = turnReadUsage.get(sessionID) || { lines: 0, chars: 0 }
  current.lines += usage.lines
  current.chars += usage.chars
  turnReadUsage.set(sessionID, current)
}

function chargeReadBudget(
  sessionID: string,
  result: { output: string },
  usage: ReadUsage,
  large: boolean,
) {
  const current = readBudgets.get(sessionID)
  if (!current || (usage.lines === 0 && usage.chars === 0)) return
  const previousRatio = Math.min(current.lines / READ_BUDGET_LINES, current.chars / READ_BUDGET_CHARS)
  current.lines = Math.max(0, current.lines - usage.lines)
  current.chars = Math.max(0, current.chars - usage.chars)
  current.charge_count += 1
  addTurnUsage(sessionID, usage)
  const remainingRatio = Math.min(current.lines / READ_BUDGET_LINES, current.chars / READ_BUDGET_CHARS)
  const exhausted = current.lines === 0 || current.chars === 0
  const milestone = [0.75, 0.5, 0.25, 0.1, 0].some(
    (threshold) => previousRatio > threshold && remainingRatio <= threshold,
  )
  if (current.charge_count !== 1 && !milestone && !large) return
  result.output += exhausted
    ? "\n\n[read budget exhausted — call harness_state(allocate_read_budget)]"
    : `\n\n[read budget: ${current.lines}L, ${Math.ceil(current.chars / 1_000)}K chars left]`
}

function taskID(output: string, metadata: unknown): string | undefined {
  return asString(asRecord(metadata)?.sessionId) || output.match(/<task id="([^"]+)"/)?.[1]
}

function childTask(parentSessionID: string, child: string) {
  return childTasks.get(parentSessionID)?.get(child)
}

function rememberChildTask(parentSessionID: string, child: string, childTaskID: string) {
  const current = childTasks.get(parentSessionID) || new Map<string, string>()
  current.set(child, childTaskID)
  childTasks.set(parentSessionID, current)
}

function allowedChild(parent: string, child: string) {
  if (parent === "orchestrator") return child === "terraworker" || child === "lunaworker" || child === "probe"
  if (workers.has(parent)) return child === "probe"
  return false
}

export default (async () => ({
  tool: {
    harness_state: tool({
      description: "Adds read budget to the current harness agent for a stated reading strategy.",
      args: {
        event: tool.schema.literal("allocate_read_budget"),
        reason: tool.schema.string(),
        strategy: tool.schema.string(),
        requested_lines: tool.schema.number(),
        requested_chars: tool.schema.number(),
      },
      execute: async (args, context) => {
        if (!agents.has(context.agent)) throw new Error("harness_state is restricted to minimal harness agents")
        const input = args as Json
        const reason = asString(input.reason)
        const strategy = asString(input.strategy)
        const requestedLines = Number(input.requested_lines)
        const requestedChars = Number(input.requested_chars)
        if (
          !reason ||
          !strategy ||
          !Number.isInteger(requestedLines) ||
          requestedLines <= 0 ||
          !Number.isInteger(requestedChars) ||
          requestedChars <= 0
        ) {
          throw new Error(
            "allocate_read_budget requires reason, strategy, and positive integer requested_lines/requested_chars",
          )
        }
        const current = budget(context.sessionID)
        current.lines += requestedLines
        current.chars += requestedChars
        current.allocation_count += 1
        return JSON.stringify({
          event: "allocate_read_budget",
          agent: context.agent,
          allocated_lines: requestedLines,
          allocated_chars: requestedChars,
          remaining_lines: current.lines,
          remaining_chars: current.chars,
          allocation_count: current.allocation_count,
        })
      },
    }),
  },

  "chat.message": async (input, result) => {
    if (!input.agent || !agents.has(input.agent)) return
    if (result.parts.length > 0 && result.parts.every((part) => "synthetic" in part && part.synthetic === true)) return
    budget(input.sessionID)
    if (!turnReadUsage.has(input.sessionID)) turnReadUsage.set(input.sessionID, { lines: 0, chars: 0 })
  },

  "tool.execute.before": async (input, result) => {
    if (input.tool !== "task") return
    const args = asRecord(result.args)
    const child = asString(args?.subagent_type)
    if (!child) return
    if (!allowedChild(input.agent, child)) throw new Error(`minimal harness blocks ${input.agent} -> ${child}`)

    const current = childTask(input.sessionID, child)
    if (!current) return
    const requested = asString(args?.task_id)
    if (requested && requested !== current) {
      throw new Error(`minimal harness requires continuing ${child} task_id: ${current}`)
    }
    if (args) args.task_id = current
  },

  "tool.execute.after": async (input, result) => {
    if (input.tool === "read") {
      const content = readContent(result.output)
      const usage = { lines: content ? content.split(/\r?\n/).length : 0, chars: content?.length || 0 }
      chargeReadBudget(input.sessionID, result, usage, usage.lines >= 500 || usage.chars >= 20_000)
      return
    }
    if (input.tool !== "task") return
    const args = asRecord(input.args)
    const child = asString(args?.subagent_type)
    if (!child || !allowedChild(input.agent, child)) return
    const childTaskID = taskID(result.output, result.metadata)
    if (!childTaskID) throw new Error(`minimal harness could not observe the ${child} task_id`)
    const requested = asString(args?.task_id)
    if (requested && requested !== childTaskID) {
      throw new Error(`minimal harness resumed ${requested} but observed ${childTaskID}`)
    }
    const current = childTask(input.sessionID, child)
    if (current && current !== childTaskID) {
      throw new Error(`minimal harness observed a different ${child} task_id; continue ${current}`)
    }
    rememberChildTask(input.sessionID, child, childTaskID)
    const usage = turnReadUsage.get(childTaskID) || { lines: 0, chars: 0 }
    turnReadUsage.delete(childTaskID)
    chargeReadBudget(
      input.sessionID,
      result,
      { lines: Math.ceil(usage.lines / 4), chars: Math.ceil(usage.chars / 4) },
      usage.lines >= 500 || usage.chars >= 20_000,
    )
  },
})) satisfies Plugin
