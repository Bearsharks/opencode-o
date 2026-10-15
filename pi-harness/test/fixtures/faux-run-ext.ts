import {
  type AssistantMessage, fauxAssistantMessage, fauxProvider, fauxToolCall, type JsonObject, type Message, type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function contractSection(ctx: TranscriptContext): string {
  let section = "";
  for (const m of ctx.messages) {
    const s = (m as { sections?: Record<string, string | null> }).sections?.session_contract;
    if (typeof s === "string") section = s;
  }
  return section;
}

function lastText(ctx: TranscriptContext): string {
  const m = ctx.messages[ctx.messages.length - 1] as Message | undefined;
  const c = (m as { content?: unknown } | undefined)?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text ?? "" : "")).join("\n") : "";
}

const tools = (...calls: Array<[string, JsonObject]>): AssistantMessage =>
  fauxAssistantMessage(calls.map(([name, args]) => fauxToolCall(name, args)), { stopReason: "toolUse" });

export default function fauxRunExtension(pi: ExtensionAPI): void {
  const expected = (process.env.PI_HARNESS_EXPECT_SECTION ?? "").split("\u001f").filter((s) => s !== "");
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }] });
  faux.setResponses([
    (ctx) => {
      const section = contractSection(ctx);
      const missing = expected.filter((s) => !section.includes(s));
      return missing.length === 0
        ? tools(["write", { path: "value.txt", content: "ok\n" }])
        : fauxAssistantMessage(`UNEXPECTED: contract section misses ${JSON.stringify(missing)}. Last message: ${lastText(ctx).slice(0, 300)}`);
    },
    tools(["bash", { command: "node check.js" }]),
    fauxAssistantMessage("Done."),
  ]);
  pi.registerProvider("faux", {
    api: faux.api,
    baseUrl: faux.getModel().baseUrl,
    apiKey: "faux-key",
    models: faux.models as never,
    streamSimple: faux.provider.streamSimple,
  });
}
