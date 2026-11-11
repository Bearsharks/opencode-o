import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Configure only an unset port; preserve explicit user service settings.
// Use OpenCode's public CLI so password/state files remain owned by OpenCode.
const [wrapper, profile, portText] = process.argv.slice(2)
const port = Number(portText)
if (!wrapper || !profile || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Usage: bun scripts/configure-profile-service.ts WRAPPER PROFILE PORT")
const path = join(profile, "service.json")
if (!existsSync(path) || JSON.parse(readFileSync(path, "utf8")).port === undefined) {
  const child = Bun.spawn([wrapper, "service", "set", "port", String(port)], { stdout: "pipe", stderr: "pipe" })
  const [, , status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (status !== 0) throw new Error(`Could not configure profile service port ${port}`)
  console.log(`Configured profile service port ${port}`)
}
