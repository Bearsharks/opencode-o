import { tool, type Plugin } from "@opencode-ai/plugin"
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import { spawnSync } from "child_process"
import { dirname, isAbsolute, relative, resolve } from "path"

const LOG = "/Users/jsp1226/.config/opencode/phase-gate.log"

type GateEvent =
  | "start"
  | "submit_initial"
  | "open_advice"
  | "submit_review"
  | "resolve_action"
  | "submit_final"
  | "record_validation"
type WorkKind = "edit" | "readonly" | "reflection"
type Phase = "initial" | "advice" | "final"
type Decision = "act" | "advise" | "finalize" | "more_evidence" | "more_tests" | "replan" | "block"
type NextAction = "implement" | "continue" | "collect_evidence" | "run_validation" | "replan" | "stop" | "final_answer"
type ValidationStatus = "passed" | "failed" | "skipped" | "ambiguous"
type CommandRunStatus = "running" | "passed" | "failed" | "ambiguous"
type GateStatus =
  | "idle"
  | "started"
  | "initial_review_pending"
  | "working"
  | "advice_review_pending"
  | "final_review_pending"
  | "done"
  | "blocked"

type ValidationRun = {
  run_id: string
  command: string
  status: ValidationStatus
  exit_code?: number
  purpose: string
  scope: string[]
  summary?: string
  recorded_at: string
}

type CommandRun = {
  run_id: string
  tool: "bash"
  command: string
  cwd?: string
  status: CommandRunStatus
  exit_code?: number
  started_at: string
  finished_at?: string
  output_summary?: string
  recorded_as_validation?: boolean
}

type JudgmentState = {
  decision: Decision
  next_action: NextAction
  summary?: string
  required: string[]
  allowed_claims: string[]
  resolved: boolean
}

type PendingAction = {
  phase: Phase
  action: Extract<NextAction, "collect_evidence" | "run_validation" | "replan" | "stop">
  required: string[]
  validation_checkpoint?: number
}

type GateState = {
  status: GateStatus
  directory: string
  worktree: string
  raw_user_request?: string
  objective?: string
  effective_objective?: string
  work_kind?: WorkKind
  planned_targets?: string[]
  baseline_status_files?: string[]
  observed_command_runs: CommandRun[]
  validation_runs: ValidationRun[]
  judgments: Partial<Record<Phase, JudgmentState>>
  advice_judgments: JudgmentState[]
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
  raw_user_request?: string
  objective?: string
  effective_objective?: string
  planned_targets?: string[]
  preexisting_files: string[]
  changed_files: string[]
  unplanned_changed_files?: string[]
  validation_runs: ValidationRun[]
  declared_validations: ValidationRun[]
  observed_command_runs: CommandRun[]
  judgments: Partial<Record<Phase, JudgmentState>>
  advice_judgments: JudgmentState[]
  previous_judgments: Partial<Record<Phase, JudgmentState>>
  next_action?: NextAction
  open_obligations: string[]
  resolved_obligations: string[]
  pending_action?: PendingAction
}

type Json = Record<string, unknown>

