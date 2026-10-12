import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import YAML from "yaml"

// Regression inputs, NOT runtime allow rules. New safe commands must work
// without adding another permission exception or a topology-plugin grammar.
const temp = "/private/var/folders/mt/xg23bqy16bj9ts374myctd_m0000gn/T/opencode"
export const localVerificationCommands = [
  "npm run test:historical-world",
  "npm run test:new-resource",
  "node --experimental-sqlite --test Runtime/dist/test/new-resource.test.js",
  "FREEFY_SAVE_ROOT=/private/tmp/freefy-ontology-d8-ig9q2e47/saves FREEFY_LIVE_SEND_LIMIT=0 FREEFY_IMAGES_ENABLED=0 npm run dev",
  "git fetch origin live-authoring-freefree",
  "git fetch origin a-future-review-branch",
  "npm run test:class-behavior",
  "node --experimental-sqlite --test --test-name-pattern='exported package rejects|imports, starts, plays|rejects conflicts/bad imports' Runtime/dist/test/scenario-lifecycle.test.js",
  "npm --prefix Runtime run check:boundary",
  "npm run lint",
  `./Runtime/node_modules/.bin/tsc -p Runtime/tsconfig.json --outDir=${temp}/freefy-historical-C-f10bae2d`,
  `npm --prefix Runtime run build -- --outDir=${temp}/freefy-historical-C-f10bae2d`,
  `./Runtime/node_modules/.bin/tsc -p Runtime/tsconfig.json --outDir ${temp}/freefy-b2-build`,
  `./Runtime/node_modules/.bin/tsc -p ${temp}/freefy-b2-check.json`,
  "node --experimental-sqlite --test test/event-observer-integrity.test.js",
  `node --experimental-sqlite --test ${temp}/freefy-b2-build/test/historical-definitions.test.js`,
  `FREEFY_B2_SOURCE_SAVE=/Users/ck/Documents/freefy/Runtime/dist/saves-node FREEFY_B2_ARTIFACT_ROOT=/Users/ck/Documents/freefy/Runtime/dist/.live-code node --experimental-sqlite --test ${temp}/freefy-b2-build/test/historical-definitions-http.test.js`,
  `npm run trace:gap -- --save-root=${temp}/freefy-gap-live-ERlb2H --campaign=example --commit=example --operation=example --branch=example --world-details`,
  `node --experimental-sqlite -e 'const {DatabaseSync} = require("node:sqlite"); const db = new DatabaseSync("assigned.sqlite", {readOnly:true}); db.exec("PRAGMA query_only=ON"); console.log(db.prepare("SELECT name FROM sqlite_master").all()); db.close()'`,
  `node --input-type=module -e 'import {baseComposedDefinition} from "./Runtime/dist/src/core/semantic/base-definition.js"; console.log(baseComposedDefinition().ref)'`,
  "find docs/archive docs/archieve -type f -print0",
  "xargs -0 grep -Il '^version https://git-lfs.github.com/spec/v1$'",
  String.raw`git config --local --name-only --get-regexp '^(lfs|filter\.lfs|remote\..*\.lfs)'`,
  "node --test --test-name-pattern 'future filter' --import ./test-setup.mjs './isolated build/test/future.test.js'",
  "python3 - <<'PY'\nprint('read-only diagnostic')\nPY",
  "curl -fsS http://127.0.0.1:5173/",
  "agent-browser open http://127.0.0.1:5173",
  "npm run verify:future-local-check -- --reporter=dot",
  "npm --prefix /private/tmp/runner-deps install --no-save --package-lock=false typescript",
  "rm -rf /private/tmp/runner-owned-disposable-output",
  "git status --short", "git branch --show-current", "git branch --list", "git branch -vv",
  "git tag --list", "git worktree list", "codex --help",
]

