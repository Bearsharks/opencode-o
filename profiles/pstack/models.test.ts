import { expect, test } from "bun:test";
import { choices, entries, parseConfig, resolveRole, select, roles, budgetPlan, validateModels, type Config } from "./plugins/pstack/models";
import { rejectionStore } from "./plugins/pstack/model-runtime";

const config: Config = { version: 1 };
const variants = Object.fromEntries(["low", "medium", "high", "xhigh", "max"].map(v => [v, {}]));
const inventory = [
  { providerID: "local", id: "grok-4.7", variants: { low: {}, medium: {}, high: {}, xhigh: {} } },
  { providerID: "local", id: "grok-4.7-fast", variants: { low: {}, medium: {}, high: {}, xhigh: {} } },
  { providerID: "local", id: "claude-opus-5-5", variants },
  { providerID: "local", id: "gpt-parent", variants },
];
const catalog = choices(inventory, config);
const parent = "local/gpt-parent#high";

test("image-only catalogue entries cannot become subagent fallback models", () => {
  expect(choices([{ providerID: "local", id: "gpt-image", capabilities: { output: ["image"] } }], config)).toEqual([]);
});
test("unknown role and budget keys cannot pass through inherited object properties", () => {
  expect(() => parseConfig({ version: 1, budget: "constructor" })).toThrow();
  expect(() => parseConfig(JSON.parse('{"version":1,"roles":{"__proto__":"auto"}}'))).toThrow();
});
test("explicit family mappings win over proxy aliases when proving independent judges", () => {
  const c = parseConfig({ version: 1, families: { "local/composer-proxy": "gpt" }, roles: { "arena cross-judge pool": ["local/composer-proxy#high", "local/claude-opus-5-5#high"] } });
  const options = choices([...inventory, { providerID: "local", id: "composer-proxy", family: "grok", variants }], c);
  expect(options.find(model => model.ref === "local/composer-proxy#high")?.family).toBe("gpt");
  expect(resolveRole(c, "arena cross-judge pool", options, parent)[0].model).toBe("local/claude-opus-5-5#high");
});
test("cheap workflow defaults preserve saved role overrides and reasoning budgets", () => {
  const job = { defaultModel: "local/gpt-parent", difficulty: "routine" as const };
  expect(resolveRole({ version: 1, budget: "small" }, "how explorer", catalog, parent, job)[0].model).toBe("local/gpt-parent#low");
  const configured = parseConfig({ version: 1, roles: { "how explorer": "local/claude-opus-5-5#xhigh" } });
  expect(resolveRole(configured, "how explorer", catalog, parent, job)[0].model).toBe("local/claude-opus-5-5#medium");
});
test("effort adjustment does not silently switch the configured provider", () => {
  const options = choices([...inventory, { providerID: "other", id: "grok-4.7", variants }], config);
  expect(select("local/grok-4.7#xhigh", config, options, parent, { difficulty: "hardest" }).model).toBe("local/grok-4.7#xhigh");
});
test("setup plans all 17 roles and preserves aliases, duplicate seats and provider identities", () => {
  const current = parseConfig({ version: 1, roles: { "how explorer": "auto", "arena runners": ["inherit-parent", "local/claude-opus-5-5#medium", "inherit-parent"] } });
  const plan = budgetPlan(current, catalog, "unlimited");
  expect(plan.rows).toHaveLength(17);
  expect(plan.config?.roles["how explorer"]).toBe("auto");
  expect(plan.config?.roles["arena runners"]).toEqual(["inherit-parent", "local/claude-opus-5-5#max", "inherit-parent"]);
  expect(plan.config?.roles["bug-fix"]).toBe("local/grok-4.7-fast#xhigh");
  expect(validateModels(plan.config, catalog).budget).toBe("unlimited");
});
test("setup marks unavailable defaults as needing a choice rather than silently inheriting", () => {
  const plan = budgetPlan(config, choices([inventory[3]], config), "large");
  expect(plan.config).toBeNull();
  expect(plan.rows.every(row => row.needsChoice)).toBe(true);
  expect(() => validateModels({ version: 1, roles: { "bug-fix": "missing/model#high" } }, catalog)).toThrow();
});
test("mandatory audit compares against the work model and refuses unknown-family self-review", () => {
  expect(resolveRole(config, "arena cross-judge pool", catalog, parent, { independent: true, independentOf: "local/claude-opus-5-5#high" })[0].model).toBe("local/grok-4.7#xhigh");
  expect(resolveRole(config, "arena cross-judge pool", catalog, parent, { independent: true, independentOf: "proxy/unknown" })[0].model).toBeUndefined();
});

