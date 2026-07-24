import { tool, type Plugin } from "@opencode-ai/plugin"

const READ_BUDGET_LINES = 600
const READ_BUDGET_CHARS = 25_000
const mutatingTools = ["edit", "write", "apply_patch"]
const advisorAsks = ["choose_direction", "unstick", "continue_or_replan", "finalize_claim"] as const

type Json = Record<string, unknown>
type AdvisorAsk = (typeof advisorAsks)[number]
type AdvisorSession = {
  task_id?: string
  consulted: boolean
}
type ReadUsage = {
  lines: number
  chars: number
}
type ReadBudget = ReadUsage & {
  allocation_count: number
  charge_count: number
}

const advisorSessions = new Map<string, AdvisorSession>()
const readBudgets = new Map<string, ReadBudget>()
const probeReadUsage = new Map<string, ReadUsage>()

function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function advisorSession(sessionID: string): AdvisorSession {
  const current = advisorSessions.get(sessionID)
  if (current) return current
  const next = { consulted: false }
  advisorSessions.set(sessionID, next)
  return next
}

function advisorAsk(prompt: string): AdvisorAsk | undefined {
  const value = prompt
    .trimStart()
    .match(/^\{\s*"ask"\s*:\s*"(choose_direction|unstick|continue_or_replan|finalize_claim)"\s*\}(?:\r?\n|$)/)?.[1]
  return advisorAsks.includes(value as AdvisorAsk) ? (value as AdvisorAsk) : undefined
}

function taskID(output: string, metadata: unknown): string | undefined {
  return asString(asRecord(metadata)?.sessionId) || output.match(/<task id="([^"]+)"/)?.[1]
}

function taskResponse(output: string): Json | undefined {
  const content = output.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/)?.[1] || output
  const unfenced = content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "")
  const start = unfenced.indexOf("{")
  const end = unfenced.lastIndexOf("}")
  if (start === -1 || end <= start) return
  try {
    return asRecord(JSON.parse(unfenced.slice(start, end + 1)))
  } catch {
    return
  }
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

function chargeReadBudget(
  sessionID: string,
  result: { output: string },
  usage: ReadUsage,
  large: boolean,
): void {
  const budget = readBudgets.get(sessionID)
  if (!budget) return
  const previousRatio = Math.min(budget.lines / READ_BUDGET_LINES, budget.chars / READ_BUDGET_CHARS)
  budget.lines = Math.max(0, budget.lines - usage.lines)
  budget.chars = Math.max(0, budget.chars - usage.chars)
  budget.charge_count += 1
  const remainingRatio = Math.min(budget.lines / READ_BUDGET_LINES, budget.chars / READ_BUDGET_CHARS)
  const exhausted = budget.lines === 0 || budget.chars === 0
  const milestone = [0.75, 0.5, 0.25, 0.1, 0].some(
    (threshold) => previousRatio > threshold && remainingRatio <= threshold,
  )
  if (budget.charge_count !== 1 && !milestone && !large) return
  result.output += exhausted
    ? "\n\n[read budget exhausted — call advisor_state(allocate_read_budget)]"
    : `\n\n[read budget: ${budget.lines}L, ${Math.ceil(budget.chars / 1_000)}K chars left]`
}

