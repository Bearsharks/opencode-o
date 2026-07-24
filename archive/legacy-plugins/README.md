# Legacy plugin experiments

This directory preserves inactive OpenCode plugin experiments moved from
`~/.config/opencode/backups/*/plugin` on 2026-07-24.

No cleanup, modernization, compatibility work, or behavioral validation was
performed. Files are kept in their original snapshot directories so their
provenance remains visible.

| Snapshot | Original location | Rough contents |
| --- | --- | --- |
| `strategist-v1-20260722` | `~/.config/opencode/backups/strategist-v1-20260722/plugin` | Legacy strategist/advisor activation notes and smoke test |
| `minimal-harness-20260723-151814` | `~/.config/opencode/backups/minimal-harness-20260723-151814/plugin` | Advisor state v4/v5, phase gates v1-v4, strategist state, bridge, activation and rollback scripts |
| `investigate-v1-preinstall-20260723` | `~/.config/opencode/backups/investigate-v1-preinstall-20260723/plugin` | Preinstall snapshot of the first investigate harness |
| `investigate-fail-open-preinstall-20260724` | `~/.config/opencode/backups/investigate-fail-open-preinstall-20260724/plugin` | Snapshot before fail-open investigate parsing |

## Safety status

- Nothing under this directory is loaded by `opencode.jsonc`.
- The active implementation remains `plugins/harness-state.ts`.
- Several archived files contain hard-coded `/Users/jsp1226/...` paths.
- Activation and rollback scripts may overwrite global agents or plugins.
- Some scripts refer to companion agent backups that remain outside this
  repository.
- No credentials or tokens were found by the migration-time text scan.
- `.DS_Store` is OS metadata and is intentionally excluded from Git.

Treat this directory as read-only historical material until a separate cleanup
task classifies, rewrites, tests, or removes individual experiments.
