import { type FauxResponseStep, fauxProvider, type TranscriptContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { say, systemText, textOf, toolNames, tools, workerStep } from "./faux-workers.ts";

const last = (ctx: TranscriptContext) => ctx.messages[ctx.messages.length - 1];
const unexpected = (why: string, ctx: TranscriptContext) => say(`UNEXPECTED: ${why}. Last message: ${textOf(last(ctx)).slice(0, 500)}`);
const task = (title: string, file: string) => ({ title, prompt: `Read ${file} and report its content.`, paths: [file] });

const steps: FauxResponseStep[] = [
  (ctx) => {
    if (!toolNames(ctx).includes("run_workers")) return unexpected("run_workers is not available", ctx);
    if (!systemText(ctx).includes("run_workers starts read-only workers")) return unexpected("run_workers guidelines missing", ctx);
    return tools(["run_workers", { tasks: [task("alpha", "alpha.txt"), task("beta", "beta.txt")] }]);
  },
  workerStep, workerStep, workerStep, workerStep,
  (ctx) => {
    const m = last(ctx);
    const t = textOf(m);
    if (m?.role !== "toolResult" || !t.includes("alpha.txt says ALPHA") || !t.includes("beta.txt says BETA") || !t.includes("2 done")) {
      return unexpected("run_workers result lacks both summaries", ctx);
    }
    return tools(["run_workers", { tasks: [task("a", "alpha.txt"), task("b", "beta.txt"), task("c", "gamma.txt")] }]);
  },
  (ctx) => {
    const m = last(ctx);
    return m?.role === "toolResult" && (m as { isError?: boolean }).isError === true && textOf(m).includes("at most 2 tasks per call")
      ? say("Workers reported alpha and beta. Done.")
      : unexpected("the 3-task call was not rejected with the cap", ctx);
  },
];

export default function fauxWorkersExtension(pi: ExtensionAPI): void {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }] });
  faux.setResponses(steps);
  pi.registerProvider("faux", {
    api: faux.api,
    baseUrl: faux.getModel().baseUrl,
    apiKey: "faux-key",
    models: faux.models as never,
    streamSimple: faux.provider.streamSimple,
  });
}
