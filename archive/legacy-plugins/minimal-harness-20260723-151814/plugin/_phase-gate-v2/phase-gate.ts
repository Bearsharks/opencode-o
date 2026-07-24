import { tool, type Plugin } from "@opencode-ai/plugin"
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import { spawnSync } from "child_process"
import { dirname, isAbsolute, relative, resolve } from "path"

const LOG = "/Users/jsp1226/.config/opencode/phase-gate.log"

type GateEvent = "start" | "submit_plan" | "submit_review" | "resolve_action" | "submit_final" | "record_validation"
type WorkKind = "edit" | "readonly" | "reflection"
type Level = "standard" | "complex"
type Phase = "direction" | "mid" | "final"
type Decision = "act" | "continue" | "finalize" | "request_more_evidence" | "request_tests" | "replan" | "block"
type DriverAction = "implement" | "continue" | "collect_evidence" | "run_validation" | "replan" | "stop" | "final_answer"
type CandidateSet = "sufficient" | "incomplete" | "misleading" | "not_needed"
type ValidationStatus = "passed" | "failed" | "skipped" | "ambiguous"
type CommandRunStatus = "running" | "passed" | "failed" | "ambiguous"
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
  level: Level
  candidate_set: CandidateSet
  selected_candidate?: string
  new_action?: unknown
  driver_action: DriverAction
  basis: string[]
  required: string[]
  allowed_claims: string[]
  notes: string[]
  resolved: boolean
}

type PendingAction = {
  phase: Phase
  action: Extract<DriverAction, "collect_evidence" | "run_validation" | "replan" | "stop">
  notes: string[]
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
  proposed_level?: Level
  planned_targets?: string[]
  baseline_status_files?: string[]
  observed_command_runs: CommandRun[]
  validation_runs: ValidationRun[]
  judgments: Partial<Record<Phase, JudgmentState>>
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
  current_level: Level
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
  previous_judgments: Partial<Record<Phase, JudgmentState>>
  open_obligations: string[]
  resolved_obligations: string[]
  pending_action?: PendingAction
}

type Json = Record<string, unknown>

