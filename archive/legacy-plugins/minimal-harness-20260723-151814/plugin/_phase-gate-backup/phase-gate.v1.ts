import { tool, type Plugin } from "@opencode-ai/plugin"
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import { spawnSync } from "child_process"
import { dirname, isAbsolute, relative, resolve } from "path"

const LOG = "/Users/jsp1226/.config/opencode/phase-gate.log"
const VALIDATION_PATTERN = /\b(test|lint|typecheck|build|tsc|pytest|vitest|jest|diff --check)\b/i
const SHELL_CONTROL_PATTERN = /(\|\||&&|[|;<>])/

type GateEvent = "start" | "submit_plan" | "submit_review" | "resolve_action" | "submit_final"
type WorkKind = "edit" | "readonly" | "reflection"
type Level = "simple" | "standard" | "complex"
type Review = "plan" | "mid" | "final"
type Decision = "approve" | "approve_with_notes" | "request_more_evidence" | "request_tests" | "replan" | "block"
type RequiredAction = "none" | "apply_notes" | "provide_more_evidence" | "run_more_validation" | "replan" | "stop"
type GateStatus =
  | "idle"
  | "started"
  | "plan_review_pending"
  | "working"
  | "mid_review_pending"
  | "final_review_pending"
  | "done"
  | "blocked"

type ValidationRun = {
  command: string
  status: "pending" | "passed" | "failed" | "ambiguous"
  exit_code?: number
  started_at: string
  finished_at?: string
}

type ReviewState = {
  decision: Decision
  assessed_level?: Level
  required_action: RequiredAction
  notes: string[]
  resolved: boolean
}

type PendingAction = {
  review: Review
  action: Exclude<RequiredAction, "none">
  notes: string[]
  validation_checkpoint?: number
}

type GateState = {
  status: GateStatus
  directory: string
  worktree: string
  work_kind?: WorkKind
  proposed_level?: Level
  assessed_level?: Level
  planned_targets?: string[]
  baseline_status_files?: string[]
  validation_runs: ValidationRun[]
  reviews: Partial<Record<Review, ReviewState>>
  pending_action?: PendingAction
}

type GateOutput = {
  event: GateEvent
  status: GateStatus
  ok_to_continue: boolean
  ok_to_edit: boolean
  ok_to_finalize: boolean
  reasons: string[]
  work_kind?: WorkKind
  proposed_level?: Level
  assessed_level?: Level
  current_level: Level
  planned_targets?: string[]
  preexisting_files: string[]
  changed_files: string[]
  unplanned_changed_files?: string[]
  validation_runs: ValidationRun[]
  reviews: Partial<Record<Review, ReviewState>>
  pending_action?: PendingAction
}

type Json = Record<string, unknown>

const sessions = new Map<string, GateState>()

