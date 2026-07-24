import { tool, type Plugin } from "@opencode-ai/plugin"

const READ_BUDGET_LINES = 600
const READ_BUDGET_CHARS = 25_000
const PROBE_SESSION_TITLE = "harness:probe"
const agents = new Set(["orchestrator", "terraworker", "lunaworker", "probe"])
const budgetAgents = new Set(["orchestrator", "terraworker", "lunaworker"])
const workers = new Set(["terraworker", "lunaworker"])
const probeDiscountDivisor = {
  orchestrator: 10,
  terraworker: 5,
  lunaworker: 2,
} as const

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
const sessionAgents = new Map<string, string>()
const probeSlots = new Map<string, Promise<string>>()

const investigationSchema = tool.schema.object({
  scope_searched: tool.schema.array(tool.schema.string()),
  findings: tool.schema.array(
    tool.schema.object({
      claim: tool.schema.string(),
      evidence: tool.schema.array(tool.schema.string()),
      confidence: tool.schema.enum(["exact", "partial"]),
    }),
  ),
  counterexamples: tool.schema.array(tool.schema.string()),
  not_verified: tool.schema.array(tool.schema.string()),
  direct_verification_candidates: tool.schema.array(tool.schema.string()),
})

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

function allowedChild(parent: string, child: string) {
  return parent === "orchestrator" && workers.has(child)
}

function investigationText(args: {
  question: string
  scope: string[]
  expected_evidence: string[]
  verification_goal?: string
}) {
  return [
    "Investigate the following request within the exact assigned scope.",
    `Question: ${args.question}`,
    `Scope: ${JSON.stringify(args.scope)}`,
    `Expected evidence: ${JSON.stringify(args.expected_evidence)}`,
    `Verification goal: ${args.verification_goal || "Map evidence and explicit gaps for the caller."}`,
    "Reuse prior findings in this session. Do not reread unchanged evidence unless revalidation is necessary.",
    "counterexamples, not_verified, and direct_verification_candidates must be arrays of strings, never objects.",
    "Return only the JSON object required by your agent instructions, without a code fence.",
  ].join("\n")
}

function parseInvestigation(output: string) {
  const trimmed = output.trim()
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed
  const json = parseJSON(unfenced)
  if (!json.success) {
    return {
      schema_valid: false,
      schema_warnings: [{ path: "", message: "Probe returned malformed JSON" }],
      probe_result_text: output,
    }
  }
  const parsed = investigationSchema.safeParse(json.data)
  if (parsed.success) return { schema_valid: true, probe_result: parsed.data }
  return {
    schema_valid: false,
    schema_warnings: parsed.error.issues.map((issue) => ({
      path: issue.path.reduce(
        (path, part) => (typeof part === "number" ? `${path}[${part}]` : path ? `${path}.${String(part)}` : String(part)),
        "",
      ),
      message: issue.message,
    })),
    probe_result: json.data,
  }
}

function parseJSON(input: string) {
  try {
    return { success: true as const, data: JSON.parse(input) as unknown }
  } catch {
    return { success: false as const }
  }
}

