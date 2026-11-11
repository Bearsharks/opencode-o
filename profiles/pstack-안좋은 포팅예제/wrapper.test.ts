import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync, spawnSync } from "node:child_process"

function fixture(run: (x: { root: string; bin: string; env: NodeJS.ProcessEnv; work: string }) => void) {
  const work = mkdtempSync(join(tmpdir(), "pstack-wrapper-"))
  const root = join(work, "checkout with space ' and $literal")
  const bin = join(work, "bin")
  const fake = join(work, "fake")
  try {
    for (const dir of [bin, fake, join(root, "scripts/install"), join(root, "scripts/doctor"), join(root, "scripts/uninstall"), join(root, "profiles/pstack/skills/poteto-mode/scripts")]) mkdirSync(dir, { recursive: true })
    for (const kind of ["install", "uninstall"]) cpSync(resolve(`scripts/${kind}/pstack.sh`), join(root, `scripts/${kind}/pstack.sh`))
    writeFileSync(join(root, "scripts/doctor/pstack.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    writeFileSync(join(fake, "bun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    writeFileSync(join(fake, "opencode"), '#!/bin/sh\n[ "$OPENCODE_O_PROFILE" = pstack ] || exit 2\nprintf "%s\\n" "$OPENCODE_CONFIG_DIR" "$XDG_CONFIG_HOME" "$GH_CONFIG_DIR" "$OPENCODE_DB" "$XDG_STATE_HOME" "$@"\n', { mode: 0o755 })
    const env = { ...process.env, PATH: `${fake}:${process.env.PATH}`, OPENCODE_O_BIN_DIR: bin, OPENCODE_O_PSTACK_CONFIG_HOME: join(work, "config"), XDG_STATE_HOME: join(work, "foreign-state") }
    delete env.GH_CONFIG_DIR
    delete env.OPENCODE_DB
    run({ root, bin, env, work })
  } finally { rmSync(work, { recursive: true, force: true }) }
}

test("launcher preserves arguments and gh auth across isolated profile config; uninstall is scoped", () => fixture(({ root, bin, env, work }) => {
  const inherited = join(work, "inherited")
  mkdirSync(join(inherited, "gh"), { recursive: true })
  writeFileSync(join(inherited, "gh/hosts.yml"), "fixture: true")
  env.XDG_CONFIG_HOME = inherited
  execFileSync("bash", [join(root, "scripts/install/pstack.sh")], { env })
  const wrapper = join(bin, "oc-pstack")
  const output = execFileSync(wrapper, ["run", "spaces ' $literal", "--flag"], { env, encoding: "utf8" }).trim().split("\n")
  expect(output).toEqual([realpathSync(join(root, "profiles/pstack")), join(work, "config"), join(inherited, "gh"), "opencode-pstack.db", join(process.env.HOME!, ".local/state/opencode-o/pstack"), "run", "spaces ' $literal", "--flag"])
  const explicit = execFileSync(wrapper, [], { env: { ...env, GH_CONFIG_DIR: join(work, "custom-gh"), OPENCODE_DB: ":memory:", OPENCODE_O_PSTACK_STATE_HOME: join(work, "own-state") }, encoding: "utf8" }).trim().split("\n")
  expect(explicit[2]).toBe(join(work, "custom-gh"))
  expect(explicit[3]).toBe(":memory:")
  expect(explicit[4]).toBe(join(work, "own-state"))
  execFileSync("bash", [join(root, "scripts/uninstall/pstack.sh")], { env })
  expect(existsSync(wrapper)).toBe(false)
  expect(existsSync(join(root, "profiles/pstack"))).toBe(true)
}))

test("install and uninstall refuse an unmanaged launcher", () => fixture(({ root, bin, env }) => {
  const wrapper = join(bin, "oc-pstack")
  writeFileSync(wrapper, "user owned\n")
  for (const kind of ["install", "uninstall"]) {
    const result = spawnSync("bash", [join(root, `scripts/${kind}/pstack.sh`)], { env, encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("unmanaged")
    expect(readFileSync(wrapper, "utf8")).toBe("user owned\n")
  }
}))