const sessions = new Map<string, GateState>()
const gateEvents = ["start", "submit_initial", "open_advice", "submit_review", "resolve_action", "submit_final", "record_validation"] as const
const phases = ["initial", "advice", "final"] as const
const decisions = ["act", "advise", "finalize", "more_evidence", "more_tests", "replan", "block"] as const
const validationStatuses = ["passed", "failed", "skipped", "ambiguous"] as const

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
  if (!(gateEvents as readonly string[]).includes(event)) {
    return ["event is invalid"]
  }
  if (event === "record_validation") {
    return [
      ...(typeof args.run_id === "string" && args.run_id.trim() ? [] : ["record_validation requires run_id"]),
      ...(typeof args.purpose === "string" && args.purpose.trim() ? [] : ["record_validation requires purpose"]),
      ...rejectFields(args, [
        "work_kind",
        "proposed_level",
        "level",
        "phase",
        "review",
        "assessed_level",
        "decision",
        "required_action",
        "driver_action",
        "candidate_set",
        "selected_candidate",
        "new_action",
        "resolved_action",
        "planned_targets",
        "command",
        "status",
        "exit_code",
        "basis",
        "required",
        "allowed_claims",
        "notes",
        "effective_objective",
      ]),
    ]
  }
  if (event === "start") {
    return [
      ...validateEnumField(args, "work_kind", ["edit", "readonly", "reflection"] as const),
      ...rejectFields(args, [
        "proposed_level",
        "level",
        "phase",
        "review",
        "decision",
        "candidate_set",
        "selected_candidate",
        "new_action",
        "driver_action",
        "resolved_action",
        "basis",
        "required",
        "allowed_claims",
        "notes",
        "run_id",
        "validation_summary",
        "effective_objective",
      ]),
    ]
  }
  if (event === "submit_initial") {
    return [
      ...validateEnumField(args, "work_kind", ["edit", "readonly", "reflection"] as const),
      ...rejectFields(args, [
        "proposed_level",
        "level",
        "phase",
        "review",
        "decision",
        "candidate_set",
        "selected_candidate",
        "new_action",
        "driver_action",
        "resolved_action",
        "basis",
        "required",
        "allowed_claims",
        "notes",
        "run_id",
        "validation_summary",
        "effective_objective",
      ]),
    ]
  }
  if (event === "open_advice") {
    return rejectFields(args, [
      "work_kind",
      "proposed_level",
      "level",
      "phase",
      "review",
      "decision",
      "candidate_set",
      "selected_candidate",
      "new_action",
      "driver_action",
      "resolved_action",
      "basis",
      "required",
      "allowed_claims",
      "notes",
      "run_id",
      "validation_summary",
      "raw_user_request",
      "objective",
      "effective_objective",
    ])
  }
  if (event === "submit_review") {
    return [
      ...validateEnumField(args, "phase", phases),
      ...validateEnumField(args, "decision", decisions),
      ...rejectFields(args, [
        "work_kind",
        "proposed_level",
        "level",
        "planned_targets",
        "resolved_action",
        "review",
        "assessed_level",
        "required_action",
        "candidate_set",
        "selected_candidate",
        "new_action",
        "driver_action",
        "basis",
        "notes",
        "raw_user_request",
        "objective",
        "run_id",
      ]),
    ]
  }
  if (event === "resolve_action") {
    return [
      ...validateEnumField(args, "phase", phases),
      ...validateEnumField(args, "resolved_action", ["collect_evidence", "run_validation", "replan"] as const),
      ...rejectFields(args, [
        "work_kind",
        "proposed_level",
        "level",
        "review",
        "assessed_level",
        "decision",
        "required_action",
        "driver_action",
        "candidate_set",
        "selected_candidate",
        "new_action",
        "planned_targets",
        "basis",
        "required",
        "allowed_claims",
        "notes",
        "raw_user_request",
        "objective",
        "effective_objective",
        "run_id",
      ]),
    ]
  }
  return rejectFields(args, [
    "work_kind",
    "proposed_level",
    "level",
    "phase",
    "review",
    "assessed_level",
    "decision",
    "required_action",
    "driver_action",
    "candidate_set",
    "selected_candidate",
    "new_action",
    "resolved_action",
    "planned_targets",
    "basis",
    "required",
    "allowed_claims",
    "notes",
    "raw_user_request",
    "objective",
    "effective_objective",
    "run_id",
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
    observed_command_runs: [],
    validation_runs: [],
    judgments: {},
    advice_judgments: [],
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
    .filter((line) => line.trim())
    .flatMap((line) => {
      const pathText = line.replace(/^[ MARCUD?!]{1,2}\s+/, "")
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

function commandRunID(input: { callID: string }): string {
  return `cmd_${input.callID}`
}

function hasShellControl(command: string): boolean {
  let single = false
  let double = false
  let escaped = false
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "'" && !double) {
      single = !single
      continue
    }
    if (char === '"' && !single) {
      double = !double
      continue
    }
    if (single || double) continue
    if (char === ";" || char === "<" || char === ">") return true
    if (char === "|") return true
    if (char === "&" && command[i + 1] === "&") return true
  }
  return false
}

function summarizeOutput(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const interesting = lines.filter((line) =>
    /\b(pass|passed|fail|failed|error|errors|expect|tests?|Ran|exit|Exit)\b/i.test(line),
  )
  const selected = (interesting.length > 0 ? interesting : lines).slice(-6)
  const summary = selected.join(" | ")
  return summary.length > 500 ? `${summary.slice(0, 497)}...` : summary
}

function unplannedFiles(changed: string[], targets?: string[]): string[] | undefined {
  if (!targets) return undefined
  return changed.filter((file) => !targets.some((target) => matchesTarget(file, target)))
}

function initialPassed(judgment?: JudgmentState): boolean {
  return Boolean(judgment && judgment.resolved && judgment.decision === "act" && judgment.next_action === "implement")
}

function finalPassed(judgment?: JudgmentState): boolean {
  return Boolean(judgment && judgment.resolved && judgment.decision === "finalize" && judgment.next_action === "final_answer")
}

function canEdit(current: GateState): boolean {
  if (current.status === "blocked" || current.status === "done") return false
  if (current.pending_action) return false
  return initialPassed(current.judgments.initial)
}

function setStarted(current: GateState, args: Json): void {
  ensureBaseline(current)
  const rawUserRequest = typeof args.raw_user_request === "string" ? args.raw_user_request : undefined
  const summary = typeof args.summary === "string" ? args.summary : undefined
  current.raw_user_request = rawUserRequest || summary || current.raw_user_request
  current.objective = typeof args.objective === "string" ? args.objective : current.objective
  current.effective_objective = current.effective_objective || current.objective
  current.work_kind = enumValue(args.work_kind, ["edit", "readonly", "reflection"] as const, "edit")
  current.planned_targets = asOptionalStringArray(args.planned_targets)?.map((file) => normalizeFile(file, current.worktree))
  current.status = "started"
}

function submitInitial(current: GateState, args: Json): string[] {
  ensureBaseline(current)
  const rawUserRequest = typeof args.raw_user_request === "string" ? args.raw_user_request : undefined
  const summary = typeof args.summary === "string" ? args.summary : undefined
  current.raw_user_request = rawUserRequest || current.raw_user_request || summary
  current.objective = typeof args.objective === "string" ? args.objective : current.objective
  current.effective_objective = current.effective_objective || current.objective
  current.work_kind = enumValue(args.work_kind, ["edit", "readonly", "reflection"] as const, "edit")
  current.planned_targets = asOptionalStringArray(args.planned_targets)?.map((file) => normalizeFile(file, current.worktree))
  current.status = "initial_review_pending"
  return []
}

function openAdvice(current: GateState): string[] {
  if (current.status === "blocked") return ["workflow is blocked"]
  if (!initialPassed(current.judgments.initial)) return ["advice requires passed initial judgment"]
  current.status = "advice_review_pending"
  return []
}

function submitReview(current: GateState, args: Json): string[] {
  const phase = enumValue(args.phase, phases, "final")
  const decision = enumValue(args.decision, decisions, "block")
  const nextAction = nextActionFor(decision)
  const required = asStringArray(args.required)
  const allowedClaims = asStringArray(args.allowed_claims)
  if (typeof args.effective_objective === "string") current.effective_objective = args.effective_objective
  const reasons = validateJudgmentEvent(current, phase, decision)
  if (reasons.length > 0) return reasons

  const judgment: JudgmentState = {
    decision,
    next_action: nextAction,
    summary: typeof args.summary === "string" ? args.summary : undefined,
    required,
    allowed_claims: allowedClaims,
    resolved: !isPendingAction(nextAction),
  }
  if (phase === "advice") current.advice_judgments.push(judgment)
  current.judgments[phase] = judgment
  if (!isPendingAction(nextAction)) {
    current.pending_action = undefined
    current.status = phase === "final" ? "done" : "working"
    return []
  }
  current.pending_action = {
    phase,
    action: nextAction,
    required,
    validation_checkpoint: nextAction === "run_validation" ? current.validation_runs.length : undefined,
  }
  current.status = decision === "block" || nextAction === "stop" ? "blocked" : phaseStatus(phase)
  return []
}

function recordValidation(current: GateState, args: Json): string[] {
  if (typeof args.run_id !== "string" || !args.run_id.trim()) return ["record_validation requires run_id"]
  if (typeof args.purpose !== "string" || !args.purpose.trim()) return ["record_validation requires purpose"]
  const run =
    args.run_id === "last"
      ? current.observed_command_runs.findLast((item) => item.status !== "running" && !item.recorded_as_validation)
      : current.observed_command_runs.find((item) => item.run_id === args.run_id)
  if (!run) return [`record_validation run_id not found: ${args.run_id}`]
  if (run.status === "running") return [`record_validation run is still running: ${run.run_id}`]
  if (run.recorded_as_validation) return [`record_validation run_id already recorded: ${run.run_id}`]
  const status: ValidationStatus = run.status
  current.validation_runs.push({
    run_id: run.run_id,
    command: run.command,
    status,
    exit_code: run.exit_code,
    purpose: args.purpose,
    scope: asStringArray(args.scope),
    summary: typeof args.summary === "string" ? args.summary : run.output_summary,
    recorded_at: new Date().toISOString(),
  })
  run.recorded_as_validation = true
  return []
}

function nextActionFor(decision: Decision): NextAction {
  if (decision === "act") return "implement"
  if (decision === "advise") return "continue"
  if (decision === "finalize") return "final_answer"
  if (decision === "more_evidence") return "collect_evidence"
  if (decision === "more_tests") return "run_validation"
  if (decision === "replan") return "replan"
  return "stop"
}

function isPendingAction(action: NextAction): action is PendingAction["action"] {
  return action === "collect_evidence" || action === "run_validation" || action === "replan" || action === "stop"
}

function validateJudgmentEvent(current: GateState, phase: Phase, decision: Decision): string[] {
  if (current.status === "blocked") return ["workflow is blocked"]
  if (phase === "initial" && current.status !== "initial_review_pending") {
    return ["initial judgment requires submit_initial first"]
  }
  if (phase === "advice" && current.status !== "advice_review_pending") {
    return ["advice judgment requires open_advice first"]
  }
  if (phase === "final" && current.status !== "final_review_pending") {
    return ["final judgment requires submit_final first"]
  }
  if (
    phase === "initial" &&
    decision !== "act" &&
    decision !== "more_evidence" &&
    decision !== "more_tests" &&
    decision !== "replan" &&
    decision !== "block"
  ) {
    return ["initial judgment must decide act, more_evidence, more_tests, replan, or block"]
  }
  if (
    phase === "advice" &&
    decision !== "advise" &&
    decision !== "more_evidence" &&
    decision !== "more_tests" &&
    decision !== "replan" &&
    decision !== "block"
  ) {
    return ["advice judgment must decide advise, more_evidence, more_tests, replan, or block"]
  }
  if (
    phase === "final" &&
    decision !== "finalize" &&
    decision !== "more_evidence" &&
    decision !== "more_tests" &&
    decision !== "replan" &&
    decision !== "block"
  ) {
    return ["final judgment must decide finalize, more_evidence, more_tests, replan, or block"]
  }
  if (phase === "advice" && !initialPassed(current.judgments.initial)) {
    return ["advice judgment requires passed initial judgment"]
  }
  if (phase === "final" && !initialPassed(current.judgments.initial)) {
    return ["final judgment requires passed initial judgment"]
  }
  return []
}

function phaseStatus(phase: Phase): GateStatus {
  if (phase === "initial") return "initial_review_pending"
  if (phase === "advice") return "advice_review_pending"
  return "final_review_pending"
}

function resolveAction(current: GateState, args: Json): string[] {
  const pending = current.pending_action
  if (!pending) return ["no pending action to resolve"]
  const phase = enumValue(args.phase, phases, pending.phase)
  const resolvedAction = enumValue(
    args.resolved_action,
    ["collect_evidence", "run_validation", "replan"] as const,
    pending.action === "stop" ? "replan" : pending.action,
  )
  if (phase !== pending.phase) return ["resolved phase does not match pending action phase"]
  if (resolvedAction !== pending.action) return ["resolved action does not match pending action"]
  if (pending.action === "run_validation" && current.validation_runs.length <= (pending.validation_checkpoint || 0)) {
    return ["run_validation resolved without a new recorded validation command"]
  }
  if (typeof args.summary !== "string") return ["resolution summary is required"]

  const currentJudgment = current.judgments[pending.phase]
  if (currentJudgment) currentJudgment.resolved = true
  current.pending_action = undefined
  if (pending.action === "replan") {
    current.judgments = {}
    current.advice_judgments = []
  }
  current.status = pending.action === "replan" ? "started" : pending.phase === "final" ? "final_review_pending" : phaseStatus(pending.phase)
  return []
}

function submitFinal(current: GateState): string[] {
  if (current.status === "blocked") return ["workflow is blocked"]
  if (current.pending_action) return ["pending action must be resolved before final submission"]
  if (!initialPassed(current.judgments.initial)) {
    return ["final submission requires passed initial judgment"]
  }
  current.status = "final_review_pending"
  return []
}

function output(event: GateEvent, current: GateState, reasons: string[]): GateOutput {
  const files = currentStatusFiles(current)
  const changed = changedSinceBaseline(files, current.baseline_status_files)
  const unplanned = unplannedFiles(changed, current.planned_targets)
  const openObligations =
    current.status === "done"
      ? []
      : Array.from(
          new Set([
            ...Object.values(current.judgments).flatMap((judgment) => judgment?.required || []),
            ...(current.pending_action?.required || []),
          ]),
        )
  return {
    event,
    status: current.status,
    ok_to_continue: reasons.length === 0 && current.status !== "blocked",
    ok_to_edit: canEdit(current),
    ok_to_finalize: current.status === "done" && finalPassed(current.judgments.final),
    reasons,
    work_kind: current.work_kind,
    raw_user_request: current.raw_user_request,
    objective: current.objective,
    effective_objective: current.effective_objective,
    planned_targets: current.planned_targets,
    preexisting_files: current.baseline_status_files || [],
    changed_files: changed,
    unplanned_changed_files: unplanned,
    validation_runs: current.validation_runs,
    declared_validations: current.validation_runs,
    observed_command_runs: current.observed_command_runs.slice(-20),
    judgments: current.judgments,
    advice_judgments: current.advice_judgments,
    previous_judgments: current.judgments,
    next_action: current.judgments.final?.next_action || current.judgments.advice?.next_action || current.judgments.initial?.next_action,
    open_obligations: openObligations,
    resolved_obligations: [],
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
          "Records judge-led phase-gated workflow events. It does not judge quality; record judge judgments with submit_review.",
        args: {
          event: tool.schema.enum([
            "start",
            "submit_initial",
            "open_advice",
            "submit_review",
            "resolve_action",
            "submit_final",
            "record_validation",
          ]),
          work_kind: tool.schema.enum(["edit", "readonly", "reflection"]).optional(),
          phase: tool.schema.enum(["initial", "advice", "final"]).optional(),
          decision: tool.schema.enum(["act", "advise", "finalize", "more_evidence", "more_tests", "replan", "block"]).optional(),
          raw_user_request: tool.schema.string().optional(),
          objective: tool.schema.string().optional(),
          effective_objective: tool.schema.string().optional(),
          resolved_action: tool.schema.enum(["collect_evidence", "run_validation", "replan"]).optional(),
          planned_targets: tool.schema.array(tool.schema.string()).optional(),
          run_id: tool.schema.string().optional(),
          command: tool.schema.string().optional(),
          status: tool.schema.enum(["passed", "failed", "skipped", "ambiguous"]).optional(),
          exit_code: tool.schema.number().optional(),
          purpose: tool.schema.string().optional(),
          scope: tool.schema.array(tool.schema.string()).optional(),
          summary: tool.schema.string().optional(),
          validation_summary: tool.schema.string().optional(),
          required: tool.schema.array(tool.schema.string()).optional(),
          allowed_claims: tool.schema.array(tool.schema.string()).optional(),
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
          const event = enumValue(
            input.event,
            gateEvents,
            "submit_final",
          )
          const reasons =
            inputErrors.length > 0
              ? inputErrors
              : event === "start"
                  ? (setStarted(current, input), [])
                : event === "submit_initial"
                  ? submitInitial(current, input)
                  : event === "open_advice"
                    ? openAdvice(current)
                  : event === "submit_review"
                    ? submitReview(current, input)
                    : event === "resolve_action"
                      ? resolveAction(current, input)
                      : event === "record_validation"
                        ? recordValidation(current, input)
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
        const args = asRecord(output.args)
        const command = typeof args?.command === "string" ? args.command : ""
        if (command.trim()) {
          const run: CommandRun = {
            run_id: commandRunID(input),
            tool: "bash",
            command,
            cwd: typeof args?.cwd === "string" ? args.cwd : undefined,
            status: "running",
            started_at: new Date().toISOString(),
          }
          current.observed_command_runs.push(run)
          log({ event: "command_run_started", sessionID: input.sessionID, run })
        }
      }

      if (!["edit", "write", "apply_patch"].includes(input.tool)) return
      const files = modifiedFiles(input.tool, output.args, current.directory)
      if (!canEdit(current)) {
        log({ event: "edit_blocked", sessionID: input.sessionID, tool: input.tool, files })
        throw new Error("phase_gate blocked this edit: record an initial judgment with decision=act first.")
      }
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool !== "bash") return
      const current = state(input.sessionID, { directory, worktree: worktree || directory })
      const run = current.observed_command_runs.findLast((item) => item.run_id === commandRunID(input))
      if (!run) return
      const metadata = asRecord(output.metadata)
      const exitCode = typeof metadata?.exit === "number" ? metadata.exit : undefined
      run.exit_code = exitCode
      run.status = hasShellControl(run.command) ? "ambiguous" : exitCode === 0 ? "passed" : "failed"
      run.finished_at = new Date().toISOString()
      run.output_summary = summarizeOutput(output.output)
      log({ event: "command_run_finished", sessionID: input.sessionID, run })
    },
  }
}) satisfies Plugin
