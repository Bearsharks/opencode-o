import { type AssistantMessage, fauxProvider, type TranscriptContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { say, textOf, toolNames, tools } from "./faux-workers.ts";

function contractSection(ctx: TranscriptContext): string {
  let section = "";
  for (const m of ctx.messages) {
    const s = (m as { sections?: Record<string, string | null> }).sections?.session_contract;
    if (typeof s === "string") section = s;
  }
  return section;
}

function firstStep(ctx: TranscriptContext): AssistantMessage {
  const fail = (why: string) => say(`UNEXPECTED: ${why}`);
  const expected = (process.env.PI_HARNESS_EXPECT_SECTION ?? "").split("\u001f").filter((s) => s !== "");
  const missing = expected.filter((s) => !contractSection(ctx).includes(s));
  if (missing.length > 0) return fail(`contract section misses ${JSON.stringify(missing)}`);
  const users = ctx.messages.filter((m) => m.role === "user");
  if (users.length !== 1) return fail(`${users.length} user messages before the first answer`);
  const content = (users[0] as { content: unknown }).content;
  const texts = Array.isArray(content) ? content.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text) : [textOf(users[0])];
  if (texts.length !== 1 || texts[0] !== process.env.PI_HARNESS_EXPECT_USER) return fail(`first user message texts are ${JSON.stringify(texts)}`);
  const hasWorkers = toolNames(ctx).includes("run_workers");
  if (hasWorkers !== (process.env.PI_HARNESS_EXPECT_WORKERS === "1")) return fail(`run_workers declared: ${hasWorkers}; tools ${toolNames(ctx).join(",")}`);
  return tools(["write", { path: "value.txt", content: "ok\n" }]);
}

export default function fauxInteractiveWorkExtension(pi: ExtensionAPI): void {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }] });
  faux.setResponses([
    firstStep,
    tools(["bash", { command: "node check.js" }]),
    say("Done."),
  ]);
  pi.registerProvider("faux", {
    api: faux.api,
    baseUrl: faux.getModel().baseUrl,
    apiKey: "faux-key",
    models: faux.models as never,
    streamSimple: faux.provider.streamSimple,
  });
}
