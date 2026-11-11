import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { testHost, ready } from "./test-host";
import { original } from "./port-skill";
const config = JSON.parse(readFileSync(resolve(import.meta.dir, "../opencode.jsonc"), "utf8"));
const host = await testHost({ ...config, plugins: [resolve(import.meta.dir, "../plugins/pstack")] }, { skillSource: resolve(import.meta.dir, "../skills") });
try {
  for (const name of ["bro", "how"]) mkdirSync(resolve(host.project, ".opencode/skills", name), { recursive: true });
  writeFileSync(resolve(host.project, ".opencode/skills/bro/SKILL.md"), "---\nname: bro\ndescription: Personal override\nmetadata: {opencode/autoinvoke: false}\n---\nCUSTOM_BRO\n");
  writeFileSync(resolve(host.project, ".opencode/skills/how/SKILL.md"), original("pstack/skills/how/SKILL.md"));
  mkdirSync(resolve(host.project, ".agents/skills/how"), {recursive:true});
  writeFileSync(resolve(host.project, ".agents/skills/how/SKILL.md"),original("pstack/skills/how/SKILL.md"));
  mkdirSync(resolve(host.project, ".opencode/pstack/skills/bro"),{recursive:true});
  writeFileSync(resolve(host.project, ".opencode/pstack/skills/bro/SKILL.md"),readFileSync(resolve(host.project,".opencode/skills/bro/SKILL.md")));
  await ready(host, "pstack");

  const skills = (await host.client.skill.list({ location: { directory: host.project } })).data;
  const how = skills.find(s => s.id === "how"), bro = skills.find(s => s.id === "bro");
  if (!how || how.content.includes("subagent_type") || how.autoinvoke !== false) throw new Error("A legacy project skill replaced the native profile");
  if (!bro?.content.includes("CUSTOM_BRO") || bro.autoinvoke !== false) throw new Error("The explicit pstack override was not honored");
  const session = await host.client.session.create({ location: { directory: host.project } });
  await host.client.session.skill({ sessionID: session.id, id: "how", resume: false });
  await host.client.session.skill({ sessionID: session.id, id: "bro", resume: false });
  const context = JSON.stringify(await host.client.session.context({ sessionID: session.id }));
  if (context.includes("subagent_type") || !context.includes("CUSTOM_BRO")) throw new Error("Explicit activation did not use the effective native skill");
  writeFileSync(resolve(import.meta.dir, "../provenance/overrides-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), legacyProjectCopyShadowed: true, explicitProjectOverrideHonored: true, invocationPolicyPreserved: true, effectiveBodiesLoaded: true }, null, 2) + "\n");
  console.log("PASS native profile precedence and explicit project skill overrides");
} finally { await host.close(); }
