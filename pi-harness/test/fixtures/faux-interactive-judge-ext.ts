import { type AssistantMessage, type FauxResponseStep, fauxProvider, type JsonObject, type TranscriptContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VALID_DRAFT } from "./faux-judge-ext.ts";
import { say, systemText, textOf, toolNames, tools } from "./faux-workers.ts";

const JUDGE_MARKER = "You are the judge of pi-harness.";
const EFFORT_MARKER = "You decide how much effort the working agent of pi-harness should spend on a task.";

export const INTERACTIVE_DRAFT: JsonObject & { refinedGoal: string } = { ...VALID_DRAFT, materialIds: [] };

const firstUser = (ctx: TranscriptContext) => textOf(ctx.messages.find((m) => m.role === "user"));
const expected = (name: string) => (process.env[name] ?? "").split("\u001f").filter((s) => s !== "");
const unexpected = (why: string, ctx: TranscriptContext) =>
  say(`UNEXPECTED: ${why}. Last message: ${textOf(ctx.messages[ctx.messages.length - 1]).slice(0, 500)}`);

function judgeStep(ctx: TranscriptContext): AssistantMessage {
  const names = toolNames(ctx).join(",");
  if (names !== "find,grep,ls,read,submit_contract") return unexpected(`judge tools are ${names}`, ctx);
  const missing = expected("PI_FAUX_EXPECT_JUDGE").filter((s) => !firstUser(ctx).includes(s));
  if (missing.length > 0) return unexpected(`judge request misses ${JSON.stringify(missing)}`, ctx);
  if (process.env.PI_FAUX_JUDGE_SCENARIO === "B") return say("I looked around and have nothing to submit.");
  const last = ctx.messages[ctx.messages.length - 1] as { role: string; toolName?: string } | undefined;
  if (last?.role === "user") return tools(["read", { path: "check.js" }]);
  if (last?.toolName === "read") return tools(["submit_contract", INTERACTIVE_DRAFT]);
  return unexpected("judge transcript in an unexpected state", ctx);
}

function effortStep(ctx: TranscriptContext): AssistantMessage {
  const missing = expected("PI_FAUX_EXPECT_EFFORT").filter((s) => !firstUser(ctx).includes(s));
  if (missing.length > 0) return unexpected(`effort request misses ${JSON.stringify(missing)}`, ctx);
  return tools(["submit_effort", { level: process.env.PI_FAUX_EFFORT_LEVEL ?? "medium", reason: "Two conditions." }]);
}

const dispatch: FauxResponseStep = (ctx) => {
  const sys = systemText(ctx);
  if (sys.includes(JUDGE_MARKER)) return judgeStep(ctx);
  if (sys.includes(EFFORT_MARKER)) return effortStep(ctx);
  return unexpected("neither the judge nor the effort prompt is present", ctx);
};

export default function fauxInteractiveJudgeExtension(pi: ExtensionAPI): void {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }] });
  faux.setResponses(Array.from({ length: 8 }, () => dispatch));
  pi.registerProvider("faux", {
    api: faux.api,
    baseUrl: faux.getModel().baseUrl,
    apiKey: "faux-key",
    models: faux.models as never,
    streamSimple: faux.provider.streamSimple,
  });
}