export default (async () => ({
  tool: {
    advisor_state: tool({
      description: "Adds the requested amount to the driver's read-awareness budget for a stated investigation strategy.",
      args: {
        event: tool.schema.literal("allocate_read_budget"),
        reason: tool.schema.string(),
        strategy: tool.schema.string(),
        requested_lines: tool.schema.number(),
        requested_chars: tool.schema.number(),
      },
      execute: async (args, context) => {
        if (context.agent !== "driver") throw new Error("advisor_state is restricted to driver")
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
        const budget = readBudgets.get(context.sessionID) || {
          lines: READ_BUDGET_LINES,
          chars: READ_BUDGET_CHARS,
          allocation_count: 0,
          charge_count: 0,
        }
        budget.lines += requestedLines
        budget.chars += requestedChars
        budget.allocation_count += 1
        readBudgets.set(context.sessionID, budget)
        return JSON.stringify({
          event: "allocate_read_budget",
          allocated_lines: requestedLines,
          allocated_chars: requestedChars,
          remaining_lines: budget.lines,
          remaining_chars: budget.chars,
          allocation_count: budget.allocation_count,
        })
      },
    }),
  },

  "chat.message": async (input, result) => {
    if (input.agent === "probe-code") {
      if (!probeReadUsage.has(input.sessionID)) probeReadUsage.set(input.sessionID, { lines: 0, chars: 0 })
      return
    }
    if (input.agent !== "driver" || readBudgets.has(input.sessionID)) return
    if (result.parts.length > 0 && result.parts.every((part) => "synthetic" in part && part.synthetic === true)) return
    readBudgets.set(input.sessionID, {
      lines: READ_BUDGET_LINES,
      chars: READ_BUDGET_CHARS,
      allocation_count: 0,
      charge_count: 0,
    })
  },

  "tool.execute.before": async (input, result) => {
    if (input.agent !== "driver") return
    if (input.tool === "task") {
      const args = asRecord(result.args)
      if (args?.subagent_type !== "advisor") return
      if (!advisorAsk(asString(args.prompt) || "")) {
        throw new Error('advisor-state blocked advisor call: first line must be {"ask":"..."}')
      }
      const current = advisorSession(input.sessionID)
      const requestedTaskID = asString(args.task_id)
      if (!current.task_id && requestedTaskID) {
        throw new Error("advisor-state requires a new advisor task for the first consultation")
      }
      if (!current.task_id || requestedTaskID === current.task_id) return
      throw new Error(`advisor-state requires continuing advisor task_id: ${current.task_id}`)
    }
    if (!mutatingTools.includes(input.tool)) return
    if (advisorSession(input.sessionID).consulted) return
    throw new Error("advisor-state blocked this mutation: consult advisor successfully before editing")
  },

  "tool.execute.after": async (input, result) => {
    if (input.agent !== "driver" && input.agent !== "probe-code") return
    if (input.tool === "read") {
      const content = readContent(result.output)
      const usage = { lines: content ? content.split(/\r?\n/).length : 0, chars: content?.length || 0 }
      const probeUsage = probeReadUsage.get(input.sessionID)
      if (probeUsage) {
        probeUsage.lines += usage.lines
        probeUsage.chars += usage.chars
        return
      }
      chargeReadBudget(input.sessionID, result, usage, usage.lines >= 500 || usage.chars >= 20_000)
      return
    }
    if (input.tool !== "task") return
    const args = asRecord(input.args)
    if (args?.subagent_type === "probe-code") {
      const childTaskID = taskID(result.output, result.metadata)
      if (!childTaskID) return
      const usage = probeReadUsage.get(childTaskID) || { lines: 0, chars: 0 }
      probeReadUsage.delete(childTaskID)
      if (!readBudgets.has(input.sessionID)) return
      chargeReadBudget(
        input.sessionID,
        result,
        { lines: Math.ceil(usage.lines / 4), chars: Math.ceil(usage.chars / 4) },
        usage.lines >= 500 || usage.chars >= 20_000,
      )
      return
    }
    if (args?.subagent_type !== "advisor") return
    const current = advisorSession(input.sessionID)
    const childTaskID = taskID(result.output, result.metadata)
    if (!childTaskID) throw new Error("advisor-state could not observe the advisor task_id")
    if (current.task_id && current.task_id !== childTaskID) {
      throw new Error(`advisor-state observed a different advisor task_id; continue ${current.task_id}`)
    }
    current.task_id = childTaskID
    const response = taskResponse(result.output)
    if (!asString(response?.decision) || !asString(response?.summary)) {
      throw new Error(`advisor-state rejected advisor response; retry with task_id: ${childTaskID}`)
    }
    current.consulted = true
  },
})) satisfies Plugin
