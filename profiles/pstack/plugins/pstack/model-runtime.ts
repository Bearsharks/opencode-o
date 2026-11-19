import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withDecision, decisionSchema } from "./work-decision";
import { delegationCriteria } from "./criteria";
import { Schema } from "effect";
import type { Context } from "@opencode/plugin/promise/plugin";
import { roles, budgets, choices, entries, parseConfig, resolveRole, select, budgetPlan, validateModels, referenceFamily, type Config, type Role } from "./models";
import { setupState, saveConfig } from "./model-config";

const ref = (m: any) => m ? `${m.providerID}/${m.id}${m.variant ? `#${m.variant}` : ""}` : undefined;
const output = (value: unknown) => ({ output: JSON.parse(JSON.stringify(value)) });
const modelRefusal = (error: unknown) => /(?:model[^\n]*(?:not found|not valid|invalid|unknown|unavailable|unsupported)|(?:invalid|unknown|unsupported)[^\n]*model|model_not_found)/i.test(typeof error === "string" ? error : JSON.stringify(error));
export async function configAt(path: string): Promise<Config> {
  try { return parseConfig(JSON.parse(await readFile(path, "utf8"))); }
  catch (error: any) { if (error.code === "ENOENT") return { version: 1 }; throw error; }
}
export function rejectionStore(storage: Pick<Context["storage"], "set" | "scan">) {
  const prefix = (session: string) => `rejected-model/${encodeURIComponent(session)}/`;
  return {
    async add(session: string, model: string) { await storage.set(prefix(session) + encodeURIComponent(model), model); },
    async list(session: string) {
      const rejected = new Set<string>();
      let after: string | undefined;
      do {
        const page = await storage.scan({ prefix: prefix(session), after, limit: 100 });
        page.entries.forEach(entry => { if (typeof entry.value === "string") rejected.add(entry.value); });
        after = page.next;
      } while (after);
      return rejected;
    },
  };
}
export async function installModels(ctx: Context) {
  const path = resolve(process.env.OPENCODE_CONFIG_DIR ?? resolve(import.meta.dir, "../.."), "pstack-models.json");
  const rejections = rejectionStore(ctx.storage);
  // Background execution returns before its provider request fails. Persist the
  // refusal in the child's retry hook, before its terminal result wakes the parent.
  await ctx.session.hook("retry", async event => {
    if (!modelRefusal(event.error)) return;
    const child: any = await ctx.session.get({ sessionID: event.sessionID });
    if (child.parentID) {
      await rejections.add(child.parentID, ref(event.model)!);
      event.decision = { retry: false };
    }
  });
  async function state(sessionID: string, override?: Config) {
    const config = override ?? await configAt(path);
    const response: any = await ctx.model.list();
    const models = (Array.isArray(response) ? response : response.data).filter((m: any) => m.enabled !== false).map((m: any) => ({ ...m,
      variants: Array.isArray(m.variants) ? Object.fromEntries(m.variants.map((v: any) => [v.id, v])) : m.variants }));
    const session: any = await ctx.session.get({ sessionID: sessionID as any });
    return { config, catalog: choices(models, config), parent: ref(session.model), rejected: await rejections.list(sessionID) };
  }
  await ctx.tool.transform(editor => {
    editor.add({ name: "pstack_models", description: "Inspect available native models, all 17 role selections and ordered panels. Missing roles use workflow defaults. Use catalog pages for available IDs/cost metadata; plan applies a budget to all roles without saving. Validate and save only the table the user approved, using the reviewed revision. Resolve immediately before delegation; subagent.role is mandatory and re-resolves at execution.",
      options: { codemode: false },
      input: { type: "object", properties: { action: { enum: ["inspect", "catalog", "plan", "validate", "save", "resolve"] }, budget: { enum: Object.keys(budgets) }, config: { type: "object" }, expectedRevision: { type: ["string", "null"] }, query: { type: "string" }, provider: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 }, role: { enum: Object.keys(roles) }, difficulty: { enum: ["routine", "judgment", "standard", "hardest"] }, urgent: { type: "boolean" }, defaultModel: { type: "string", description: "Workflow-specific default from the advertised catalogue, e.g. cheap history mining. Used only when this role has no saved override." }, verification: { type: "boolean" }, independent: { type: "boolean", description: "Require proven cross-family independence; unknown families fail closed." }, independentOf: { type: "string", description: "Native model reference of the model that did the work; defaults to the parent model." } }, required: ["action"], additionalProperties: false },
      output: { type: "object" },
      async execute(input: any, context) {
        const planning = ["plan", "inspect"].includes(input.action) ? await setupState(path) : undefined;
        const s = await state(context.sessionID, planning?.config ?? (["catalog", "validate", "save"].includes(input.action) ? { version: 1 } : undefined));
        if (input.action === "catalog") {
          const filtered = s.catalog.filter(c => (!input.provider || c.provider === input.provider) && `${c.ref} ${c.name ?? ""} ${c.family ?? ""}`.toLowerCase().includes((input.query ?? "").toLowerCase()));
          const offset = input.offset ?? 0, limit = input.limit ?? 20;
          return output({ models: filtered.slice(offset, offset + limit), total: filtered.length, nextOffset: offset + limit < filtered.length ? offset + limit : null });
        }
        if (input.action === "plan") return output({ path, revision: planning!.revision, dropped: planning!.dropped, ...budgetPlan(s.config, s.catalog, input.budget ?? s.config.budget ?? "large", s.parent?.split("/")[0]) });
        if (input.action === "validate" || input.action === "save") {
          const config = validateModels(input.config, s.catalog);
          if (input.action === "validate") return output({ valid: true, config });
          if (!Object.hasOwn(input, "expectedRevision")) throw new Error("save requires the revision from the reviewed plan (null for a new file)");
          return output(await saveConfig(path, config, input.expectedRevision));
        }
        if (input.action === "resolve") {
          if (!Object.hasOwn(roles, input.role)) throw new Error("Specify one of the 17 pstack roles");
          return output({ role: input.role, seats: resolveRole(s.config, input.role, s.catalog, s.parent, input, s.rejected), configured: entries(s.config, input.role) });
        }
        return output({ path, config: s.config, revision: planning?.revision, dropped: planning?.dropped, budgets, parent: s.parent, availableChoices: s.catalog.length,
          roles: Object.fromEntries(Object.keys(roles).map(role => [role, { configured: entries(s.config, role as Role), seats: resolveRole(s.config, role as Role, s.catalog, s.parent, {}, s.rejected) }])) });
      },
    });
    editor.update("subagent", tool => {
      const nativeExecute = tool.execute;
      const document = Schema.isSchema(tool.input) ? Schema.toJsonSchemaDocument(tool.input) : { schema: tool.input as any, definitions: {} };
      const schema = document.schema as any;
      tool.input = { ...schema, $defs: document.definitions, properties: { ...schema.properties,
        role: { type: "string", enum: Object.keys(roles), description: "Required workflow role. Saved role models and budgets apply to every invocation." },
        seat: { type: "integer", minimum: 0, description: "Zero-based panel seat returned by pstack_models. Required for panel roles." },
        difficulty: { enum: ["routine", "judgment", "standard", "hardest"] }, urgent: { type: "boolean" }, defaultModel: { type: "string", description: "Workflow-specific default from the advertised catalogue, e.g. cheap history mining. Used only when this role has no saved override." }, verification: { type: "boolean" }, independent: { type: "boolean", description: "Require proven cross-family independence; unknown families fail closed." }, independentOf: { type: "string", description: "Native model reference of the model that did the work; defaults to the parent model." },
        decision: decisionSchema,
        retainedState: { type: "object", properties: { kind: { enum: ["checkout", "uncommitted-changes", "running-process"] }, reason: { type: "string", minLength: 1 } }, required: ["kind", "reason"], additionalProperties: false,
          description: "Reuse only if the new work strictly needs this expensive-to-move child state. Fixes, retries and follow-ups otherwise start fresh." },
        model: { type: "string", description: "Explicit user choice or a model assigned to a comparison/race arm. Otherwise omit: the required role selects the actual model." },
      }, required: [...schema.required, "role"], additionalProperties: false };
      tool.description += " Every pstack delegation must specify role, and panel calls specify seat. For a Shipping re-review pass the original perspective's sessionID. Other reuse requires retainedState. Do not encode roles in the description.";
      tool.execute = withDecision(async (input: any, context) => {
        const { role, seat, difficulty, urgent, verification, defaultModel, independent, independentOf, retainedState, ...native } = input;
        native.background ??= true;
        if (!Object.hasOwn(roles, role)) throw new Error("Missing pstack role; load the workflow and select its role before delegating");
        const s = await state(context.sessionID);
        const shippingReviewer = native.agent === "shipping-structure" || native.agent === "shipping-behavior";
        if (shippingReviewer && role !== "swarm workers") throw new Error("Use the swarm workers role for Shipping reviewers");
        if (native.sessionID) {
          const shippingRecheck = context.agent === "shipping" && shippingReviewer && verification === true;
          if (!shippingRecheck && (!retainedState?.reason || !["checkout", "uncommitted-changes", "running-process"].includes(retainedState.kind))) throw new Error("Start a fresh child unless expensive-to-move state is strictly required; consolidate all prior directives in its prompt");
          const child: any = await ctx.session.get({ sessionID: native.sessionID });
          if (child.parentID !== context.sessionID || child.agent !== native.agent) throw new Error("Reused child must belong to this parent and retain its agent");
          native.model = ref(child.model);
          if (native.model && s.rejected.has(native.model)) throw new Error("The retained child's model was rejected; start a fresh child using the role fallback and transfer the necessary state");
        } else if (shippingReviewer) {
          const { data: reviewer } = await ctx.agent.get({ agentID: native.agent });
          native.model = ref(reviewer.model);
          if (!native.model || s.rejected.has(native.model)) throw new Error("Configured Shipping reviewer model unavailable: " + native.agent);
        } else {
          const kind = roles[role as Role];
          if (kind === "panel" && !Number.isInteger(seat)) throw new Error("Specify the zero-based panel seat from pstack_models");
          const selection = native.model ? select(native.model, s.config, s.catalog, s.parent, { difficulty, urgent, verification }, s.rejected)
            : resolveRole(s.config, role, s.catalog, s.parent, { difficulty, urgent, verification, defaultModel, independent, independentOf }, s.rejected)[seat ?? 0];
          if (!selection || !selection.model) throw new Error(`No eligible model for ${role} seat ${seat ?? 0}; ${selection?.notices.join(" ") ?? "resolve the panel again"}`);
          native.model = selection.model;
          if (selection.notices.length) await context.progress({ pstack: { role, seat, model: native.model, notices: selection.notices } });
        }
        if (independent) {
          const workFamily = referenceFamily(independentOf ?? s.parent, s.config, s.catalog);
          const reviewFamily = referenceFamily(native.model, s.config, s.catalog);
          if (!workFamily || !reviewFamily || workFamily === reviewFamily) throw new Error("Independent review requires a proven different model family; report NOT RUN instead of self-review");
        }
        try {
          return await nativeExecute(native, context);
        }
        catch (error: any) {
          const message = `${error?.message ?? error} ${JSON.stringify(error?.metadata ?? {})}`;
          if (native.model && modelRefusal(message)) await rejections.add(context.sessionID, native.model);
          throw error;
        }
      }, context => delegationCriteria(ctx,context));
    });
  });
}
