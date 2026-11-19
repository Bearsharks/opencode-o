import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";

export default Plugin.define({
  id: "pstack-test-probe",
  async setup(ctx) {
    await ctx.rpc.register({ id: "pstack-test-probe", methods: { tools: { input: { type: "object" }, output: { type: "object" } }, reloadAgents: { input: { type: "object" }, output: { type: "object" } }, call: { input: { type: "object" }, output: { type: "object" } } }, events: {} }, {
      async reloadAgents() { await ctx.agent.reload(); return { reloaded: true }; },
      async tools() {
        const tools = await ctx.tool.list();
        return { sessionMethods: Object.keys(ctx.session), instructionMethods: Object.fromEntries(Object.entries((ctx.session as any).instructions).map(([key,value]) => [key, typeof value === "object" ? Object.keys(value as any) : typeof value])), tools: tools.map(tool => ({ id: tool.id, input: Schema.isSchema(tool.input) ? Schema.toJsonSchemaDocument(tool.input) : tool.input })) };
      },
      async call(input: any) {
        const tool = (await ctx.tool.list()).find(tool => tool.id === input.tool);
        if (!tool) throw new Error(`Missing tool: ${input.tool}`);
        try { return await tool.execute(input.args, { sessionID: input.sessionID, agent: "pstack" as any, id: "probe-call" as any, messageID: "msg_probe" as any, signal: new AbortController().signal, progress: async () => {} }); }
        catch (error: any) { return { toolError: error.message }; }
      },
    });
  },
});