function log(event: Json): void {
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`)
  } catch {}
}

function asRecord(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  const items = asStringArray(value)
  return items.length > 0 ? items : undefined
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback
}

function hasField(args: Json, field: string): boolean {
  return Object.hasOwn(args, field)
}

function validateEnumField<T extends string>(args: Json, field: string, allowed: readonly T[]): string[] {
  if (!hasField(args, field)) return [`${String(args.event)} requires ${field}`]
  const value = args[field]
  if (typeof value === "string" && allowed.includes(value as T)) return []
  return [`${String(args.event)} has invalid ${field}`]
}

function rejectFields(args: Json, fields: string[]): string[] {
  return fields.filter((field) => hasField(args, field)).map((field) => `${String(args.event)} does not accept ${field}`)
}

function validateEventInput(args: Json): string[] {
  const event = args.event
  if (typeof event !== "string") return ["event is required"]
  if (!["start", "submit_plan", "submit_review", "resolve_action", "submit_final"].includes(event)) {
    return ["event is invalid"]
  }
  if (event === "start") {
    return [
      ...validateEnumField(args, "work_kind", ["edit", "readonly", "reflection"] as const),
      ...validateEnumField(args, "proposed_level", ["simple", "standard", "complex"] as const),
      ...rejectFields(args, ["assessed_level", "review", "decision", "required_action", "resolved_action", "notes", "validation_summary"]),
    ]
  }
  if (event === "submit_plan") {
    return [
      ...validateEnumField(args, "work_kind", ["edit", "readonly", "reflection"] as const),
      ...validateEnumField(args, "proposed_level", ["standard", "complex"] as const),
      ...rejectFields(args, ["assessed_level", "review", "decision", "required_action", "resolved_action", "notes", "validation_summary"]),
    ]
  }
  if (event === "submit_review") {
    return [
      ...validateEnumField(args, "review", ["plan", "mid", "final"] as const),
      ...validateEnumField(args, "decision", ["approve", "approve_with_notes", "request_more_evidence", "request_tests", "replan", "block"] as const),
      ...validateEnumField(args, "required_action", ["none", "apply_notes", "provide_more_evidence", "run_more_validation", "replan", "stop"] as const),
      ...validateEnumField(args, "assessed_level", ["simple", "standard", "complex"] as const),
      ...rejectFields(args, ["work_kind", "proposed_level", "planned_targets", "resolved_action"]),
    ]
  }
  if (event === "resolve_action") {
    return [
      ...validateEnumField(args, "review", ["plan", "mid", "final"] as const),
      ...validateEnumField(args, "resolved_action", ["apply_notes", "provide_more_evidence", "run_more_validation", "replan"] as const),
      ...rejectFields(args, ["work_kind", "proposed_level", "assessed_level", "decision", "required_action", "planned_targets", "notes"]),
    ]
  }
  return rejectFields(args, [
    "work_kind",
    "proposed_level",
    "assessed_level",
    "review",
    "decision",
    "required_action",
    "resolved_action",
    "planned_targets",
    "notes",
  ])
}

function normalizeFile(file: string, root: string): string {
  const absolute = isAbsolute(file) ? file : resolve(root, file)
  return relative(root, absolute).replaceAll("\\", "/")
}

function state(sessionID: string, fallback: { directory: string; worktree: string }): GateState {
  const current = sessions.get(sessionID)
  if (current) return current
  const next: GateState = {
    status: "idle",
    directory: fallback.directory,
    worktree: fallback.worktree,
    validation_runs: [],
    reviews: {},
  }
  sessions.set(sessionID, next)
  return next
}

function runGit(worktree: string, args: string[]): string {
  const proc = spawnSync("git", ["-C", worktree, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  })
  return `${proc.stdout || ""}${proc.stderr || ""}`.trim()
}

function gitStatusFiles(status: string): string[] {
  return status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const pathText = line.slice(3)
      const renamed = pathText.split(" -> ")
      return renamed.length === 2 ? [renamed[1]] : [pathText]
    })
}

function listFiles(dir: string, worktree: string): string[] {
  const absolute = resolve(worktree, dir)
  if (!existsSync(absolute)) return [dir]
  const stat = statSync(absolute)
  if (!stat.isDirectory()) return [dir]
  const entries = readdirSync(absolute, { withFileTypes: true })
  const files = entries.flatMap((entry) => {
    const next = `${dir}${entry.name}${entry.isDirectory() ? "/" : ""}`
    return entry.isDirectory() ? listFiles(next, worktree) : [next]
  })
  return files.length > 0 ? files : [dir]
}

function statusFiles(status: string, worktree: string): string[] {
  return Array.from(
    new Set(gitStatusFiles(status).flatMap((file) => (file.endsWith("/") ? listFiles(file, worktree) : [file]))),
  )
}

function currentStatusFiles(current: GateState): string[] {
  return statusFiles(runGit(current.worktree, ["status", "--short"]), current.worktree)
}

function ensureBaseline(current: GateState): void {
  if (current.baseline_status_files) return
  current.baseline_status_files = currentStatusFiles(current)
}

function changedSinceBaseline(files: string[], baseline?: string[]): string[] {
  if (!baseline) return []
  const previous = new Set(baseline)
  return files.filter((file) => !previous.has(file))
}

function matchesTarget(file: string, target: string): boolean {
  if (target === file) return true
  if (target.endsWith("/") && file.startsWith(target)) return true
  if (!target.includes("*")) return false
  const pattern = `^${target.split("*").map(escapeRegExp).join(".*")}$`
  return new RegExp(pattern).test(file)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function unplannedFiles(changed: string[], targets?: string[]): string[] | undefined {
  if (!targets) return undefined
  return changed.filter((file) => !targets.some((target) => matchesTarget(file, target)))
}

function isAmbiguousValidationCommand(command: string): boolean {
  return SHELL_CONTROL_PATTERN.test(command)
}

function reviewPassed(review?: ReviewState): boolean {
  if (!review) return false
  if (review.decision === "approve") return true
  return review.decision === "approve_with_notes" && review.resolved
}

function currentLevel(current: GateState): Level {
  return current.assessed_level || current.proposed_level || "standard"
}

function canEdit(current: GateState): boolean {
  if (current.status === "blocked" || current.status === "done") return false
  const level = currentLevel(current)
  if (level === "simple") return current.status === "started" || current.status === "working" || reviewPassed(current.reviews.plan)
  if (level === "standard") return reviewPassed(current.reviews.plan)
  if (level === "complex") return reviewPassed(current.reviews.plan)
  return false
}

function setStarted(current: GateState, args: Json): void {
  ensureBaseline(current)
  current.work_kind = enumValue(args.work_kind, ["edit", "readonly", "reflection"] as const, "edit")
  current.proposed_level = enumValue(args.proposed_level, ["simple", "standard", "complex"] as const, "standard")
  current.planned_targets = asOptionalStringArray(args.planned_targets)?.map((file) => normalizeFile(file, current.worktree))
  current.status = current.proposed_level === "simple" ? "working" : "started"
}

function submitPlan(current: GateState, args: Json): string[] {
  ensureBaseline(current)
  current.work_kind = enumValue(args.work_kind, ["edit", "readonly", "reflection"] as const, "edit")
  current.proposed_level = enumValue(args.proposed_level, ["standard", "complex"] as const, "standard")
  current.planned_targets = asOptionalStringArray(args.planned_targets)?.map((file) => normalizeFile(file, current.worktree))
  current.status = "plan_review_pending"
  return []
}

function submitReview(current: GateState, args: Json): string[] {
  const review = enumValue(args.review, ["plan", "mid", "final"] as const, "final")
  const decision = enumValue(
    args.decision,
    ["approve", "approve_with_notes", "request_more_evidence", "request_tests", "replan", "block"] as const,
    "block",
  )
  const requiredAction = enumValue(
    args.required_action,
    ["none", "apply_notes", "provide_more_evidence", "run_more_validation", "replan", "stop"] as const,
    "stop",
  )
  const notes = asStringArray(args.notes)
  const assessedLevel = enumValue(args.assessed_level, ["simple", "standard", "complex"] as const, current.assessed_level || current.proposed_level || "standard")
  const reasons = validateReviewEvent(current, review, decision, requiredAction)
  if (reasons.length > 0) return reasons

  current.assessed_level = assessedLevel
  current.reviews[review] = {
    decision,
    assessed_level: assessedLevel,
    required_action: requiredAction,
    notes,
    resolved: requiredAction === "none",
  }
  if (requiredAction === "none") {
    current.pending_action = undefined
    current.status = review === "final" ? "done" : "working"
    return []
  }
  current.pending_action = {
    review,
    action: requiredAction,
    notes,
    validation_checkpoint: requiredAction === "run_more_validation" ? current.validation_runs.length : undefined,
  }
  current.status = decision === "block" || requiredAction === "stop" ? "blocked" : reviewStatus(review)
  return []
}

function validateReviewEvent(current: GateState, review: Review, decision: Decision, requiredAction: RequiredAction): string[] {
  if (current.status === "blocked") return ["workflow is blocked"]
  if (decision === "block" && requiredAction !== "stop") return ["block decision must use required_action=stop"]
  if (decision === "approve" && requiredAction !== "none") return ["approve must use required_action=none"]
  if (decision === "approve_with_notes" && requiredAction !== "apply_notes") {
    return ["approve_with_notes must use required_action=apply_notes"]
  }
  if (decision === "request_more_evidence" && requiredAction !== "provide_more_evidence") {
    return ["request_more_evidence must use required_action=provide_more_evidence"]
  }
  if (decision === "request_tests" && requiredAction !== "run_more_validation") {
    return ["request_tests must use required_action=run_more_validation"]
  }
  if (decision === "replan" && requiredAction !== "replan") return ["replan must use required_action=replan"]
  const level = currentLevel(current)
  if (review === "plan" && current.proposed_level === "simple") return ["simple work has no plan review"]
  if (review === "mid" && level !== "complex") return ["mid review is only part of complex work"]
  if (review === "mid" && !reviewPassed(current.reviews.plan)) return ["complex mid review requires passed plan review"]
  if (review === "final" && level === "standard" && !reviewPassed(current.reviews.plan)) {
    return ["standard final review requires passed plan review"]
  }
  if (review === "final" && level === "complex" && !reviewPassed(current.reviews.mid)) {
    return ["complex final review requires passed mid review"]
  }
  return []
}

function reviewStatus(review: Review): GateStatus {
  if (review === "plan") return "plan_review_pending"
  if (review === "mid") return "mid_review_pending"
  return "final_review_pending"
}

function resolveAction(current: GateState, args: Json): string[] {
  const pending = current.pending_action
  if (!pending) return ["no pending action to resolve"]
  const review = enumValue(args.review, ["plan", "mid", "final"] as const, pending.review)
  const resolvedAction = enumValue(
    args.resolved_action,
    ["apply_notes", "provide_more_evidence", "run_more_validation", "replan"] as const,
    pending.action === "stop" ? "replan" : pending.action,
  )
  if (review !== pending.review) return ["resolved review does not match pending action review"]
  if (resolvedAction !== pending.action) return ["resolved action does not match pending action"]
  if (pending.action === "run_more_validation" && current.validation_runs.length <= (pending.validation_checkpoint || 0)) {
    return ["run_more_validation resolved without a new recorded validation command"]
  }
  if (pending.action !== "apply_notes" && typeof args.summary !== "string") return ["resolution summary is required"]

  const currentReview = current.reviews[pending.review]
  if (currentReview) currentReview.resolved = true
  current.pending_action = undefined
  current.status = pending.action === "replan" ? "started" : pending.review === "final" ? "done" : "working"
  return []
}

function submitFinal(current: GateState): string[] {
  if (current.status === "blocked") return ["workflow is blocked"]
  const level = currentLevel(current)
  if (level === "standard" && !reviewPassed(current.reviews.plan)) {
    return ["standard final submission requires passed plan review"]
  }
  if (level === "complex" && !reviewPassed(current.reviews.mid)) {
    return ["complex final submission requires passed mid review"]
  }
  current.status = "final_review_pending"
  return []
}

function output(event: GateEvent, current: GateState, reasons: string[]): GateOutput {
  const files = currentStatusFiles(current)
  const changed = changedSinceBaseline(files, current.baseline_status_files)
  const unplanned = unplannedFiles(changed, current.planned_targets)
  return {
    event,
    status: current.status,
    ok_to_continue: reasons.length === 0 && current.status !== "blocked",
    ok_to_edit: canEdit(current),
    ok_to_finalize: current.status === "done" && reviewPassed(current.reviews.final),
    reasons,
    work_kind: current.work_kind,
    proposed_level: current.proposed_level,
    assessed_level: current.assessed_level,
    current_level: currentLevel(current),
    planned_targets: current.planned_targets,
    preexisting_files: current.baseline_status_files || [],
    changed_files: changed,
    unplanned_changed_files: unplanned,
    validation_runs: current.validation_runs,
    reviews: current.reviews,
    pending_action: current.pending_action,
  }
}

function modifiedFiles(toolName: string, args: unknown, root: string): string[] {
  const record = asRecord(args)
  if (!record) return []
  if ((toolName === "edit" || toolName === "write") && typeof record.filePath === "string") {
    return [normalizeFile(record.filePath, root)]
  }
  if (toolName === "apply_patch" && typeof record.patchText === "string") {
    return record.patchText
      .split("\n")
      .filter((line) => /^\*\*\* (Add|Update|Delete) File: /.test(line) || /^\*\*\* Move to: /.test(line))
      .map((line) => line.replace(/^\*\*\* (Add|Update|Delete) File: /, "").replace(/^\*\*\* Move to: /, "").trim())
      .filter(Boolean)
      .map((file) => normalizeFile(file, root))
  }
  return []
}

export default (async ({ directory, worktree }) => {
  log({ event: "plugin_loaded", directory, worktree })
  return {
    tool: {
      phase_gate: tool({
        description:
          "Records phase-gated workflow events. It does not judge quality; use the judge subagent and record its JSON result with submit_review.",
        args: {
          event: tool.schema.enum(["start", "submit_plan", "submit_review", "resolve_action", "submit_final"]),
          work_kind: tool.schema.enum(["edit", "readonly", "reflection"]).optional(),
          proposed_level: tool.schema.enum(["simple", "standard", "complex"]).optional(),
          assessed_level: tool.schema.enum(["simple", "standard", "complex"]).optional(),
          review: tool.schema.enum(["plan", "mid", "final"]).optional(),
          decision: tool.schema
            .enum(["approve", "approve_with_notes", "request_more_evidence", "request_tests", "replan", "block"])
            .optional(),
          required_action: tool.schema
            .enum(["none", "apply_notes", "provide_more_evidence", "run_more_validation", "replan", "stop"])
            .optional(),
          resolved_action: tool.schema
            .enum(["apply_notes", "provide_more_evidence", "run_more_validation", "replan"])
            .optional(),
          planned_targets: tool.schema.array(tool.schema.string()).optional(),
          summary: tool.schema.string().optional(),
          validation_summary: tool.schema.string().optional(),
          notes: tool.schema.array(tool.schema.string()).optional(),
        },
        execute: async (args, context) => {
          const current = state(context.sessionID, {
            directory: context.directory || directory,
            worktree: context.worktree || worktree || directory,
          })
          current.directory = context.directory || current.directory
          current.worktree = context.worktree || current.worktree

          const input = args as Json
          const inputErrors = validateEventInput(input)
          const event = enumValue(input.event, ["start", "submit_plan", "submit_review", "resolve_action", "submit_final"] as const, "submit_final")
          const reasons =
            inputErrors.length > 0
              ? inputErrors
              : event === "start"
                ? (setStarted(current, input), [])
                : event === "submit_plan"
                  ? submitPlan(current, input)
                  : event === "submit_review"
                    ? submitReview(current, input)
                    : event === "resolve_action"
                      ? resolveAction(current, input)
                      : submitFinal(current)
          const result = output(event, current, reasons)
          log({ event: "gate", sessionID: context.sessionID, result })
          return JSON.stringify(result, null, 2)
        },
      }),
    },

    "tool.execute.before": async (input, output) => {
      const current = state(input.sessionID, { directory, worktree: worktree || directory })
      if (input.tool === "bash") {
        const command = String(asRecord(output.args)?.command || "")
        if (VALIDATION_PATTERN.test(command)) {
          current.validation_runs.push({
            command,
            status: "pending",
            started_at: new Date().toISOString(),
          })
          log({
            event: "validation_started",
            sessionID: input.sessionID,
            command,
            ambiguous: isAmbiguousValidationCommand(command),
          })
        }
      }

      if (!["edit", "write", "apply_patch"].includes(input.tool)) return
      const files = modifiedFiles(input.tool, output.args, current.directory)
      if (!canEdit(current)) {
        log({ event: "edit_blocked", sessionID: input.sessionID, tool: input.tool, files })
        throw new Error("phase_gate blocked this edit: start simple work or pass the required judge review first.")
      }
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool !== "bash") return
      const current = state(input.sessionID, { directory, worktree: worktree || directory })
      const command = String(asRecord(input.args)?.command || "")
      if (!VALIDATION_PATTERN.test(command)) return
      const pending = current.validation_runs.findLast((item) => item.command === command && item.status === "pending")
      if (!pending) return
      const metadata = asRecord(output.metadata)
      const exitCode = typeof metadata?.exit === "number" ? metadata.exit : undefined
      pending.exit_code = exitCode
      pending.status = isAmbiguousValidationCommand(command) ? "ambiguous" : exitCode === 0 ? "passed" : "failed"
      pending.finished_at = new Date().toISOString()
      log({
        event: "validation_finished",
        sessionID: input.sessionID,
        command,
        status: pending.status,
        exit_code: exitCode,
      })
    },
  }
}) satisfies Plugin
