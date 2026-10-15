import type { Usage } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type JudgeDraft, JudgeDraftSchema, type Material } from "../contract/schema.ts";
import { checkDraft } from "./draft.ts";
import { type JudgeInput, writeJson } from "./input.ts";
import { captureMcpResult, isMcpToolName, type McpResultLike } from "./materials.ts";
import { JUDGE_SECTION, JUDGE_SENTINEL, judgeFirstMessage, judgeInstructions } from "./prompt.ts";
import { resultText, stopDescription, type ToolLogEntry, trackSession, zeroUsage } from "./record.ts";

export const JUDGE_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "submit_contract"];
export const SUBMIT_CONTRACT = "submit_contract";

export const SubmitContractSchema = Type.Object({
  ...JudgeDraftSchema.properties,
  rationale: Type.String({ description: "Why you chose these conditions and prohibitions. Evaluation log only; the agent never sees it." }),
});

export type JudgeAttempt = { at: string; valid: boolean; errors?: string[] };

export type JudgeRecord = {
  status: "submitted" | "failed";
  draft?: JudgeDraft;
  rationale?: string;
  attempts: JudgeAttempt[];
  materials: Material[];
  usage: Usage;
  durationMs: number;
  toolLog: ToolLogEntry[];
  stopReason?: string;
  error?: string;
};

export type JudgeSession = {
  factory: (pi: ExtensionAPI) => void;
  record(): JudgeRecord;
  write(error?: string): JudgeRecord;
};

function splitDraft(params: Record<string, unknown>): { draft: JudgeDraft; rationale: string } {
  const { rationale, ...rest } = params as JudgeDraft & { rationale: string };
  return { draft: rest as JudgeDraft, rationale };
}

export function judgeSession(input: JudgeInput, outFile: string, clock: () => number = Date.now): JudgeSession {
  const startedAt = clock();
  const captured: Material[] = [];
  const attempts: JudgeAttempt[] = [];
  let accepted: { draft: JudgeDraft; rationale: string } | undefined;
  let invalid = 0;
  let stopError: string | undefined;
  let tracker: ReturnType<typeof trackSession> | undefined;
  let firstInputPending = true;

  const materials = () => [...input.materials, ...captured];

  const record = (error?: string): JudgeRecord => {
    const r: JudgeRecord = {
      status: accepted !== undefined ? "submitted" : "failed",
      attempts: [...attempts],
      materials: [...captured],
      usage: tracker?.usage ?? zeroUsage(),
      durationMs: clock() - startedAt,
      toolLog: [...(tracker?.toolLog ?? [])],
    };
    if (accepted !== undefined) {
      r.draft = accepted.draft;
      r.rationale = accepted.rationale;
    }
    if (tracker?.stopReason !== undefined) r.stopReason = tracker.stopReason;
    if (accepted === undefined) {
      r.error = error ?? stopError ?? (tracker !== undefined ? stopDescription(tracker, SUBMIT_CONTRACT) : "the judge did not start");
    }
    return r;
  };

  const write = (error?: string) => {
    const r = record(error);
    writeJson(outFile, r);
    return r;
  };

  const factory = (pi: ExtensionAPI) => {
    tracker = trackSession(pi);

    pi.registerTool(defineTool<typeof SubmitContractSchema, { duplicate?: boolean; accepted?: boolean }>({
      name: SUBMIT_CONTRACT,
      label: "Submit contract",
      description: "Submit the session contract and finish. The harness validates it; on errors you get them back and can submit again. Call it alone, as your last action.",
      promptSnippet: "Submit the session contract (call it alone, last)",
      parameters: SubmitContractSchema,
      async execute(_toolCallId, params) {
        if (accepted !== undefined) {
          return { content: [{ type: "text", text: "The contract was already accepted. Stop now." }], details: { duplicate: true }, terminate: true };
        }
        const { draft, rationale } = splitDraft(params as Record<string, unknown>);
        const check = checkDraft(draft, input, materials());
        if (!check.ok) {
          const left = input.maxInvalidSubmissions - invalid - 1;
          const tail = left > 0
            ? `Fix these and call submit_contract again (${left} attempt${left === 1 ? "" : "s"} left).`
            : "No attempts are left; the harness stops you and uses a fallback contract.";
          throw new Error(`The contract was rejected:\n- ${check.errors.join("\n- ")}\n${tail}`);
        }
        accepted = { draft, rationale };
        attempts.push({ at: new Date().toISOString(), valid: true });
        write();
        return { content: [{ type: "text", text: "Contract accepted. Stop now." }], details: { accepted: true }, terminate: true };
      },
    }));

    pi.on("tool_execution_end", (event, ctx) => {
      if (event.toolName !== SUBMIT_CONTRACT) return;
      if (!event.isError) return;
      invalid++;
      const text = resultText(event.result);
      const listed = text.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
      attempts.push({ at: new Date().toISOString(), valid: false, errors: listed.length > 0 ? listed : [text] });
      if (invalid >= input.maxInvalidSubmissions && accepted === undefined) {
        stopError = `the judge made ${invalid} invalid submissions`;
        ctx.abort();
      }
    });

    pi.on("turn_end", (event, ctx) => {
      if (accepted !== undefined && event.toolResults.some((r) => r.toolName !== SUBMIT_CONTRACT)) ctx.abort();
    });

    pi.on("input", (event) => {
      if (firstInputPending && event.text.endsWith(JUDGE_SENTINEL)) {
        firstInputPending = false;
        return { action: "transform" as const, text: judgeFirstMessage(input) };
      }
      firstInputPending = false;
      return { action: "continue" as const };
    });

    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections[JUDGE_SECTION] = judgeInstructions(input);
    });

    if (input.mcp) {
      pi.on("tool_result", (event) => {
        if (!isMcpToolName(event.toolName)) return undefined;
        try {
          const { captured: added, note } = captureMcpResult(event as unknown as McpResultLike, materials(), input.paths.materialsDir);
          if (added.length === 0) return undefined;
          captured.push(...added);
          return {
            content: [...event.content, { type: "text" as const, text: note }],
            ...(event.structuredContent !== undefined ? { structuredContent: event.structuredContent } : {}),
          };
        } catch (e) {
          process.stderr.write(`pi-harness judge: could not save the MCP result as a material: ${(e as Error).message}\n`);
          return undefined;
        }
      });
    }

    pi.on("session_shutdown", () => {
      write();
    });
  };

  return { factory, record, write };
}
