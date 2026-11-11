import type { Context } from "@opencode/plugin/promise/plugin";
import { localClient } from "./api";

export async function installSupervision(ctx: Context) {
  async function child(id: string, owner: string) {
    let current: any = await ctx.session.get({ sessionID: id as any });
    const target = current;
    const visited = new Set<string>();
    while (current.parentID && !visited.has(current.id)) {
      if (current.parentID === owner) return target;
      visited.add(current.id);
      current = await ctx.session.get({ sessionID: current.parentID });
    }
    throw new Error("The target is not a descendant owned by this session");
  }
  await ctx.tool.transform(editor => editor.add({ name: "pstack_agents", options: { codemode: false },
    description: "Inspect owned descendants without waking them. Hold sends an explicit zero-writes order; stop interrupts. These control orders do not count as reuse for new work. For new work, use a fresh subagent with consolidated scope.",
    input: { type: "object", properties: { action: { enum: ["inspect", "hold", "stop"] }, sessionID: { type: "string" }, reason: { type: "string" } }, required: ["action", "sessionID"], additionalProperties: false }, output: { type: "object" },
    async execute(input: any, context) {
      const target = await child(input.sessionID, context.sessionID);
      if (input.action === "stop") await ctx.session.interrupt({ sessionID: target.id });
      if (input.action === "hold") await ctx.session.synthetic({ sessionID: target.id, resume: true, description: "Parent hold order", text: `HOLD ORDER FROM THE PARENT. Stop all writes and start no new work. Report current state and retain your brief until released. ${input.reason ?? ""}`, delivery: "steer" });
      const active = await (await localClient()).session.active();
      const current = input.action === "inspect" ? target : await ctx.session.get({ sessionID: target.id });
      return { output: JSON.parse(JSON.stringify({ session: current, running: !!active[target.id], action: input.action })) };
    },
  }));
}
