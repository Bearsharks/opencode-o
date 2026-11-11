import type { Context } from "@opencode/plugin/promise/plugin";
import { localClient } from "./api";
import { canonical } from "./workspaces";

export async function installProjects(ctx: Context) {
  const changes = await ctx.rpc.register({ id: "pstack-project", methods: { operate: { input: { type: "object" }, output: { type: "object" } } }, events: { changed: { schema: { type: "object", properties: { program: { type: "string" }, key: { type: "string" }, revision: { type: "number" } }, required: ["program", "key", "revision"] } } } }, {
    async operate(input: any, context) {
      if (!input.args || !["get", "list", "put"].includes(input.args.action) || typeof input.args.program !== "string" || !input.args.program || typeof input.writer !== "string") return { toolError: "Invalid program operation" };
      const tool = (await ctx.tool.list()).find(tool => tool.id === "pstack_project")!;
      try { return await tool.execute({ ...input.args, root: undefined }, { sessionID: input.writer, agent: "pstack" as any, messageID: "msg_project" as any, id: "project-rpc" as any, signal: context.signal, progress: async () => {} }); }
      catch (error: any) { return { toolError: error.message }; }
    },
  });
  const writesID = Symbol.for(`opencode-o.pstack.project-writes:${import.meta.url}`);
  const writes: Map<string, Promise<unknown>> = (globalThis as any)[writesID] ??= new Map();
  const workspace = await canonical(ctx.location.directory);
  const keyOf = (program: string, key: string) => `project/${encodeURIComponent(program)}/${encodeURIComponent(key)}`;
  await ctx.tool.transform(editor => editor.add({ name: "pstack_project", options: { codemode: false },
    description: "Persistent, workspace-scoped program store. Use separate keys per PR, worker or independent fact. Read revisions and provide expectedRevision when updating shared facts; stale writes fail. Writes emit rpc.pstack-project.changed events with program, key and revision fields. Subscribe through pstack_schedule using event.type and match for the intended program/key. Keep notes.md as the human tracker and store operational records here.",
    input: { type: "object", properties: { action: { enum: ["get", "list", "put"] }, root: { type: "string", description: "Coordinator workspace directory. Pass the same root to share a program store across worker worktrees." }, program: { type: "string", minLength: 1 }, key: { type: "string", minLength: 1 }, value: {}, expectedRevision: { type: "integer", minimum: 0 }, cursor: { type: "string" } }, required: ["action", "program"], additionalProperties: false }, output: { type: "object" },
    async execute(input: any, context) {
      if (input.root && await canonical(input.root) !== await canonical(ctx.location.directory)) {
        const response: any = await (await localClient()).rpc.call({ rpcID: "pstack-project", method: "operate", location: { directory: input.root }, input: { args: JSON.parse(JSON.stringify({ ...input, root: undefined })), writer: context.sessionID } });
        if (response.output.toolError) throw new Error(response.output.toolError);
        return response.output;
      }
      if (input.action === "list") {
        const page = await ctx.storage.scan({ prefix: `project/${encodeURIComponent(input.program)}/`, after: input.cursor, limit: 100 });
        return { output: { records: page.entries.map(e => e.value), cursor: page.next ?? null } };
      }
      if (!input.key) throw new Error("A record key is required");
      const key = keyOf(input.program, input.key);
      if (input.action === "get") return { output: { record: await ctx.storage.get(key) ?? null } };
      if (input.expectedRevision === undefined || input.value === undefined) throw new Error("put requires value and expectedRevision (0 for a new record)");
      const operationKey = `${workspace}\0${key}`;
      const operation = (writes.get(operationKey) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const previous: any = await ctx.storage.get(key);
        if ((previous?.revision ?? 0) !== input.expectedRevision) throw new Error("Stale project record; reread before changing it");
        const record = { program: input.program, key: input.key, value: input.value, revision: input.expectedRevision + 1, writer: context.sessionID, updated: Date.now() };
        await ctx.storage.set(key, record);
        await changes.events.emit("changed", { program: record.program, key: record.key, revision: record.revision });
        return { output: { record } };
      });
      writes.set(operationKey, operation);
      try { return await operation; } finally { if (writes.get(operationKey) === operation) writes.delete(operationKey); }
    },
  }));
}
