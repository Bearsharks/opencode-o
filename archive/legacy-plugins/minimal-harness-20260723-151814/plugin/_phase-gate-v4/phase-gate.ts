import { tool, type Plugin } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync } from "fs"
import { spawnSync } from "child_process"
import { createHash } from "crypto"
import { dirname } from "path"

const LOG = "/Users/jsp1226/.config/opencode/advisor-state.log"

type AdvisorEvent = "record_advisor_call" | "record_application" | "check_staleness"
type AdvisorAsk = "choose_direction" | "unstick" | "continue_or_replan" | "finalize_claim"

type AdvisorCall = {
  advisor_id: string
  ask?: AdvisorAsk
  advisor_summary: string
  context_digest?: string
  diff_hash: string
  changed_files: string[]
  recorded_at: string
  applied?: boolean
  applied_summary?: string
  application_diff_hash?: string
  applied_at?: string
}

type AdvisorState = {
  directory: string
  worktree: string
  calls: AdvisorCall[]
}

type AdvisorOutput = {
  event: AdvisorEvent
  recorded: boolean
  advisor_id?: string
  latest_advisor_id?: string
  stale: boolean
  needs_reconsult: boolean
  reasons: string[]
  calls: AdvisorCall[]
  changed_files: string[]
  diff_hash: string
}

type Json = Record<string, unknown>

const sessions = new Map<string, AdvisorState>()
const advisorEvents = ["record_advisor_call", "record_application", "check_staleness"] as const
const advisorAsks = ["choose_direction", "unstick", "continue_or_replan", "finalize_claim"] as const

function log(event: Json): void {
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`)
  } catch {}
}

function state(sessionID: string, fallback: { directory: string; worktree: string }): AdvisorState {
  const current = sessions.get(sessionID)
  if (current) return current
  const next: AdvisorState = {
    directory: fallback.directory,
    worktree: fallback.worktree,
    calls: [],
  }
  sessions.set(sessionID, next)
  return next
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function runGit(worktree: string, args: string[]): string {
  const proc = spawnSync("git", ["-C", worktree, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  })
  return `${proc.stdout || ""}${proc.stderr || ""}`.trim()
}

function changedFiles(worktree: string): string[] {
  return runGit(worktree, ["status", "--short"])
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.replace(/^[ MARCUD?!]{1,2}\s+/, ""))
    .map((line) => line.split(" -> ").at(-1) || line)
}

function diffHash(worktree: string): string {
  const status = runGit(worktree, ["status", "--short"])
  const diff = runGit(worktree, ["diff", "--no-ext-diff", "--"])
  return createHash("sha256").update(`${status}\n${diff}`).digest("hex").slice(0, 16)
}

function latestCall(current: AdvisorState, advisorID?: string): AdvisorCall | undefined {
  if (advisorID) return current.calls.find((call) => call.advisor_id === advisorID)
  return current.calls.at(-1)
}

function recordAdvisorCall(current: AdvisorState, args: Json): { reasons: string[]; advisorID?: string } {
  const advisorSummary = asString(args.advisor_summary)
  if (!advisorSummary) return { reasons: ["record_advisor_call requires advisor_summary"] }
  const advisorID = `advisor_${current.calls.length + 1}_${Date.now().toString(36)}`
  current.calls.push({
    advisor_id: advisorID,
    ask: enumValue(args.ask, advisorAsks, "choose_direction"),
    advisor_summary: advisorSummary,
    context_digest: asString(args.context_digest),
    diff_hash: diffHash(current.worktree),
    changed_files: changedFiles(current.worktree),
    recorded_at: new Date().toISOString(),
  })
  return { reasons: [], advisorID }
}

function recordApplication(current: AdvisorState, args: Json): { reasons: string[]; advisorID?: string } {
  const call = latestCall(current, asString(args.advisor_id))
  if (!call) return { reasons: ["record_application requires an existing advisor call"] }
  const appliedSummary = asString(args.applied_summary)
  if (!appliedSummary) return { reasons: ["record_application requires applied_summary"] }
  call.applied = true
  call.applied_summary = appliedSummary
  call.application_diff_hash = diffHash(current.worktree)
  call.applied_at = new Date().toISOString()
  return { reasons: [], advisorID: call.advisor_id }
}

function staleness(current: AdvisorState, advisorID?: string): { stale: boolean; reasons: string[]; latest?: AdvisorCall } {
  const call = latestCall(current, advisorID)
  if (!call) return { stale: false, reasons: ["no advisor call recorded"] }
  const reference = call.application_diff_hash || call.diff_hash
  const currentHash = diffHash(current.worktree)
  if (reference === currentHash) return { stale: false, reasons: [], latest: call }
  return {
    stale: true,
    reasons: ["diff changed after the latest advisor application; consider re-consulting before broad final claims"],
    latest: call,
  }
}

function output(event: AdvisorEvent, current: AdvisorState, reasons: string[], advisorID?: string): AdvisorOutput {
  const stale = staleness(current, advisorID)
  return {
    event,
    recorded: reasons.length === 0,
    advisor_id: advisorID,
    latest_advisor_id: current.calls.at(-1)?.advisor_id,
    stale: stale.stale,
    needs_reconsult: stale.stale,
    reasons: [...reasons, ...stale.reasons],
    calls: current.calls.slice(-10),
    changed_files: changedFiles(current.worktree),
    diff_hash: diffHash(current.worktree),
  }
}

export default (async ({ directory, worktree }) => {
  log({ event: "plugin_loaded", directory, worktree })
  return {
    tool: {
      advisor_state: tool({
        description:
          "Records advisor calls, how driver applied advisor guidance, and whether the latest advisor judgment is stale relative to the current diff.",
        args: {
          event: tool.schema.enum(["record_advisor_call", "record_application", "check_staleness"]),
          ask: tool.schema.enum(["choose_direction", "unstick", "continue_or_replan", "finalize_claim"]).optional(),
          advisor_id: tool.schema.string().optional(),
          advisor_summary: tool.schema.string().optional(),
          applied_summary: tool.schema.string().optional(),
          context_digest: tool.schema.string().optional(),
        },
        execute: async (args, context) => {
          const current = state(context.sessionID, {
            directory: context.directory || directory,
            worktree: context.worktree || worktree || directory,
          })
          current.directory = context.directory || current.directory
          current.worktree = context.worktree || current.worktree

          const input = args as Json
          const event = enumValue(input.event, advisorEvents, "check_staleness")
          const result =
            event === "record_advisor_call"
              ? recordAdvisorCall(current, input)
              : event === "record_application"
                ? recordApplication(current, input)
                : { reasons: [], advisorID: asString(input.advisor_id) }
          const final = output(event, current, result.reasons, result.advisorID)
          log({ event: "advisor_state", sessionID: context.sessionID, result: final })
          return JSON.stringify(final, null, 2)
        },
      }),
    },
  }
}) satisfies Plugin
