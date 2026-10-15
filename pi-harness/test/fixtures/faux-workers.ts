import {
  type AssistantMessage, fauxAssistantMessage, type FauxResponseStep, fauxToolCall, type JsonObject, type Message, type TranscriptContext,
} from "@earendil-works/pi-ai";

export const WORKER_TOOL_NAMES = "find,grep,ls,read,submit_result";

export function textOf(m: Message | undefined): string {
  if (m === undefined) return "";
  const c = (m as { content: unknown }).content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text ?? "" : "")).join("\n") : "";
}

export function systemText(ctx: TranscriptContext): string {
  return ctx.messages
    .filter((m) => m.role === "system")
    .map((m) => [textOf(m), ...Object.values((m as { sections?: Record<string, string | null> }).sections ?? {})].join("\n"))
    .join("\n");
}

export function toolNames(ctx: TranscriptContext): string[] {
  const names = new Set<string>();
  for (const m of ctx.messages) {
    for (const t of (m as { toolsAdded?: Array<{ name: string }> }).toolsAdded ?? []) names.add(t.name);
  }
  return [...names].sort();
}

export const say = (text: string): AssistantMessage => fauxAssistantMessage(text);
export const tools = (...calls: Array<[string, JsonObject]>): AssistantMessage =>
  fauxAssistantMessage(calls.map(([name, args]) => fauxToolCall(name, args)), { stopReason: "toolUse" });

const firstUser = (ctx: TranscriptContext) => textOf(ctx.messages.find((m) => m.role === "user"));

export const workerStep: FauxResponseStep = (ctx) => {
  const sys = systemText(ctx);
  if (!sys.includes("<worker_task>")) return say("UNEXPECTED: a worker step got a request without the worker prompt");
  const names = toolNames(ctx).join(",");
  if (names !== WORKER_TOOL_NAMES) return say(`UNEXPECTED: worker tools are ${names}`);
  const file = /Read (\S+)/.exec(firstUser(ctx))?.[1];
  if (file === undefined) return say("UNEXPECTED: no file in the worker task");
  const last = ctx.messages[ctx.messages.length - 1];
  if (last?.role === "toolResult") {
    return tools(["submit_result", { summary: `${file} says ${textOf(last).trim()}`, evidence: [file] }]);
  }
  return tools(["read", { path: file }]);
};
