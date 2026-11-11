import { Plugin } from "@opencode/plugin";
import { resolve } from "node:path";
import { loadSkills } from "./skills";
import { installModels } from "./model-runtime";
import { installTodos } from "./todos";
import { installHistory } from "./history";
import { installRoutines } from "./routines";
import { installAgents } from "./agents";
import { installModes } from "./modes";
import { installSchedules } from "./schedules";
import { installSupervision } from "./supervision";
import { installProjects } from "./projects";
import { workspaceContext } from "./storage";

export default Plugin.define({
  id: "pstack",
  async setup(ctx) {
    const workspace = await workspaceContext(ctx);
    await installAgents(ctx);
    await installModels(ctx);
    await installTodos(ctx);
    await installHistory(ctx);
    await installSupervision(ctx);
    await installProjects(workspace);
    const skills = loadSkills(resolve(import.meta.dir, "../../skills"));
    await ctx.skill.transform(editor => {
      for (const skill of skills) {
        for (const existing of editor.list().filter(item => item.name === skill.name)) {
          editor.remove(existing.id);
        }
        editor.add(skill);
      }
    });
    await ctx.command.transform(editor => {
      for (const skill of skills) editor.add({
        name: skill.name,
        description: skill.description,
        async execute(input) {
          await ctx.session.prompt({ sessionID: input.sessionID, ...input.prompt,
            skills: [...(input.prompt.skills ?? []).filter(item => item.id !== skill.id), { id: skill.id }], delivery: input.delivery });
        },
      });
    });
    await installModes(ctx);
    const stopSchedules = await installSchedules(ctx);
    try { const stopRoutines = await installRoutines(workspace); return async () => { await stopSchedules(); await stopRoutines(); }; }
    catch (error) { await stopSchedules(); throw error; }
  },
});
