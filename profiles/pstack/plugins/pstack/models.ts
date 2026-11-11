export const roles = {
  "feature, refactoring": "grok", "bug-fix": "grok", "perf-issue": "grok", hillclimb: "grok",
  "judgment and prose": "claude", "hardest tasks": "claude", "how explorer": "grok", "how explainer": "claude",
  "why investigators": "grok", "why synthesizer": "claude", "reflect tooling": "grok",
  "reflect judgment, divergent, synthesizer": "claude", "arena runners": "panel", "arena cross-judge pool": "pool",
  "swarm workers": "grok", "architect runners": "panel", "interrogate reviewers": "panel",
} as const;
export type Role = keyof typeof roles;
export const budgets = { unlimited: "max", large: "xhigh", medium: "high", small: "medium" } as const;
export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = typeof efforts[number];
export type Config = { version: 1; budget?: keyof typeof budgets; roles?: Partial<Record<Role, string | string[]>>; families?: Record<string, string> };
export type CatalogModel = { providerID: string; id: string; name?: string; cost?: unknown[]; family?: string; variants?: Record<string, unknown>; capabilities?: { output?: readonly string[] } };
export type Choice = { ref: string; model: string; provider: string; name?: string; cost?: unknown[]; family?: string; effort?: Effort; fast: boolean };
export type Job = { difficulty?: "routine" | "judgment" | "standard" | "hardest"; urgent?: boolean; verification?: boolean; defaultModel?: string; independent?: boolean; independentOf?: string };
export type Selection = { model?: string; notices: string[]; family?: string; source: string };

export function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Model configuration must be an object");
  const c = value as Config;
  if (c.version !== 1 || (c.budget !== undefined && !Object.hasOwn(budgets, c.budget))) throw new Error("Invalid model configuration version or budget");
  if (c.roles !== undefined && (!c.roles || typeof c.roles !== "object" || Array.isArray(c.roles))) throw new Error("roles must be an object");
  for (const [role, entry] of Object.entries(c.roles ?? {})) {
    if (!Object.hasOwn(roles, role)) throw new Error(`Unknown role: ${role}`);
    const list = roles[role as Role] === "panel" || roles[role as Role] === "pool";
    if (list ? !Array.isArray(entry) || !entry.length || entry.some(v => typeof v !== "string" || !v.trim()) : typeof entry !== "string" || !entry.trim()) throw new Error(`Invalid model selection for ${role}`);
  }
  if (c.families !== undefined && (!c.families || typeof c.families !== "object" || Array.isArray(c.families) || Object.values(c.families).some(v => typeof v !== "string" || !v.trim()))) throw new Error("Invalid model family mapping");
  return c;
}
export function family(id: string, declared?: string): string | undefined {
  if (typeof declared === "string" && declared.trim()) return family(declared) ?? declared.trim().toLowerCase();
  const value = id.toLowerCase();
  if (/\b(grok|composer)(?:\b|[-_])/.test(value)) return "grok";
  if (/\bclaude(?:\b|[-_])/.test(value)) return "claude";
  if (/\b(gpt|o[134])(?:\b|[-_])/.test(value)) return "gpt";
  if (/\bgemini(?:\b|[-_])/.test(value)) return "gemini";
  return undefined;
}
export function choices(models: CatalogModel[], config: Config): Choice[] {
  return models.flatMap(m => {
    if (m.capabilities?.output && !m.capabilities.output.includes("text")) return [];
    const base = `${m.providerID}/${m.id}`;
    const variants = Object.keys(m.variants ?? {});
    const refs = [undefined, ...variants];
    return refs.map(variant => ({ ref: `${base}${variant ? `#${variant}` : ""}`, model: m.id, provider: m.providerID, name: m.name, cost: m.cost,
      family: family(m.id, config.families?.[base] ?? m.family),
      effort: [...efforts].reverse().find(e => new RegExp(`(?:^|[-_#])${e}(?:$|[-_])`).test(variant ?? m.id)),
      fast: /(?:^|[-_])fast(?:$|[-_])/.test(`${m.id}${variant ? `-${variant}` : ""}`) }));
  });
}
const alias = (value: string) => value === "auto" || value === "inherit-parent";
const rank = (effort?: Effort) => effort ? efforts.indexOf(effort) : -1;
const stem = (model: string) => model.replace(/(?:[-_](?:max|xhigh|high|medium|low|fast))+$/g, "");
const identity = (model: string) => stem(model).replace(/[^a-z0-9]/gi, "").toLowerCase();

