import { fauxAssistantMessage, fauxProvider, type TranscriptContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { textOf, tools } from "./faux-workers.ts";

function contractSection(ctx: TranscriptContext): string {
  let section = "";
  for (const m of ctx.messages) {
    const s = (m as { sections?: Record<string, string | null> }).sections?.session_contract;
    if (typeof s === "string") section = s;
  }
  return section;
}

export default function fauxJudgeWorkExtension(pi: ExtensionAPI): void {
  const expected = (process.env.PI_HARNESS_EXPECT_SECTION ?? "").split("\u001f").filter((s) => s !== "");
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }] });
  faux.setResponses([
    (ctx) => {
      const missing = expected.filter((s) => !contractSection(ctx).includes(s));
      return missing.length === 0
        ? tools(["write", { path: "value.txt", content: "ok\n" }])
        : fauxAssistantMessage(`UNEXPECTED: contract section misses ${JSON.stringify(missing)}. Last message: ${textOf(ctx.messages[ctx.messages.length - 1]).slice(0, 300)}`);
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
