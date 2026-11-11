import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSkills, profileRoot, parseMarkdown } from "../plugins/pstack"

const cli = process.argv[2] || "opencode"
const skills = loadSkills()
const sandbox = mkdtempSync(join(tmpdir(), "oc-pstack-doctor-"))
for (const part of ["work", "caller", "config", "data", "cache", "state"]) mkdirSync(join(sandbox, part))
const env = { ...process.env }
for (const key of Object.keys(env)) if (key === "OPENCODE" || key.startsWith("OPENCODE_")) delete env[key]
Object.assign(env, {
  XDG_CONFIG_HOME: join(sandbox, "config"), XDG_DATA_HOME: join(sandbox, "data"),
  XDG_CACHE_HOME: join(sandbox, "cache"), XDG_STATE_HOME: join(sandbox, "state"),
  OPENCODE_CONFIG_DIR: profileRoot, OPENCODE_DB: ":memory:",
  OPENCODE_O_PSTACK_CONFIG_HOME: join(sandbox, "config"),
  OPENCODE_O_PSTACK_STATE_HOME: join(sandbox, "state"),
})
const proc = Bun.spawn([cli, "serve", "--hostname", "127.0.0.1", "--port", "0"], {
  cwd: join(sandbox, "work"), env, stdout: "pipe", stderr: "pipe",
})
let stdout = ""
// Keep service credentials out of diagnostics.
void (async () => { for await (const chunk of proc.stdout) stdout += new TextDecoder().decode(chunk) })()
void (async () => { for await (const _ of proc.stderr) { /* drain */ } })()
const deadline = Date.now() + 30000
try {
  while (!stdout.includes("server password ") && Date.now() < deadline && proc.exitCode === null) await Bun.sleep(100)
  const url = stdout.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
  const password = stdout.match(/server password (\S+)/)?.[1]
  assert(url && password, "Private OpenCode V2 server did not start within 30 seconds")
  const headers = { Authorization: `Basic ${btoa(`opencode:${password}`)}`, "Content-Type": "application/json" }
  async function api(path: string, body?: unknown) {
    const res = await fetch(`${url}${path}`, { headers, method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
    assert(res.ok, `${path.split("?")[0]} returned HTTP ${res.status}`)
    return res.json() as Promise<any>
  }
  let plugins: any[] = []
  while (Date.now() < deadline) {
    plugins = (await api("/api/plugin")).data
    if (plugins.some(p => p.id === "opencode-o-pstack" && p.state?.status === "active")) break
    await Bun.sleep(100)
  }
  const own = plugins.filter(p => p.source?.type !== "builtin")
  assert.equal(own.length, 1, "Only the pstack profile plugin should load")
  assert.equal(own[0].id, "opencode-o-pstack")
  assert.equal(own[0].state?.status, "active")
  assert(["plugins/pstack", "plugins/pstack/index.ts"].some(path => realpathSync(join(profileRoot, path)) === realpathSync(own[0].source.path)), "Unexpected pstack plugin origin")
  for (const caller of ["work", "caller"]) {
    const query = `?location%5Bdirectory%5D=${encodeURIComponent(join(sandbox, caller))}`
    let agents: any[] = []
    const locationDeadline = Date.now() + 20000
    while (Date.now() < locationDeadline) {
      agents = (await api(`/api/agent${query}`)).data
      if (agents.some(a => a.id === "pstack")) break
      await Bun.sleep(100)
    }
    for (const [id, mode] of [["pstack", "primary"], ["poteto-agent", "subagent"], ["comment-sicko", "subagent"]]) {
      const agent = agents.find((a: any) => a.id === id)
      assert.equal(agent?.mode, mode, `${id} mode from ${caller}`)
      assert.equal(agent.system.trim(), parseMarkdown(join(profileRoot, "agents", `${id}.md`)).content, `${id} prompt from ${caller}`)
    }
    for (const id of ["HTOrchestrator", "worker", "runner", "orchestrator", "terraworker"])
      assert(!agents.some((a: any) => a.id === id), `Foreign agent ${id} leaked`)
    const catalog = (await api(`/api/skill${query}`)).data
    const commands = (await api(`/api/command${query}`)).data
    for (const skill of skills) {
      const found = catalog.find((s: any) => s.id === skill.id)
      assert(found, `${skill.id} missing from live catalog`)
      assert.equal(found.content.trim(), skill.content.trim(), `${skill.id} content differs`)
      assert.equal(realpathSync(found.path), realpathSync(skill.path))
      assert(commands.some((c: any) => c.name === skill.id), `${skill.id} slash command missing`)
    }
  }
  console.log(`PASS  ${skills.length} complete skills, slash commands and three profile agents from two project locations`)
  const session = (await api("/api/session", { agent: "pstack", title: "pstack model-free registration proof" })).data
  assert(session.id, "Session was not created")
  for (const id of ["poteto-mode", "principle-prove-it-works", "control-cli"]) {
    await api(`/api/experimental/session/${session.id}/skill`, { id, resume: false })
  }
  const messages = JSON.stringify(await api(`/api/session/${session.id}/message`))
  assert(messages.includes("# Poteto mode"), "Live session did not receive poteto-mode body")
  assert(!messages.includes("OpenCode adapter"), "Obsolete adapter instruction leaked into the session")
  assert(messages.includes("agent: \"poteto-agent\"") || messages.includes("poteto-agent"), "Live session did not receive native delegation instructions")
  assert(messages.includes("# Control CLI"), "Live session did not receive companion skill")
  console.log("PASS  live session loaded poteto-mode, a principle and a companion skill without a model call")
  console.log("PASS  isolated server, database and config; no other profile plugins loaded")
} finally {
  proc.kill()
  await proc.exited
  rmSync(sandbox, { recursive: true, force: true })
}
