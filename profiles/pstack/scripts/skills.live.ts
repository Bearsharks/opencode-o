import { OpenCode } from "@opencode/client";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadSkills } from "../plugins/pstack/skills";

const profile = resolve(import.meta.dir, "..");
const temporary = mkdtempSync(resolve(tmpdir(), "pstack-skills-live-"));
const project = resolve(temporary, "project");
mkdirSync(project);
const password = crypto.randomUUID();
const env = { ...process.env, OPENCODE_CONFIG_DIR: profile, OPENCODE_O_PROFILE: "pstack",
  XDG_CONFIG_HOME: resolve(temporary, "config"), XDG_DATA_HOME: resolve(temporary, "data"),
  XDG_STATE_HOME: resolve(temporary, "state"), XDG_CACHE_HOME: resolve(temporary, "cache"),
  OPENCODE_DB: "pstack-skills-test.db", OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password };
env.OPENCODE_CONFIG = resolve(profile, "opencode.jsonc");
delete env.OPENCODE_CONFIG_CONTENT;
// A disposable server and database; no hosted model request or active-service restart.
const server = Bun.spawn(["opencode", "serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"], { cwd: project, env, stdout: "pipe", stderr: "pipe" });
let logs = "";
const consume = async (stream: ReadableStream<Uint8Array>) => {
  for await (const bytes of stream) logs += new TextDecoder().decode(bytes);
};
const streams = [consume(server.stdout), consume(server.stderr)];
try {
  let url: string | undefined;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    url = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) break;
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    await Bun.sleep(100);
  }
  if (!url) throw new Error(`Server did not announce endpoint: ${logs}`);
  const client = OpenCode.make({ baseUrl: url, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` } });
  const location = { directory: project };
  const expected = loadSkills(resolve(profile, "skills"));
  let actual = (await client.skill.list({ location })).data;
  const readyBy = Date.now() + 15000;
  while (!expected.every(skill => actual.some(found => found.id === skill.id && found.autoinvoke === skill.autoinvoke)) && Date.now() < readyBy) {
    await Bun.sleep(100);
    actual = (await client.skill.list({ location })).data;
  }
  const commands = (await client.command.list({ location })).data;
  const session = await client.session.create({ location, agent: "pstack", title: "Skill fidelity smoke" });
  const results = [];
  for (const skill of expected) {
    const found = actual.find(s => s.id === skill.id);
    if (!found || found.content !== skill.content || found.autoinvoke !== skill.autoinvoke || found.description !== skill.description) {
      console.error(JSON.stringify({ expected: { id: skill.id, autoinvoke: skill.autoinvoke }, actual: { id: found?.id, autoinvoke: found?.autoinvoke, contentEqual: found?.content === skill.content }, plugins: (await client.plugin.list({ location })).data.filter(p => p.id.includes("pstack")) }));
      throw new Error(`Host changed skill: ${skill.name}`);
    }
    if (!commands.some(c => c.name === skill.name)) throw new Error(`Missing command: ${skill.name}`);
    await client.session.skill({ sessionID: session.id, id: skill.id, resume: false });
    const entries = await client.session.context({ sessionID: session.id });
    const contains = (value: unknown): boolean => typeof value === "string" ? value.includes(skill.content.trim()) : !!value && typeof value === "object" && Object.values(value).some(contains);
    if (!contains(entries)) throw new Error(`Explicit skill body not present in session: ${skill.name}; context entries: ${entries.length}`);
    results.push({ name: skill.name, fileSha256: createHash("sha256").update(readFileSync(skill.path)).digest("hex"), contentEqual: true, autoinvoke: found.autoinvoke, commandRegistered: true, explicitSessionLoad: true });
  }
  const evidence = { checkedAt: new Date().toISOString(), server: await client.server.info(), results, limits: "No model inference; proves native catalogue and explicit session instruction loading, not model compliance or task outcomes." };
  writeFileSync(resolve(profile, "provenance/skills-live.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`PASS ${results.length} skills: real OpenCode catalogue, invocation policy, commands and explicit session load`);
} finally {
  server.kill();
  await server.exited;
  await Promise.all(streams);
  rmSync(temporary, { recursive: true, force: true });
}
