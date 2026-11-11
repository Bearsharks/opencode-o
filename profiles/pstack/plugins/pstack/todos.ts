import type { Context } from "@opencode/plugin/promise/plugin";

export async function installTodos(ctx: Context) {
  await ctx.tool.transform(editor => editor.add({
    name: "pstack_todo", description: "Read or replace this session's ordered todo list. Copy workflow phase names verbatim before task-specific items. Keep skipped phases with a reason. The list persists across plugin reloads.",
    options: { codemode: false },
    input: { type: "object", properties: { action: { enum: ["read", "write"] }, items: { type: "array", items: {
      type: "object", properties: { id: { type: "string", minLength: 1 }, content: { type: "string", minLength: 1 }, status: { enum: ["pending", "in_progress", "completed", "skipped"] }, reason: { type: "string" } }, required: ["id", "content", "status"], additionalProperties: false,
    } } }, required: ["action"], additionalProperties: false }, output: { type: "object" },
    async execute(input: any, context) {
      const key = `todos/${context.sessionID}`;
      if (input.action === "write") {
        if (!Array.isArray(input.items) || new Set(input.items.map((item: any) => item.id)).size !== input.items.length) throw new Error("A replacement list with unique todo IDs is required");
        if (input.items.some((item: any) => item.status === "skipped" && !item.reason?.trim())) throw new Error("Skipped phases require a reason");
        await ctx.storage.set(key, input.items);
      }
      return { output: { items: await ctx.storage.get(key) ?? [] } };
    },
  }));
}