const forbiddenResources = [
  "git add .", "git commit -m result", "git push origin main", "git pull",
  "git reset --hard", "git restore file", "git clean -fd", "git checkout main",
  "git merge feature", "git update-ref refs/heads/main HEAD", "git branch new-branch",
  "git branch -D feature", "git tag release", "git worktree add ../other",
  "git config --local filter.lfs.required true", "git config --local --unset lfs.url",
  "apply_patch change.patch", "patch -p1", "sudo rm file", "launchctl restart service",
  "gh pr merge 96", "gh issue comment 145 --body result", "npm publish", "bun publish",
  "orca status --json", "orca-dev send message", "opencode run prompt", "codex exec prompt",
  "cat .env", "cat config/credentials.json", "cat config/secret.txt",
  "cat docs/opencodegoapikey.md", "cat docs/cloudflarekey.md", "npm run graft:setup",
]

export const localVerificationCompounds = [
  "npm run test:class-behavior && node --experimental-sqlite --test --test-name-pattern='exported package rejects|imports, starts, plays|rejects conflicts/bad imports' Runtime/dist/test/scenario-lifecycle.test.js && npm --prefix Runtime run check:boundary && npm run lint",
  `./Runtime/node_modules/.bin/tsc -p Runtime/tsconfig.json --outDir ${temp}/freefy-b2-build && node --experimental-sqlite --test ${temp}/freefy-b2-build/test/historical-definitions.test.js`,
  "cd /private/tmp/runner-build && node --experimental-sqlite --test test/event-observer-integrity.test.js",
  "find docs/archive docs/archieve -type f -print0 | xargs -0 grep -Il '^version https://git-lfs.github.com/spec/v1$'",
  "node --test Runtime/dist/test/a.test.js | cat",
]

export async function checkRunnerPolicy(
  resolve: (action: string, resource: string) => string,
  beforeShell: (command: string, tool: string) => unknown,
) {
  for (const command of localVerificationCommands) {
    assert.equal(resolve("shell", command), "allow", `Runner local verification: ${command}`)
    for (const tool of ["shell", "bash"])
      assert.doesNotThrow(() => beforeShell(command, tool), `No topology shell grammar: ${command}`)
  }
  for (const command of forbiddenResources)
    assert.equal(resolve("shell", command), "deny", `Runner role guardrail: ${command}`)
  for (const command of localVerificationCompounds) {
    // Expected constituent resources; this does not mock or verify Core's scanner.
    // No splitting on |: the test-name regex itself contains literal pipes.
    for (const resource of command.split(" && "))
      assert.equal(resolve("shell", resource), "allow", `Runner compound constituent: ${resource}`)
    for (const tool of ["shell", "bash"])
      assert.doesNotThrow(() => beforeShell(command, tool), `No secondary compound gate: ${command}`)
  }
  assert.equal(resolve("edit", "src/product.ts"), "deny")
  assert.equal(resolve("subagent", "runner"), "deny")
  assert.equal(resolve("read", "nested/.env"), "deny")
  assert.equal(resolve("read", "nested/.env.example"), "allow")
  assert.equal(resolve("external_directory", `${temp}/new-isolated-build/*`), "allow")
  assert.equal(resolve("external_directory", "~/.ssh/id_ed25519"), "deny")
  assert.equal(resolve("shell", "git push origin main"), "deny", "An allowed build cannot authorize a separately scanned push")

  const definitions = await Promise.all(["a-max", "oc-lite"].map(async (profile) => {
    const markdown = await readFile(new URL(`./${profile}/agents/runner.md`, import.meta.url), "utf8")
    const front = YAML.parse(markdown.match(/^---\n([\s\S]*?)\n---\n/)![1])
    for (const phrase of ["loopback", "listen EPERM", "not a complete shell", "actual game/provider/image sends", "not_run is never pass"])
      assert.ok(markdown.includes(phrase), `${profile} Runner contract: ${phrase}`)
    return front.permissions
  }))
  assert.deepEqual(definitions[0], definitions[1], "A-Max and Lite use the same ordered Runner role permissions")
  for (const rules of definitions) {
    assert.ok(rules.some((rule: any) => rule.action === "shell" && rule.resource === "*" && rule.effect === "allow"))
    assert.ok(!rules.some((rule: any) => rule.action === "shell" && rule.effect === "allow" &&
      /^(npm|node|python|xargs|\.\/Runtime)/.test(rule.resource)), "No command-by-command local verification exceptions")
  }
}