function nearest(candidates: Choice[], effort: Effort, fast: boolean, provider?: string): Choice | undefined {
  const target = rank(effort);
  return [...candidates].sort((a, b) => {
    // Setup's fallback chooses the highest advertised effort at/below target.
    const score = (c: Choice) => (c.fast !== fast ? 100 : 0) + (rank(c.effort) < 0 ? 40 : rank(c.effort) > target ? 20 + rank(c.effort) - target : target - rank(c.effort)) + (provider && c.provider !== provider ? 0.1 : 0);
    return score(a) - score(b) || a.ref.localeCompare(b.ref);
  })[0];
}
function sourceDefault(kind: "claude" | "grok", catalog: Choice[], effort: Effort, provider?: string): Choice | undefined {
  const target = kind === "grok" ? "grok47" : "claudeopus55";
  const exact = catalog.filter(c => c.family === kind && identity(c.model).endsWith(target));
  return nearest(exact, effort, kind === "grok", provider);
}
export function entries(config: Config, role: Role): string[] {
  if (!Object.hasOwn(roles, role)) throw new Error(`A pstack role is required: ${Object.keys(roles).join(", ")}`);
  const configured = config.roles?.[role];
  if (configured !== undefined) return typeof configured === "string" ? [configured] : [...configured];
  return roles[role] === "panel" || roles[role] === "pool" ? ["default:claude", "default:grok"] : [`default:${roles[role]}`];
}
export function select(value: string, config: Config, catalog: Choice[], parent: string | undefined, job: Job = {}, rejected = new Set<string>(), fallback: "normal" | "panel" | "pool" = "normal", workflowDefault?: "grok" | "claude"): Selection {
  const notices: string[] = [];
  const result = (choice?: Choice): Selection => ({ model: choice?.ref, family: choice?.family, notices, source: value });
  if (alias(value)) return { model: parent, family: catalog.find(c => c.ref === parent)?.family, notices, source: value };
  const effort = budgets[config.budget ?? "large"];
  const parentProvider = parent?.split("/")[0];
  const defaultFamily = value === "default:grok" ? "grok" : value === "default:claude" ? "claude" : undefined;
  let baseline = defaultFamily ? sourceDefault(defaultFamily, catalog, effort, parentProvider) : catalog.find(c => c.ref === value);
  let wantedFamily = defaultFamily ?? baseline?.family ?? family(value.split("/").slice(1).join("/"), config.families?.[value.split("#")[0]]);
  if (!baseline) notices.push(`${value} is not advertised by the provider; applying the calling workflow's fallback.`);
  if (baseline) {
    const startingEffort = baseline.effort ?? effort;
    const delta = job.difficulty === "routine" ? -2 : job.difficulty === "judgment" ? -1 : job.difficulty === "hardest" ? 1 : 0;
    const target = efforts[Math.max(0, Math.min(efforts.length - 1, rank(startingEffort) + delta))];
    const sameModel = catalog.filter(c => c.provider === baseline!.provider && c.family === baseline!.family && stem(c.model) === stem(baseline!.model));
    const adjusted = nearest(sameModel, target, job.verification ? baseline.fast : !!job.urgent, baseline.provider) ?? baseline;
    if (!rejected.has(adjusted.ref)) return result(adjusted);
    notices.push(`${adjusted.ref} was rejected; retry the original role model before any alternative adjustment.`);
    if (!rejected.has(baseline.ref)) return result(baseline);
    notices.push(`${baseline.ref} was also rejected.`);
  }
  if (fallback === "panel" && (wantedFamily === "claude" || wantedFamily === "grok")) {
    const familyDefault = sourceDefault(wantedFamily, catalog, effort, parentProvider);
    if (familyDefault && !rejected.has(familyDefault.ref)) { notices.push(`Using the ${wantedFamily} default for this seat.`); return result(familyDefault); }
  }
  if (workflowDefault) {
    const originalDefault = sourceDefault(workflowDefault, catalog, effort, parentProvider);
    if (originalDefault && !rejected.has(originalDefault.ref)) { notices.push(`Using this workflow's original ${workflowDefault} default after the configured model failed.`); return result(originalDefault); }
    wantedFamily = workflowDefault;
    baseline = originalDefault;
  }
  // Pool fallback stays on the same model before trying the next configured entry.
  const alternatives = catalog.filter(c => !rejected.has(c.ref) && wantedFamily && c.family === wantedFamily && (fallback !== "pool" || (baseline && stem(c.model) === stem(baseline.model))));
  const alternative = nearest(alternatives, baseline?.effort ?? effort, baseline?.fast ?? defaultFamily === "grok", baseline?.provider ?? parentProvider);
  if (alternative) { notices.push(`Using advertised same-family fallback ${alternative.ref}.`); return result(alternative); }
  if (fallback === "normal") { notices.push("No eligible same-family model remains; inherit the parent model."); return { ...result(), model: parent }; }
  notices.push("No eligible model remains for this entry.");
  return result();
}
export function resolveRole(config: Config, role: Role, catalog: Choice[], parent?: string, job: Job = {}, rejected = new Set<string>()) {
  const values = job.defaultModel && config.roles?.[role] === undefined && !["panel", "pool"].includes(roles[role]) ? [job.defaultModel] : entries(config, role);
  const kind = roles[role];
  if (kind === "pool") {
    const parentFamily = referenceFamily(job.independentOf ?? parent, config, catalog);
    if (job.independent && !parentFamily) return [{ source: "pool", notices: ["Cannot prove the work model's family; independent review must be NOT RUN until it is identified."] }];
    const notes: string[] = [];
    const candidates = [...values, "default:claude", "default:grok"];
    for (const value of [...new Set(candidates)]) {
      if (alias(value)) continue;
      const candidate = select(value, config, catalog, parent, job, rejected, "pool");
      notes.push(...candidate.notices);
      if (!candidate.model || (parentFamily && candidate.family === parentFamily)) continue;
      if (parentFamily && !candidate.family) { notes.push(`Unknown candidate family: ${candidate.model}; cannot prove independence.`); continue; }
      if (!parentFamily) notes.push("Parent family is unknown; the family check did not run.");
      return [{ ...candidate, notices: notes }];
    }
    return [{ source: "pool", notices: [...notes, "No cross-family judge runs; report the skipped cross-judge phase."] }];
  }
  const workflowDefault = ["how explorer", "why investigators", "reflect tooling", "swarm workers"].includes(role) ? "grok" : ["how explainer", "why synthesizer", "reflect judgment, divergent, synthesizer"].includes(role) ? "claude" : undefined;
  const selected = values.map(value => select(value, config, catalog, parent, job, rejected, kind === "panel" ? "panel" : "normal", workflowDefault));
  if (kind !== "panel") return selected;
  const remaining = selected.filter(selection => selection.model);
  const droppedNotices = selected.filter(selection => !selection.model).flatMap(selection => [`Dropped panel entry ${selection.source}.`, ...selection.notices]);
  const minimum = values.length === 1 ? 1 : 2;
  while (remaining.length < minimum) remaining.push({ model: remaining[0]?.model ?? parent, source: "replacement", notices: ["A configured seat had no eligible model; replace it with a remaining runner's model, or the parent when none remain."] });
  if (remaining.length && droppedNotices.length) remaining[0] = { ...remaining[0], notices: [...droppedNotices, ...remaining[0].notices] };
  return remaining;
}

