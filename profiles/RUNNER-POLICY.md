# Runner authority: product-read-only, locally executable

A-Max and oc-lite use the same ordered Runner permission rules. Their primary
agent topology, models, and model request preferences remain profile-specific.

## Decision

Runner performs delegated exploration and verification, not product
implementation. **Product-read-only is not execution-read-only.** Builds write
outputs; isolated tests create saves, SQLite files and caches; HTTP tests bind
loopback ports; browser readiness needs a running server; divergence review
needs fetched Git objects. These are normal verification capabilities, not
reasons to seek approval for each script, flag, branch name or temporary path.

Both profiles therefore allow shell execution by default for authorized local
work and append guardrails for clearly separable role violations. Core owns
shell scanning and permission evaluation. The A-Max topology plugin no longer
parses Node commands or restricts compiled tests to `Runtime/dist/test` and
`dist/test`. Such a regex could neither establish test safety nor correctly
handle private build paths, environment assignments, quoting, or companion
commands. Broad Node/Python/npm exceptions already trusted executable code,
so the old allowlist was not a real security sandbox.

This deliberately trades a brittle command-name whitelist for a trusted-code,
role-scoped execution policy. It is **not** suitable as a security boundary for
untrusted scripts: interpreters, npm scripts, HTTP clients, indirect commands
and shell redirections can bypass simple deny patterns. Use a separately
configured OS/container/network sandbox for adversarial code, with appropriate
filesystem and egress controls. Do not claim that prompts or permission glob
rules enforce read-only filesystems, loopback-only networking, or zero sends.

## Capability matrix

| Work | Runner authority |
| --- | --- |
| Assigned build, lint, boundary check, filtered or standalone tests | Allowed; script name, flags and test output path are not fixed |
| Temporary configs, output, caches, copied/synthetic saves, reports | Allowed in owned disposable scope; do not collide with shared outputs |
| Disposable dependencies | Allowed without changing project source/manifests/lockfiles or persistent user configuration |
| Task-owned HTTP/dev servers and browser checks | Allowed on loopback with synthetic/isolated data and effective provider/image send prevention; clean up own processes |
| Original/acceptance save inspection | Only when assigned, with read-only SQLite/query-only access or a read-only backup to a copy; no original writes |
| Git fetch for review | Allowed when requested from existing project remotes; metadata/objects/remote-tracking refs are an explicit exception to product-read-only |
| Product source, project manifests/lockfiles, persistent user config | No edits; implementation belongs to parent/worker |
| Git authoring, local branch rewrites, checkout, index/worktree changes, push | Denied by role; common direct commands are also tool-denied |
| Credentials, publishing, external authoritative changes, actual game/model/image sends | Not authorized by this policy |
| Orca lifecycle/messaging, further delegation, feature acceptance | Not Runner's role |

The parent assigns scope, resources and exact commands for execution tasks.
Runner does not broaden the task, repair product code or make unrequested
retries. Requested investigation/preparation can select ordinary local methods
and disposable setup within that scope. A test/dev label or
`FREEFY_LIVE_SEND_LIMIT=0` alone is not proof of isolation: inspect relevant
code/config and use effective synthetic gateways/send controls. Any
task-specific actual-provider ceiling still requires its own authorization and
belongs to the authorized parent/worker, not an automatic Runner exception.

## Blockers must name the actual layer

1. **Permission denial before execution:** identify the configured action and
   command/resource. `not_run` is not a test result.
2. **Scanner parsing error:** distinguish it from permission denial. The
   topology plugin must not supply a competing shell grammar.
3. **Plugin rejection:** report the plugin and its exact error.
4. **Executed `listen EPERM`:** the process reached an OS/sandbox socket gate.
   Shell `allow` does not change those rights. If a real runner is sandboxed,
   request only loopback bind/connect and the necessary owned temporary paths
   from the actual execution environment. No external/provider authorization is
   implied; do not guess an OpenCode config flag or silently run outside a deny.
5. **Build/test failure:** report the actual exit and failed assertions; parent
   owns diagnosis, fixes and acceptance.

Keep a successful build result and rerun only the assigned blocked component
when permitted. Parent fallback uses its own independently authorized role;
it never overrides an explicit user, organization, tool or sandbox denial.

## Verification and rollout

`runner-policy.check.ts` supplies shared regression inputs to both real plugin
smoke tests: isolated TypeScript builds, absolute/relative compiled tests,
filtered tests with pipe characters, compound lint/boundary checks, read-only
SQLite/trace diagnostics, local dev/browser commands, fetch and LFS scans.
It verifies ordered permission effects, rejects common role violations, checks
policy parity, and prevents a return to per-command local verification allows.
These tests do not execute the Freefy commands or emulate Core's shell scanner.

Run `bun run check:a-max` and `bun run check:oc-lite`. Existing wrappers point
at this checkout, so no reinstall is needed. Restart/reopen the relevant
standalone profile after its active work finishes; do not interrupt ongoing
tasks merely to reload the policy. A-Max's process-local Kanban resets on
restart. Existing session-specific or organization/sandbox policies remain
separate and may still block a command.