const sessions = new Map<string, GateState>()
const phases = ["direction", "mid", "final"] as const
const levels = ["standard", "complex"] as const
const decisions = ["act", "continue", "finalize", "request_more_evidence", "request_tests", "replan", "block"] as const
const driverActions = [
  "implement",
  "continue",
  "collect_evidence",
  "run_validation",
  "replan",
  "stop",
  "final_answer",
] as const
const candidateSets = ["sufficient", "incomplete", "misleading", "not_needed"] as const
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
  if (!["start", "submit_plan", "submit_review", "resolve_action", "submit_final", "record_validation"].includes(event)) {
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
      ...validateEnumField(args, "proposed_level", levels),
      ...rejectFields(args, [
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
  if (event === "submit_plan") {
    return [
      ...validateEnumField(args, "work_kind", ["edit", "readonly", "reflection"] as const),
      ...validateEnumField(args, "proposed_level", levels),
      ...rejectFields(args, [
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
  if (event === "submit_review") {
    return [
      ...validateEnumField(args, "phase", phases),
      ...validateEnumField(args, "decision", decisions),
      ...validateEnumField(args, "level", levels),
      ...validateEnumField(args, "candidate_set", candidateSets),
      ...validateEnumField(args, "driver_action", driverActions),
      ...rejectFields(args, [
        "work_kind",
        "proposed_level",
        "planned_targets",
        "resolved_action",
        "review",
        "assessed_level",
        "required_action",
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

function directionPassed(judgment?: JudgmentState): boolean {
  return Boolean(judgment && judgment.resolved && judgment.decision === "act" && judgment.driver_action === "implement")
}

function midPassed(judgment?: JudgmentState): boolean {
  return Boolean(judgment && judgment.resolved && judgment.decision === "continue" && judgment.driver_action === "continue")
}

function finalPassed(judgment?: JudgmentState): boolean {
  return Boolean(judgment && judgment.resolved && judgment.decision === "finalize" && judgment.driver_action === "final_answer")
}

function currentLevel(current: GateState): Level {
  return current.judgments.final?.level || current.judgments.mid?.level || current.judgments.direction?.level || current.proposed_level || "standard"
}

function canEdit(current: GateState): boolean {
  if (current.status === "blocked" || current.status === "done") return false
  const level = currentLevel(current)
  if (level === "standard") return directionPassed(current.judgments.direction)
  if (level === "complex") return directionPassed(current.judgments.direction)
  return false
}

function setStarted(current: GateState, args: Json): void {
  ensureBaseline(current)
  const rawUserRequest = typeof args.raw_user_request === "string" ? args.raw_user_request : undefined
  const summary = typeof args.summary === "string" ? args.summary : undefined
  current.raw_user_request = rawUserRequest || summary || current.raw_user_request
  current.objective = typeof args.objective === "string" ? args.objective : current.objective
  current.effective_objective = current.effective_objective || current.objective
  current.work_kind = enumValue(args.work_kind, ["edit", "readonly", "reflection"] as const, "edit")
  current.proposed_level = enumValue(args.proposed_level, levels, "standard")
  current.planned_targets = asOptionalStringArray(args.planned_targets)?.map((file) => normalizeFile(file, current.worktree))
  current.status = "started"
}

function submitPlan(current: GateState, args: Json): string[] {
  ensureBaseline(current)
  const rawUserRequest = typeof args.raw_user_request === "string" ? args.raw_user_request : undefined
  const summary = typeof args.summary === "string" ? args.summary : undefined
  current.raw_user_request = rawUserRequest || current.raw_user_request || summary
  current.objective = typeof args.objective === "string" ? args.objective : current.objective
  current.effective_objective = current.effective_objective || current.objective
  current.work_kind = enumValue(args.work_kind, ["edit", "readonly", "reflection"] as const, "edit")
  current.proposed_level = enumValue(args.proposed_level, levels, "standard")
  current.planned_targets = asOptionalStringArray(args.planned_targets)?.map((file) => normalizeFile(file, current.worktree))
  current.status = "plan_review_pending"
  return []
}

function submitReview(current: GateState, args: Json): string[] {
  const phase = enumValue(args.phase, phases, "final")
  const decision = enumValue(args.decision, decisions, "block")
  const level = enumValue(args.level, levels, current.proposed_level || "standard")
  const candidateSet = enumValue(args.candidate_set, candidateSets, "not_needed")
  const driverAction = enumValue(args.driver_action, driverActions, "stop")
  const notes = asStringArray(args.notes)
  const required = asStringArray(args.required)
  const basis = asStringArray(args.basis)
  const allowedClaims = asStringArray(args.allowed_claims)
  const selectedCandidate = typeof args.selected_candidate === "string" ? args.selected_candidate : undefined
  if (typeof args.effective_objective === "string") current.effective_objective = args.effective_objective
  const reasons = validateJudgmentEvent(current, phase, decision, driverAction, level)
  if (reasons.length > 0) return reasons
  const downgradeReasons = validateDowngradeBasis(current, level, basis, notes)
  if (downgradeReasons.length > 0) return downgradeReasons

  current.judgments[phase] = {
    decision,
    level,
    candidate_set: candidateSet,
    selected_candidate: selectedCandidate,
    new_action: args.new_action,
    driver_action: driverAction,
    basis,
    required,
    allowed_claims: allowedClaims,
    notes,
    resolved: !isPendingAction(driverAction),
  }
  if (!isPendingAction(driverAction)) {
    current.pending_action = undefined
    current.status = phase === "final" ? "done" : "working"
    return []
  }
  current.pending_action = {
    phase,
    action: driverAction,
    notes,
    required,
    validation_checkpoint: driverAction === "run_validation" ? current.validation_runs.length : undefined,
  }
  current.status = decision === "block" || driverAction === "stop" ? "blocked" : phaseStatus(phase)
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

function validateDowngradeBasis(
  current: GateState,
  level: Level,
  basis: string[],
  notes: string[],
): string[] {
  if (current.proposed_level !== "complex" || level !== "standard") return []
  const text = [...basis, ...notes].join("\n").trim()
  if (text.length > 0) return []
  return ["complex-to-standard downgrade requires basis or notes explaining why standard review is enough"]
}

function isPendingAction(action: DriverAction): action is PendingAction["action"] {
  return action === "collect_evidence" || action === "run_validation" || action === "replan" || action === "stop"
}

function validateJudgmentEvent(current: GateState, phase: Phase, decision: Decision, driverAction: DriverAction, level: Level): string[] {
  if (current.status === "blocked") return ["workflow is blocked"]
  const expected: Record<Decision, DriverAction> = {
    act: "implement",
    continue: "continue",
    finalize: "final_answer",
    request_more_evidence: "collect_evidence",
    request_tests: "run_validation",
    replan: "replan",
    block: "stop",
  }
  if (expected[decision] !== driverAction) return [`${decision} decision must use driver_action=${expected[decision]}`]
  if (
    phase === "direction" &&
    decision !== "act" &&
    decision !== "request_more_evidence" &&
    decision !== "request_tests" &&
    decision !== "replan" &&
    decision !== "block"
  ) {
    return ["direction judgment must decide act, request_more_evidence, request_tests, replan, or block"]
  }
  if (
    phase === "mid" &&
    decision !== "continue" &&
    decision !== "request_more_evidence" &&
    decision !== "request_tests" &&
    decision !== "replan" &&
    decision !== "block"
  ) {
    return ["mid judgment must decide continue, request_more_evidence, request_tests, replan, or block"]
  }
  if (
    phase === "final" &&
    decision !== "finalize" &&
    decision !== "request_more_evidence" &&
    decision !== "request_tests" &&
    decision !== "replan" &&
    decision !== "block"
  ) {
    return ["final judgment must decide finalize, request_more_evidence, request_tests, replan, or block"]
  }
  if (phase === "mid" && level !== "complex") return ["mid judgment is only part of complex work"]
  if (phase === "mid" && !directionPassed(current.judgments.direction)) {
    return ["complex mid judgment requires passed direction judgment"]
  }
  if (phase === "final" && level === "standard" && !directionPassed(current.judgments.direction)) {
    return ["standard final judgment requires passed direction judgment"]
  }
  if (phase === "final" && level === "complex" && !midPassed(current.judgments.mid)) {
    return ["complex final judgment requires passed mid judgment"]
  }
  return []
}

function phaseStatus(phase: Phase): GateStatus {
  if (phase === "direction") return "plan_review_pending"
  if (phase === "mid") return "mid_review_pending"
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
  if (pending.action === "replan") current.judgments = {}
  current.status = pending.action === "replan" ? "started" : pending.phase === "final" ? "final_review_pending" : phaseStatus(pending.phase)
  return []
}

function submitFinal(current: GateState): string[] {
  if (current.status === "blocked") return ["workflow is blocked"]
  const level = currentLevel(current)
  if (level === "standard" && !directionPassed(current.judgments.direction)) {
    return ["standard final submission requires passed direction judgment"]
  }
  if (level === "complex" && !midPassed(current.judgments.mid)) {
    return ["complex final submission requires passed mid judgment"]
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
    proposed_level: current.proposed_level,
    current_level: currentLevel(current),
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
    previous_judgments: current.judgments,
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
            "submit_plan",
            "submit_review",
            "resolve_action",
            "submit_final",
            "record_validation",
          ]),
          work_kind: tool.schema.enum(["edit", "readonly", "reflection"]).optional(),
          proposed_level: tool.schema.enum(["standard", "complex"]).optional(),
          level: tool.schema.enum(["standard", "complex"]).optional(),
          phase: tool.schema.enum(["direction", "mid", "final"]).optional(),
          decision: tool.schema
            .enum(["act", "continue", "finalize", "request_more_evidence", "request_tests", "replan", "block"])
            .optional(),
          candidate_set: tool.schema.enum(["sufficient", "incomplete", "misleading", "not_needed"]).optional(),
          selected_candidate: tool.schema.any().optional(),
          new_action: tool.schema.any().optional(),
          raw_user_request: tool.schema.string().optional(),
          objective: tool.schema.string().optional(),
          effective_objective: tool.schema.string().optional(),
          driver_action: tool.schema
            .enum(["implement", "continue", "collect_evidence", "run_validation", "replan", "stop", "final_answer"])
            .optional(),
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
          basis: tool.schema.array(tool.schema.string()).optional(),
          required: tool.schema.array(tool.schema.string()).optional(),
          allowed_claims: tool.schema.array(tool.schema.string()).optional(),
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
          const event = enumValue(
            input.event,
            ["start", "submit_plan", "submit_review", "resolve_action", "submit_final", "record_validation"] as const,
            "submit_final",
          )
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
        throw new Error("phase_gate blocked this edit: record a direction judgment with driver_action=implement first.")
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
