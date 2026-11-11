import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// Exercise managed service discovery, not `serve`/`--standalone`: those bypass
// the shared-registration bug this regression must catch.
const sandbox = mkdtempSync(join(tmpdir(), "opencode-profile-services-"))
for (const dir of ["work", "data", "cache", "foreign", "lite", "pstack", "pstack-config"]) mkdirSync(join(sandbox, dir))
const root = resolve(import.meta.dir, "../..")
for (const name of ["oc-lite", "pstack"]) {
  const profile = join(sandbox, `${name}-profile`)
  mkdirSync(profile)
  for (const asset of ["agents", "skills", "bundled-skills"]) {
    const target = join(root, "profiles", name, asset)
    if (existsSync(target)) symlinkSync(target, join(profile, asset))
  }
  const config = JSON.parse(readFileSync(join(root, "profiles", name, "opencode.jsonc"), "utf8"))
  config.plugins = config.plugins.map((path: string) => resolve(root, "profiles", name, path))
  delete config.mcp
  writeFileSync(join(profile, "opencode.jsonc"), JSON.stringify(config))
}
const env = { ...process.env }
for (const key of Object.keys(env)) if (key.startsWith("OPENCODE_") || key === "OC_LITE_PROFILE_DIR") delete env[key]
Object.assign(env, {
  XDG_DATA_HOME: join(sandbox, "data"), XDG_CACHE_HOME: join(sandbox, "cache"), XDG_STATE_HOME: join(sandbox, "foreign"),
  OC_LITE_STATE_HOME: join(sandbox, "lite"), OPENCODE_O_PSTACK_STATE_HOME: join(sandbox, "pstack"),
  OPENCODE_O_PSTACK_CONFIG_HOME: join(sandbox, "pstack-config"),
  OC_LITE_PROFILE_DIR: join(sandbox, "oc-lite-profile"), OC_PSTACK_PROFILE_DIR: join(sandbox, "pstack-profile"),
})
async function cli(wrapper: string, args: string[]) {
  const child = Bun.spawn([wrapper, ...args], { cwd: join(sandbox, "work"), env, stdout: "pipe", stderr: "pipe" })
  const timeout = setTimeout(() => child.kill(), 30000)
  try {
    const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const diagnostic = err.split("\n").filter(line => !/password|token|secret|authorization/i.test(line)).join("\n").slice(-1600)
    assert.equal(status, 0, `${wrapper} ${args.join(" ")} failed: ${diagnostic}`)
    return out.trim()
  } finally { clearTimeout(timeout) }
}
const wrappers = [process.argv[2] || "oc-lite", process.argv[3] || "oc-pstack"]
try {
  for (const wrapper of wrappers) {
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("port reservation") })
    const port = reservation.port
    await reservation.stop(true)
    await cli(wrapper, ["service", "set", "port", String(port)])
  }
  // Start pstack first, then lite, and repeat in both directions.
  const addresses = new Map<string, string>()
  for (const index of [1, 0, 1, 0]) {
    const wrapper = wrappers[index]
    const expected = index === 0 ? "worker" : "pstack"
    let agents: any[] = []
    for (let attempt = 0; attempt < 40; attempt++) {
      agents = JSON.parse(await cli(wrapper, ["api", "get", "/api/agent"])).data
      if (agents.some(a => a.id === expected)) break
      await Bun.sleep(100)
    }
    assert(agents.some(a => a.id === expected && a.mode === "primary"), `${wrapper} must resolve ${expected}`)
    assert(!agents.some(a => a.id === (index === 0 ? "pstack" : "worker")), `${wrapper} leaked another primary`)
    const address = await cli(wrapper, ["service", "status"])
    if (addresses.has(wrapper)) assert.equal(address, addresses.get(wrapper), "Same profile must reuse its own service")
    addresses.set(wrapper, address)
    console.log(`PASS  ${wrapper} resolves ${expected} and reuses its own managed service`)
  }
  assert.equal(new Set(addresses.values()).size, 2, "Profiles must have separate service registrations")
  console.log("PASS  pstack and oc-lite use different managed services")
} finally {
  for (const wrapper of wrappers) await cli(wrapper, ["service", "stop"]).catch(() => {})
  rmSync(sandbox, { recursive: true, force: true })
}
