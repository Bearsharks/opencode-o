import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const [root, caller, globalConfig] = process.argv.slice(2)
if (!root || !caller || !globalConfig) throw new Error("preflight needs checkout, caller, and global config paths")

const conflicts: string[] = []
const agentNames = ["worker", "runner", "HTOrchestrator", "orchestrator", "terraworker", "lunaworker", "probe"]
const harness = /(?:harness-state|a-max|max-topology|oc-lite-topology|oc-lite-v2)/i
const label = (scope: string, kind: string, path: string) => conflicts.push(`${scope} ${kind}: ${path}`)

function agentFiles(directory: string, scope: string) {
  for (const folder of ["agent", "agents", "mode", "modes"]) {
    for (const name of agentNames) {
      const path = join(directory, folder, `${name}.md`)
      if (existsSync(path) || isLink(path)) label(scope, "agent conflict", path)
    }
  }
}
function isLink(path: string) {
  try { return lstatSync(path).isSymbolicLink() } catch { return false }
}
function pluginFiles(directory: string, scope: string) {
  for (const folder of ["plugin", "plugins"]) {
    const path = join(directory, folder)
    if (!existsSync(path)) continue
    for (const entry of readdirSync(path)) {
      if (harness.test(entry)) label(scope, "harness plugin conflict", join(path, entry))
    }
  }
}
function configFiles(directory: string, scope: string, includeProjectDirectory = true) {
  const files = [join(directory, "opencode.json"), join(directory, "opencode.jsonc")]
  if (includeProjectDirectory) files.push(join(directory, ".opencode/opencode.json"), join(directory, ".opencode/opencode.jsonc"))
  for (const path of files) {
    if (!existsSync(path)) continue
    // The checkout's own default harness config is deliberately overridden by
    // OPENCODE_CONFIG_DIR when installing from this repository. Do not reject
    // that known root document; check any nested project document normally.
    if (resolve(directory) === resolve(root) && dirname(path) === resolve(root)) continue
    let config: Record<string, any>
    try { config = Bun.JSONC.parse(readFileSync(path, "utf8")) }
    catch (error) { label(scope, `unreadable config (${String(error)})`, path); continue }
    if (!config || typeof config !== "object") { label(scope, "invalid config", path); continue }
    if (typeof config.default_agent === "string" && agentNames.includes(config.default_agent)) label(scope, "harness default-agent conflict", path)
    for (const key of ["agents", "agent", "mode"]) {
      for (const name of agentNames) {
        if (Object.hasOwn(config[key] ?? {}, name)) label(scope, `configured ${name} conflict`, path)
      }
    }
    // A foreign top-level permission may be silently overridden by this
    // profile's agent rules. Fail conservatively rather than changing policy.
    for (const key of ["permissions", "permission"]) {
      if (Array.isArray(config[key]) ? config[key].length > 0 : config[key] && Object.keys(config[key]).length > 0)
        label(scope, `merged ${key} policy conflict`, path)
    }
    for (const plugin of [...(Array.isArray(config.plugins) ? config.plugins : []), ...(Array.isArray(config.plugin) ? config.plugin : [])]) {
      const spec = typeof plugin === "string" ? plugin : Array.isArray(plugin) ? plugin[0] : plugin?.package
      if (typeof spec === "string" && harness.test(spec)) label(scope, "configured harness plugin conflict", path)
    }
  }
}

const global = resolve(globalConfig)
agentFiles(global, "Global")
pluginFiles(global, "Global")
configFiles(global, "Global", false)

// V2 reads direct and .opencode documents along the ancestor chain, not just
// $PWD/.opencode. Skip the profile directory itself; those are our own agents.
const checkout = realpathSync(root)
let current = realpathSync(caller)
while (true) {
  if (current !== join(checkout, "profiles/oc-lite")) {
    agentFiles(join(current, ".opencode"), "Project")
    pluginFiles(join(current, ".opencode"), "Project")
    configFiles(current, "Project")
  }
  const parent = dirname(current)
  if (parent === current) break
  current = parent
}

for (const conflict of conflicts) console.error(`FAIL  ${conflict}`)
if (conflicts.length) process.exit(1)
console.log("PASS  Global and project agent, harness plugin, and merged-policy conflicts absent")
