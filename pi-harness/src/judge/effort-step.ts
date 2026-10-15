import type { Usage } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { EFFORT_TABLE } from "../contract/effort.ts";
import { type Contract, type EffortLevel, EffortLevelSchema } from "../contract/schema.ts";
import { writeJson } from "./input.ts";
import { stopDescription, type ToolLogEntry, trackSession, zeroUsage } from "./record.ts";

export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "extreme"];
export const EFFORT_TOOLS: readonly string[] = ["submit_effort"];
export const SUBMIT_EFFORT = "submit_effort";
export const EFFORT_SECTION = "effort_instructions";
export const EFFORT_MARKER = "You decide how much effort the working agent of pi-harness should spend on a task.";
export const EFFORT_SENTINEL = "[pi-harness: deliver the effort request]";

export type EffortInput = {
  schemaVersion: 1;
  firstMessage: string;
  doneConditions: Contract["doneConditions"];
  prohibitions: Contract["prohibitions"];
};

export type EffortRecord = {
  status: "submitted" | "failed";
  level?: EffortLevel;
  reason?: string;
  usage: Usage;
  durationMs: number;
  toolLog: ToolLogEntry[];
  stopReason?: string;
  error?: string;
};

export type EffortDecision = {
  level: EffortLevel;
  reason: string;
  decidedBy: "classifier" | "override" | "fallback";
  error?: string;
};

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

export function buildEffortInput(firstMessage: string, contract: Pick<Contract, "doneConditions" | "prohibitions">): EffortInput {
  return {
    schemaVersion: 1,
    firstMessage,
    doneConditions: contract.doneConditions.map((d) => ({ ...d, verify: { ...d.verify } }) as Contract["doneConditions"][number]),
    prohibitions: contract.prohibitions.map((p) => ({ ...p, source: { ...p.source } })),
  };
}

export function effortInstructions(): string {
  const describe: Record<EffortLevel, string> = {
    low: "a small, local, low-risk change or a short answer",
    medium: "an ordinary task that touches a few places",
    high: "broad or tricky work: many files, subtle behaviour, conditions that interact, or a careful investigation",
    extreme: "large, risky or open-ended work where mistakes are expensive: a wide refactor or migration, concurrency, security, or many interacting conditions",
  };
  const levels = EFFORT_LEVELS.map((l) => {
    const row = EFFORT_TABLE[l];
    const workers = row.workerCap === 0 ? "no helper workers" : `up to ${row.workerCap} read-only helper workers per call`;
    return `- ${l}: ${describe[l]}. The agent then thinks at level ${row.thinkingLevel} and may use ${workers}.`;
  });
  return [
    `${EFFORT_MARKER} You get exactly three inputs: the user's first message, the done conditions and the prohibitions of the task. Decide from them only, and do not do the task.`,
    "",
    "Levels:",
    ...levels,
    "",
    "Pick the lowest level that is enough to finish the task correctly; higher levels cost more time and money. Then call submit_effort once, alone, with the level and a reason of one or two sentences.",
  ].join("\n");
}

export function effortFirstMessage(input: EffortInput): string {
  const lines = [
    "Decide the effort level for this task and submit it with submit_effort.",
    "",
    "1. The user's first message (verbatim, between the markers):",
    "<<<",
    input.firstMessage,
    ">>>",
    "",
    "2. Done conditions:",
  ];
  if (input.doneConditions.length === 0) lines.push("None.");
  for (const d of input.doneConditions) {
    const v = d.verify;
    lines.push(v.kind === "command"
      ? `- ${d.id} ${d.statement} (verified by running \`${v.command}\` in \`${v.cwd}\`)`
      : `- ${d.id} ${d.statement} (reported by the agent: ${v.how})`);
  }
  lines.push("", "3. Prohibitions:");
  if (input.prohibitions.length === 0) lines.push("None.");
  for (const p of input.prohibitions) lines.push(`- ${p.id} ${p.text}`);
  return lines.join("\n");
}

export type EffortSession = {
  factory: (pi: ExtensionAPI) => void;
  record(): EffortRecord;
  write(error?: string): EffortRecord;
};

export function effortSession(input: EffortInput, outFile: string, clock: () => number = Date.now): EffortSession {
  const startedAt = clock();
  let decided: { level: EffortLevel; reason: string } | undefined;
  let tracker: ReturnType<typeof trackSession> | undefined;
  let firstInputPending = true;

  const record = (error?: string): EffortRecord => {
    const r: EffortRecord = {
      status: decided !== undefined ? "submitted" : "failed",
      usage: tracker?.usage ?? zeroUsage(),
      durationMs: clock() - startedAt,
      toolLog: [...(tracker?.toolLog ?? [])],
    };
    if (decided !== undefined) {
      r.level = decided.level;
      r.reason = decided.reason;
    }
    if (tracker?.stopReason !== undefined) r.stopReason = tracker.stopReason;
    if (decided === undefined) r.error = error ?? (tracker !== undefined ? stopDescription(tracker, SUBMIT_EFFORT) : "the effort step did not start");
    return r;
  };
  const write = (error?: string) => {
    const r = record(error);
    writeJson(outFile, r);
    return r;
  };

  const factory = (pi: ExtensionAPI) => {
    tracker = trackSession(pi);
    pi.registerTool(defineTool({
      name: SUBMIT_EFFORT,
      label: "Submit effort",
      description: "Submit the effort level for the task and finish. Call it once, alone.",
      promptSnippet: "Submit the effort level (call it alone, last)",
      parameters: Type.Object({
        level: EffortLevelSchema,
        reason: Type.String({ description: "One or two sentences on why this level fits." }),
      }),
      async execute(_toolCallId, params) {
        if (decided === undefined) {
          decided = { level: params.level, reason: params.reason };
          write();
        }
        return { content: [{ type: "text", text: "Effort recorded. Stop now." }], details: undefined, terminate: true };
      },
    }));
    pi.on("turn_end", (event, ctx) => {
      if (decided !== undefined && event.toolResults.some((r) => r.toolName !== SUBMIT_EFFORT)) ctx.abort();
    });
    pi.on("input", (event) => {
      if (firstInputPending && event.text.endsWith(EFFORT_SENTINEL)) {
        firstInputPending = false;
        return { action: "transform" as const, text: effortFirstMessage(input) };
      }
      firstInputPending = false;
      return { action: "continue" as const };
    });
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections[EFFORT_SECTION] = effortInstructions();
    });
    pi.on("session_shutdown", () => {
      write();
    });
  };
  return { factory, record, write };
}

export function decideEffort(opts: { override?: EffortLevel; record?: EffortRecord | null; failure?: string }): EffortDecision {
  if (opts.override !== undefined) return { level: opts.override, reason: "set with --effort", decidedBy: "override" };
  const r = opts.record;
  if (r !== null && r !== undefined && r.status === "submitted" && isEffortLevel(r.level)) {
    return { level: r.level, reason: r.reason ?? "", decidedBy: "classifier" };
  }
  const error = opts.failure ?? r?.error ?? "the effort step gave no level";
  return { level: "medium", reason: "the effort step failed; using medium", decidedBy: "fallback", error };
}