export function referenceFamily(ref: string | undefined, config: Config, catalog: Choice[]) {
  return ref ? catalog.find(c => c.ref === ref)?.family ?? family(ref.split("/").slice(1).join("/"), config.families?.[ref.split("#")[0]]) : undefined;
}

/** Setup plans never silently fill unavailable roles with the parent model. */
export function budgetPlan(config: Config, catalog: Choice[], budget: keyof typeof budgets, preferredProvider?: string) {
  const effort = budgets[budget], target = rank(effort);
  const map = (value: string): string | null => {
    if (alias(value)) return value;
    const kind = value === "default:grok" ? "grok" : value === "default:claude" ? "claude" : undefined;
    const base = kind ? sourceDefault(kind, catalog, effort, preferredProvider) : catalog.find(c => c.ref === value);
    const f = kind ?? base?.family;
    const eligible = catalog.filter(c => c.effort && rank(c.effort) <= target && f && c.family === f);
    const same = base ? eligible.filter(c => c.provider === base.provider && stem(c.model) === stem(base.model)) : [];
    const selected = nearest(same.length ? same : eligible, effort, base?.fast ?? kind === "grok", base?.provider);
    return selected?.ref ?? null;
  };
  const rows = (Object.keys(roles) as Role[]).map(role => {
    const models = entries(config, role).map(map);
    return { role, kind: roles[role], models, needsChoice: models.some(m => m === null) };
  });
  const candidate = rows.some(r => r.needsChoice) ? null : { version: 1, budget, roles: Object.fromEntries(rows.map(row => [row.role, row.kind === "panel" || row.kind === "pool" ? row.models : row.models[0]])), ...(config.families ? { families: config.families } : {}) };
  return { budget, targetEffort: effort, rows, config: candidate };
}

export function validateModels(value: unknown, catalog: Choice[]): Config {
  const config = parseConfig(value);
  for (const [role, entry] of Object.entries(config.roles ?? {})) {
    for (const model of typeof entry === "string" ? [entry] : entry!) {
      if (!alias(model) && !catalog.some(choice => choice.ref === model)) throw new Error(`Unavailable model for ${role}: ${model}`);
    }
  }
  return config;
}
