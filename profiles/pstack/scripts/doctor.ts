import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadSkills } from "../plugins/pstack/skills";

const root = resolve(import.meta.dir, "..");
const expected = loadSkills(resolve(root, "skills"));
if (expected.length !== 64) throw new Error(`Expected 58 original, 3 companion and 3 native skills; got ${expected.length}`);
if (realpathSync(resolve(root, "bundled-skills")) !== realpathSync(resolve(root, "skills"))) throw new Error("bundled-skills must resolve to the managed skill tree");
if (!existsSync(resolve(root, "provenance/source.json"))) throw new Error("Pinned source manifest is missing");
const wrapper = process.argv[2];
if (!wrapper) { console.log("PASS profile assets and 64 skill definitions; pass a launcher path for the managed-service check"); process.exit(0); }

const temp = mkdtempSync(join(tmpdir(), "pstack-launcher-test-"));
const profile = join(temp, "profile"), project = process.env.PSTACK_DOCTOR_PROJECT ?? join(temp, "project");
const scoped = (path: string) => `${path}?location%5Bdirectory%5D=${encodeURIComponent(project)}`;
mkdirSync(profile); if (!process.env.PSTACK_DOCTOR_PROJECT) mkdirSync(project);
for (const name of ["skills", "bundled-skills", "agent-templates"]) symlinkSync(resolve(root, name), join(profile, name));
const config = JSON.parse(readFileSync(resolve(root, "opencode.jsonc"), "utf8"));
config.plugins = [resolve(root, "plugins/pstack")];
writeFileSync(join(profile, "opencode.jsonc"), JSON.stringify(config));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("OPENCODE_") || key === "PSTACK_API_URL" || key === "OC_PSTACK_PROFILE_DIR") delete env[key];
Object.assign(env, { OC_PSTACK_PROFILE_DIR: profile, OPENCODE_O_PSTACK_CONFIG_HOME: join(temp, "config"), OPENCODE_O_PSTACK_STATE_HOME: join(temp, "state"), XDG_DATA_HOME: join(temp, "data"), XDG_CACHE_HOME: join(temp, "cache"), OPENCODE_DB: "pstack-launcher-test.db" });
async function cli(args: string[]) {
  const child = Bun.spawn([resolve(wrapper), ...args], { cwd: project, env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 30000);
  try {
    const [out, , status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status !== 0) throw new Error(`Launcher check failed: ${args.slice(0, 3).join(" ")} (exit ${status}); no credentials printed`);
    return out;
  } finally { clearTimeout(timer); }
}
try {
  const reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reserve.port; await reserve.stop(true);
  await cli(["service", "set", "port", String(port)]);
  let skills: any[] = [], plugins: any[] = [];
  const deadline = Date.now() + 15000;
  do {
    skills = JSON.parse(await cli(["api", "get", scoped("/api/skill")])).data;
    plugins = JSON.parse(await cli(["api", "get", scoped("/api/plugin")])).data;
    if (plugins.some(p => p.id === "pstack" && p.state.status === "failed")) throw new Error("pstack plugin activation failed");
    if (expected.every(s => skills.some(found => found.id === s.id && found.content === s.content))) break;
    await Bun.sleep(100);
  } while (Date.now() < deadline);
  for (const skill of expected) {
    const loaded = skills.find(s => s.id === skill.id);
    // Deliberate project pstack overrides may replace content, but raw originals must not.
    if (!loaded || (loaded.content !== skill.content && !loaded.path?.includes(".opencode/pstack/skills/")) || loaded.autoinvoke !== skill.autoinvoke) throw new Error(`Unexpected effective skill ${skill.id}`);
  }
  const agents = JSON.parse(await cli(["api", "get", scoped("/api/agent")])).data;
  if (!agents.some((a: any) => a.id === "pstack" && a.mode === "primary") || agents.some((a: any) => a.id === "worker")) throw new Error("Wrong profile agent registration");
  const poteto = agents.filter((a: any) => a.id === "poteto-agent");
  if (poteto.length !== 1 || !poteto[0].system?.includes(resolve(root, "skills/poteto-mode/SKILL.md")) || poteto[0].system.includes("@PSTACK_MODE_FILE@")) throw new Error("Poteto delegate path binding failed under launcher discovery");
  const effective = JSON.parse(await cli(["api", "get", scoped("/api/config")]));
  const primary = Array.isArray(effective) ? effective.map(entry => entry.info?.default_agent).filter(Boolean).at(-1) : undefined;
  if (primary !== "pstack") throw new Error(`Unexpected default agent: ${primary}; source keys ${JSON.stringify(Array.isArray(effective) ? effective.map(entry => Object.keys(entry)) : Object.keys(effective))}`);
  const result = { checkedAt: new Date().toISOString(), project, skills: expected.length, primary, potetoAgentBound: true, managedService: true, freshIsolatedDatabase: true, noModelRequest: true, plugins: plugins.map(p => ({ id: p.id, state: p.state.status })) };
  writeFileSync(resolve(root, `provenance/${process.env.PSTACK_DOCTOR_PROJECT ? "project" : "launcher"}-live.json`), JSON.stringify(result, null, 2) + "\n");
  console.log(`PASS launcher, isolated managed service, primary pstack and ${expected.length} effective skills${process.env.PSTACK_DOCTOR_PROJECT ? " in target project" : ""}`);
} finally {
  await cli(["service", "stop"]).catch(() => {});
  rmSync(temp, { recursive: true, force: true });
}
