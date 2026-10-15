import { type AssistantMessage, type FauxResponseStep, fauxProvider, type JsonObject, type TranscriptContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { say, systemText, textOf, toolNames, tools } from "./faux-workers.ts";

const JUDGE_MARKER = "You are the judge of pi-harness.";
const EFFORT_MARKER = "You decide how much effort the working agent of pi-harness should spend on a task.";

export const VALID_DRAFT: JsonObject & { refinedGoal: string; rationale: string } = {
  refinedGoal: "Make value.txt contain ok so that node check.js passes.",
  doneConditions: [
    { statement: "check.js passes", basis: "repo config step", verify: { kind: "command", command: "node check.js", timeoutSec: 30 } },
    { statement: "value.txt holds a single line", verify: { kind: "reported", how: "Open value.txt and report its content." } },
  ],
  prohibitions: [{ text: "Do not edit check.js.", source: { kind: "repo-rules", ref: "AGENTS.md: Never edit check.js." } }],
  materialIds: ["M1"],
  rationale: "check.js is the repo's completion step; the rule file forbids editing check.js.",
};

const INVALID_DRAFT: JsonObject = { ...VALID_DRAFT, materialIds: ["M9"], rationale: "first try" };

type Msg = { role: string; toolName?: string; isError?: boolean };
const last = (ctx: TranscriptContext) => ctx.messages[ctx.messages.length - 1] as Msg | undefined;
const firstUser = (ctx: TranscriptContext) => textOf(ctx.messages.find((m) => m.role === "user"));
const unexpected = (why: string, ctx: TranscriptContext) =>
  say(`UNEXPECTED: ${why}. Last message: ${textOf(ctx.messages[ctx.messages.length - 1]).slice(0, 500)}`);

function judgeStep(ctx: TranscriptContext, scenario: string): AssistantMessage {
  const names = toolNames(ctx).join(",");
  if (names !== (process.env.PI_FAUX_JUDGE_TOOLS ?? "find,grep,ls,read,submit_contract")) return unexpected(`judge tools are ${names}`, ctx);
  const sys = systemText(ctx);
  if (!sys.includes("REFERENCE EXAMPLES") || !sys.includes("not presets")) return unexpected("judge instructions missing", ctx);
  const expected = (process.env.PI_FAUX_EXPECT_JUDGE ?? "").split("\u001f").filter((s) => s !== "");
  const missing = expected.filter((s) => !firstUser(ctx).includes(s));
  if (missing.length > 0) return unexpected(`judge request misses ${JSON.stringify(missing)}`, ctx);
  const m = last(ctx);
  if (scenario === "B") return say("I looked around and have nothing to submit.");
  if (scenario === "D") {
    if (m?.role === "user" || (m?.toolName === "submit_contract" && m.isError === true)) return tools(["submit_contract", INVALID_DRAFT]);
    return unexpected("the judge was asked again after three invalid submissions", ctx);
  }
  if (m?.role === "user") return tools(["read", { path: "check.js" }]);
  if (m?.toolName === "read") return tools(["submit_contract", INVALID_DRAFT]);
  if (m?.toolName === "submit_contract" && m.isError === true) {
    return textOf(m as never).includes("M9") ? tools(["submit_contract", VALID_DRAFT]) : unexpected("the rejection does not name M9", ctx);
  }
  return unexpected("judge transcript in an unexpected state", ctx);
}

function effortStep(ctx: TranscriptContext): AssistantMessage {
  const names = toolNames(ctx).join(",");
  if (names !== "submit_effort") return unexpected(`effort tools are ${names}`, ctx);
  const u = firstUser(ctx);
  const expected = (process.env.PI_FAUX_EXPECT_EFFORT ?? "").split("\u001f").filter((s) => s !== "");
  const missing = expected.filter((s) => !u.includes(s));
  if (missing.length > 0) return unexpected(`effort request misses ${JSON.stringify(missing)}`, ctx);
  if (u.includes(VALID_DRAFT.refinedGoal) || u.includes(VALID_DRAFT.rationale)) return unexpected("effort request leaks the refined goal or rationale", ctx);
  return tools(["submit_effort", { level: process.env.PI_FAUX_EFFORT_LEVEL ?? "high", reason: "Two conditions and a rule to respect." }]);
}

const dispatch: FauxResponseStep = (ctx) => {
  const sys = systemText(ctx);
  if (sys.includes(JUDGE_MARKER)) return judgeStep(ctx, process.env.PI_FAUX_JUDGE_SCENARIO ?? "A");
  if (sys.includes(EFFORT_MARKER)) return effortStep(ctx);
  return unexpected("neither the judge nor the effort prompt is present", ctx);
};

export default function fauxJudgeExtension(pi: ExtensionAPI): void {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }] });
  faux.setResponses(Array.from({ length: 12 }, () => dispatch));
  pi.registerProvider("faux", {
    api: faux.api,
    baseUrl: faux.getModel().baseUrl,
    apiKey: "faux-key",
    models: faux.models as never,
    streamSimple: faux.provider.streamSimple,
  });
}
