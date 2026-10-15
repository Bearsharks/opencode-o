import { fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scenarios } from "./faux-scenarios.ts";

export default function fauxExtension(pi: ExtensionAPI): void {
  const name = process.env.PI_HARNESS_FAUX_SCENARIO ?? "";
  const steps = scenarios[name];
  if (steps === undefined) throw new Error(`Unknown faux scenario "${name}".`);
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }] });
  faux.setResponses(steps());
  pi.registerProvider("faux", {
    api: faux.api,
    baseUrl: faux.getModel().baseUrl,
    apiKey: "faux-key",
    models: faux.models as never,
    streamSimple: faux.provider.streamSimple,
  });
}