test("all 17 original roles default to original model identities; partial overrides do not replace missing roles", () => {
  expect(Object.keys(roles)).toHaveLength(17);
  const partial = parseConfig({ version: 1, roles: { "bug-fix": "inherit-parent" } });
  expect(resolveRole(partial, "bug-fix", catalog, parent)[0].model).toBe(parent);
  expect(resolveRole(partial, "feature, refactoring", catalog, parent)[0].model).toBe("local/grok-4.7#xhigh");
  expect(resolveRole(partial, "how explainer", catalog, parent)[0].model).toBe("local/claude-opus-5-5#xhigh");
  expect(entries(partial, "architect runners")).toEqual(["default:claude", "default:grok"]);
});
test("all four budgets apply to original defaults and clamp only to advertised effort", () => {
  for (const [budget, claude, grok] of [["unlimited", "max", "xhigh"], ["large", "xhigh", "xhigh"], ["medium", "high", "high"], ["small", "medium", "medium"]] as const) {
    const c = { version: 1 as const, budget };
    expect(resolveRole(c, "hardest tasks", catalog, parent)[0].model).toBe(`local/claude-opus-5-5#${claude}`);
    expect(resolveRole(c, "swarm workers", catalog, parent, { verification: true })[0].model).toBe(`local/grok-4.7-fast#${grok}`);
  }
});
test("panel length, duplicates, parent aliases and order are preserved", () => {
  const c = parseConfig({ version: 1, roles: { "architect runners": ["auto", "local/claude-opus-5-5#high", "auto"] } });
  expect(resolveRole(c, "architect runners", catalog, parent).map(s => s.model)).toEqual([parent, "local/claude-opus-5-5#high", parent]);
  expect(resolveRole(parseConfig({ version: 1, roles: { "arena runners": ["auto"] } }), "arena runners", catalog, parent)).toHaveLength(1);
});
test("rejected adjustment returns to the configured baseline before another effort", () => {
  const c = parseConfig({ version: 1, roles: { "bug-fix": "local/grok-4.7#xhigh" } });
  const rejected = new Set(["local/grok-4.7#medium"]);
  const selected = resolveRole(c, "bug-fix", catalog, parent, { difficulty: "routine" }, rejected)[0];
  expect(selected.model).toBe("local/grok-4.7#xhigh");
  expect(selected.notices.join(" ")).toContain("original role model");
});
test("rejected speed adjustment restores the configured fast baseline; verification preserves speed", () => {
  const original = "local/grok-4.7-fast#xhigh";
  expect(select(original, config, catalog, parent, {}, new Set(["local/grok-4.7#xhigh"])).model).toBe(original);
  expect(select(original, config, catalog, parent, { verification: true }).model).toBe(original);
  expect(select(original, config, catalog, parent, { urgent: true }).model).toBe(original);
});
test("how restores its original role default after a configured model from another family is refused", () => {
  const c = parseConfig({ version: 1, roles: { "how explorer": "local/gpt-parent#xhigh", "how explainer": "local/grok-4.7#xhigh" } });
  expect(resolveRole(c, "how explorer", catalog, parent, {}, new Set(["local/gpt-parent#xhigh"]))[0].model).toBe("local/grok-4.7-fast#xhigh");
  expect(resolveRole(c, "how explainer", catalog, parent, {}, new Set(["local/grok-4.7#xhigh"]))[0].model).toBe("local/claude-opus-5-5#xhigh");
});
test("cross-judge never picks a known parent family, aliases do not judge, pool order is honored", () => {
  const c = parseConfig({ version: 1, roles: { "arena cross-judge pool": ["auto", "local/gpt-parent#high", "local/claude-opus-5-5#medium", "local/grok-4.7#high"] } });
  expect(resolveRole(c, "arena cross-judge pool", catalog, parent)[0].model).toBe("local/claude-opus-5-5#medium");
  const onlyParent = choices([inventory[3]], config);
  expect(resolveRole(c, "arena cross-judge pool", onlyParent, parent)[0].model).toBeUndefined();
});
test("unknown parent family follows upstream exception and explicitly reports that check did not run", () => {
  expect(resolveRole(config, "arena cross-judge pool", catalog)[0].notices.join(" ")).toContain("family check did not run");
});
test("unavailable configured panel seats are dropped and replenished only to original minimum", () => {
  const c = parseConfig({ version: 1, roles: { "arena runners": ["remote/missing", "auto", "auto", "remote/missing2"] } });
  expect(resolveRole(c, "arena runners", catalog, parent).map(s => s.model)).toEqual([parent, parent]);
  const none = parseConfig({ version: 1, roles: { "arena runners": ["remote/missing", "remote/missing2"] } });
  expect(resolveRole(none, "arena runners", catalog, parent).map(s => s.model)).toEqual([parent, parent]);
});
test("parallel model refusals survive separate runtime instances and paginated reads", async () => {
  const data = new Map<string, string>();
  const storage = {
    async set(key: string, value: any) { await Bun.sleep(Math.random() * 3); data.set(key, value); },
    async scan({ prefix, after }: any) {
      const keys = [...data.keys()].filter(k => k.startsWith(prefix) && (!after || k > after)).sort();
      return { entries: keys.slice(0, 1).map(key => ({ key, value: data.get(key)! })), next: keys.length > 1 ? keys[0] : undefined };
    },
  };
  await Promise.all([rejectionStore(storage).add("ses1", "local/code#medium"), rejectionStore(storage).add("ses1", "local/judge#high"), rejectionStore(storage).add("ses2", "other/model")]);
  expect([...await rejectionStore(storage).list("ses1")].sort()).toEqual(["local/code#medium", "local/judge#high"]);
});