export default (async ({ client }) => {
  const resolveProbeSession = (parentSessionID: string, directory: string, signal: AbortSignal) => {
    const current = probeSlots.get(parentSessionID)
    if (current) return current
    const pending = (async () => {
      const children = await client.session.children({
        path: { id: parentSessionID },
        query: { directory },
        signal,
        throwOnError: true,
      })
      const existing = children.data.find((session) => session.title === PROBE_SESSION_TITLE)
      if (existing) {
        sessionAgents.set(existing.id, "probe")
        return existing.id
      }
      const created = await client.session.create({
        body: { parentID: parentSessionID, title: PROBE_SESSION_TITLE },
        query: { directory },
        signal,
        throwOnError: true,
      })
      sessionAgents.set(created.data.id, "probe")
      return created.data.id
    })()
    probeSlots.set(parentSessionID, pending)
    pending.catch(() => {
      if (probeSlots.get(parentSessionID) === pending) probeSlots.delete(parentSessionID)
    })
    return pending
  }

  return {
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
          if (!budgetAgents.has(context.agent)) {
            throw new Error("harness_state is restricted to orchestrator, terraworker, and lunaworker")
          }
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
      investigate: tool({
        description:
          "Investigates broad or uncertain code evidence in one reusable Probe session owned by the current caller session.",
        args: {
          question: tool.schema.string().min(1),
          scope: tool.schema.array(tool.schema.string().min(1)).min(1),
          expected_evidence: tool.schema.array(tool.schema.string().min(1)).min(1),
          verification_goal: tool.schema.string().min(1).optional(),
        },
        execute: async (args, context) => {
          if (!budgetAgents.has(context.agent)) {
            throw new Error("investigate is restricted to orchestrator, terraworker, and lunaworker")
          }
          const probeSessionID = await resolveProbeSession(context.sessionID, context.directory, context.abort)
          turnReadUsage.delete(probeSessionID)
          const response = await client.session.prompt({
            path: { id: probeSessionID },
            query: { directory: context.directory },
            body: {
              agent: "probe",
              parts: [{ type: "text", text: investigationText(args) }],
            },
            signal: context.abort,
            throwOnError: true,
          })
          const output = response.data.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
          const parsed = parseInvestigation(output)
          const usage = turnReadUsage.get(probeSessionID) || { lines: 0, chars: 0 }
          turnReadUsage.delete(probeSessionID)
          const divisor = probeDiscountDivisor[context.agent as keyof typeof probeDiscountDivisor]
          const result = {
            title: `Investigate via Probe (${probeSessionID})`,
            output: JSON.stringify(parsed),
            metadata: { probeSessionID },
          }
          chargeReadBudget(
            context.sessionID,
            result,
            {
              lines: Math.ceil(usage.lines / divisor),
              chars: Math.ceil(usage.chars / divisor),
            },
            usage.lines >= 500 || usage.chars >= 20_000,
          )
          return result
        },
      }),
    },

    "chat.message": async (input, result) => {
      if (!input.agent || !agents.has(input.agent)) return
      sessionAgents.set(input.sessionID, input.agent)
      if (result.parts.length > 0 && result.parts.every((part) => "synthetic" in part && part.synthetic === true)) return
      if (budgetAgents.has(input.agent)) budget(input.sessionID)
      if (!turnReadUsage.has(input.sessionID)) turnReadUsage.set(input.sessionID, { lines: 0, chars: 0 })
    },

    "tool.execute.before": async (input, result) => {
      if (input.tool !== "task") return
      const parent = sessionAgents.get(input.sessionID)
      if (!parent || !agents.has(parent)) return
      const child = asString(asRecord(result.args)?.subagent_type)
      if (!child) return
      if (!allowedChild(parent, child)) throw new Error(`minimal harness blocks ${parent} -> ${child}`)
    },

    "tool.execute.after": async (input, result) => {
      const parent = sessionAgents.get(input.sessionID)
      if (input.tool === "read") {
        if (!parent || !agents.has(parent)) return
        const content = readContent(result.output)
        const usage = { lines: content ? content.split(/\r?\n/).length : 0, chars: content?.length || 0 }
        if (parent === "probe") {
          addTurnUsage(input.sessionID, usage)
          return
        }
        chargeReadBudget(input.sessionID, result, usage, usage.lines >= 500 || usage.chars >= 20_000)
        return
      }
      if (input.tool !== "task" || !parent) return
      const child = asString(asRecord(input.args)?.subagent_type)
      if (!child || !allowedChild(parent, child)) return
      const childSessionID = taskID(result.output, result.metadata)
      if (!childSessionID) throw new Error(`minimal harness could not observe the ${child} task_id`)
      const usage = turnReadUsage.get(childSessionID) || { lines: 0, chars: 0 }
      turnReadUsage.delete(childSessionID)
      chargeReadBudget(
        input.sessionID,
        result,
        { lines: Math.ceil(usage.lines / 4), chars: Math.ceil(usage.chars / 4) },
        usage.lines >= 500 || usage.chars >= 20_000,
      )
    },
  }
}) satisfies Plugin
