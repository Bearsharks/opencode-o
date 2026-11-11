import { test, expect } from "bun:test"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { profileRoot } from "./plugins/pstack"

function markdown(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return ["node_modules", "scripts"].includes(entry.name) ? [] : markdown(path)
    return entry.name.endsWith(".md") ? [path] : []
  })
}

test("installed prompts use native tools and have no runtime translation instructions", () => {
  const failures: string[] = []
  const obsolete = /OpenCode adapter|harness\/opencode\.md|\bCursor\b|\.cursor\/|`Task`|\bsubagent_type\b|\brun_in_background\b|\bAskQuestion\b|\bTodoWrite\b|\bGeneralPurpose\b|\bgeneralPurpose\b|\bcloud_base_branch\b|\bfile_attachments\b|\breadonly:\s*(?:true|false)|\benvironment:\s*["'](?:cloud|local)|\ballow_multiple\b|pstack-models\.mdc|grok-4\.7|claude-opus-5|agent-transcripts\/|api2\.cursor|\bSendToUser\b|`update_state`|\/loop\b/
  for (const tree of ["skills", "agents", "docs/guide", "overrides"]) {
    for (const file of markdown(join(profileRoot, tree))) {
      const text = readFileSync(file, "utf8")
      const match = text.match(obsolete)
      if (match) failures.push(`${file}: ${match[0]}`)
    }
  }
  expect(failures).toEqual([])
  expect(existsSync(join(profileRoot, "docs/harness/opencode.md"))).toBe(false)
})

test("native delegation guidance matches the observed 2.2.7 schema and completion contract", () => {
  const mode = readFileSync(join(profileRoot, "skills/poteto-mode/SKILL.md"), "utf8")
  for (const key of ["agent", "description", "prompt", "sessionID", "background"]) expect(mode).toContain(`\`${key}\``)
  expect(mode).toContain("completion notifications")
  expect(mode).toContain("do not sleep or poll child sessions")
  expect(mode).toContain("explicit standing authorization")
  const runtime = readFileSync(join(profileRoot, "plugins/pstack/index.ts"), "utf8")
  expect(runtime).not.toContain('hook("context"')
})

test("worktree audit holds unknown native usage and preserves paths with spaces", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } = await import("node:fs")
  const { execFileSync } = await import("node:child_process")
  const { tmpdir } = await import("node:os")
  const root = mkdtempSync(join(tmpdir(), "pstack-audit-"))
  try {
    const repo = join(root, "main repo")
    const worktree = join(root, "linked tree")
    const bin = join(root, "bin")
    mkdirSync(repo); mkdirSync(bin)
    for (const command of ["gh", "origin"]) writeFileSync(join(bin, command), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    execFileSync("git", ["init", "-q", repo])
    execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture"])
    execFileSync("git", ["-C", repo, "worktree", "add", "--detach", worktree, "HEAD"], { stdio: "pipe" })
    const script = join(profileRoot, "skills/poteto-mode/scripts/worktree-audit.sh")
    const output = execFileSync("bash", [script, "-b", "HEAD", repo], { env: { ...process.env, PATH: bin + ":" + process.env.PATH }, encoding: "utf8" })
    const rows = output.trim().split("\n").filter(row => row.includes("\tverify-session-use\t"))
    expect(rows).toHaveLength(1)
    expect(rows[0].split("\t").slice(-3)).toEqual(["unknown", "verify-session-use", realpathSync(worktree)])
    expect(output).not.toContain("\tsafe\t")
    expect(readFileSync(script, "utf8")).not.toContain(".cursor/")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
