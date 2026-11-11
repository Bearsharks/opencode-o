import type { Context } from "@opencode/plugin/promise/plugin";

/** Native session instructions persist through turns, compaction and service restarts. */
export async function installModes(ctx: Context) {
  const entry = (ctx.session as any).instructions?.entry;
  if (!entry?.put || !entry?.remove) throw new Error("Persistent modes require the OpenCode session instruction-entry API");
  const key = "pstack-mode";
  async function status(sessionID: string) {
    const active = (await entry.list({ sessionID })).some((item: any) => item.key === key);
    return { active, skills: active ? await ctx.storage.get(`mode-selection/${sessionID}`) ?? [] : [] };
  }
  await ctx.tool.transform(editor => editor.add({ name: "pstack_mode", description: "Read persistent mode status. Modes are enabled or disabled by the user's /pstack-mode command, not by automatic skill invocation.",
    options: { codemode: false }, input: { type: "object", properties: {}, additionalProperties: false }, output: { type: "object" },
    async execute(_input, context) { return { output: await status(context.sessionID) }; },
  }));
  await ctx.command.transform(editor => editor.add({ name: "pstack-mode", description: "Keep skills active on every turn: /pstack-mode on poteto-mode [personal-mode]. Use off or status.",
    async execute(input) {
      const args = input.prompt.text.trim().split(/\s+/).filter(Boolean);
      const action = ["on", "off", "status"].includes(args[0]) ? args.shift()! : "on";
      if (action === "off") { await entry.remove({ sessionID: input.sessionID, key }); await ctx.storage.remove(`mode-selection/${input.sessionID}`); }
      if (action === "on") {
        const ids = args.length ? [...new Set(args)] : ["poteto-mode"];
        const response: any = await ctx.skill.list();
        const available = Array.isArray(response) ? response : response.data;
        const selected = ids.map(id => {
          const skill = available.find((skill: any) => skill.id === id || skill.name === id);
          if (!skill) throw new Error(`Unknown skill ${id}. Use /pstack-mode on <skill IDs>, then send the task separately.`);
          return skill;
        });
        const content = selected.map(skill => `# Active mode: ${skill.name}\nSkill file: ${skill.path}\n\n${skill.content}`).join("\n\n");
        await entry.put({ sessionID: input.sessionID, key, value: content });
        await ctx.storage.set(`mode-selection/${input.sessionID}`, selected.map(skill => skill.id));
      }
      const current = await status(input.sessionID);
      await ctx.session.synthetic({ sessionID: input.sessionID, resume: true, description: "Persistent mode setting", text: `Persistent mode status: ${JSON.stringify(current)}. Briefly confirm this setting only; do not start other work from this settings command.`, delivery: input.delivery });
    },
  }));
}
