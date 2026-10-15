import {
  type AssistantMessage, fauxAssistantMessage, type JsonObject, type FauxResponseStep, fauxToolCall, type Message, type TranscriptContext,
} from "@earendil-works/pi-ai";
import { toolNames } from "./faux-workers.ts";

const REMOVED_TOOLS = ["run_check", "record_evidence", "ask_user"];

function textOf(m: Message | undefined): string {
  if (m === undefined) return "";
  const c = (m as { content: unknown }).content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text ?? "" : "")).join("\n") : "";
}

const last = (ctx: TranscriptContext) => textOf(ctx.messages[ctx.messages.length - 1]);
const contractSection = (ctx: TranscriptContext) => {
  let section = "";
  for (const m of ctx.messages) {
    const s = (m as { sections?: Record<string, string | null> }).sections?.session_contract;
    if (typeof s === "string") section = s;
  }
  return section;
};

const tools = (...calls: Array<[string, JsonObject]>): AssistantMessage =>
  fauxAssistantMessage(calls.map(([name, args]) => fauxToolCall(name, args)), { stopReason: "toolUse" });
const say = (text: string): AssistantMessage => fauxAssistantMessage(text);
const unexpected = (why: string, ctx: TranscriptContext) => say(`UNEXPECTED: ${why}. Last message: ${last(ctx).slice(0, 300)}`);

const withContract = (reply: () => AssistantMessage): FauxResponseStep => (ctx) => {
  if (!contractSection(ctx).includes(process.env.PI_HARNESS_EXPECT_GOAL ?? "\u0000")) return unexpected("contract section does not contain the goal", ctx);
  const removed = toolNames(ctx).filter((n) => REMOVED_TOOLS.includes(n));
  if (removed.length > 0) return unexpected(`removed tools are still offered: ${removed.join(", ")}`, ctx);
  return reply();
};

export const scenarios: Record<string, () => FauxResponseStep[]> = {
  inject: () => [
    withContract(() => tools(["write", { path: "value.txt", content: "ok\n" }])),
    say("All done."),
  ],
  resume: () => [
    withContract(() => say("Nothing else to change.")),
  ],
};
