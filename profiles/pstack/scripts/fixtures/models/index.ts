import { Plugin, Provider, Model } from "@opencode/plugin";

export default Plugin.define({
  id: "pstack-test-models",
  async setup(ctx) {
    await ctx.session.hook("title", event => { event.result = "Local fixture"; });
    if (ctx.options.compactionText) await ctx.session.hook("compaction", event => { event.result = { summary: ctx.options.compactionText }; });
    await ctx.provider.transform(editor => {
      const id = "pstack-test" as any;
      const info = { ...Provider.Info.empty(id), name: "Local deterministic test", activation: "enabled" as const,
        package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: ctx.options.url } };
      const models = ["gpt-parent", "grok-4.7", "grok-4.7-fast", "claude-opus-5-5"].map(name => ({
        ...Model.Info.default(id, name as any), family: name.startsWith("grok") ? "grok" : name.startsWith("claude") ? "claude" : "gpt",
        variants: (name.startsWith("grok") ? ["low", "medium", "high", "xhigh"] : ["low", "medium", "high", "xhigh", "max"]).map(effort => ({ id: effort as any, settings: { reasoningEffort: effort } })),
      }));
      editor.add({ info, models } as any);
    });
  },
});
