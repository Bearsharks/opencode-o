# pstack profile for OpenCode V2

A repository-local port of [Cursor pstack](https://github.com/cursor/plugins/tree/main/pstack), with a dedicated `oc-pstack` launcher. It includes all 58 upstream skills, their playbooks, reference files and helper scripts, plus the three companion skills that pstack calls (`deslop`, `control-ui`, `control-cli`) and an OpenCode-native `create-skill`: **62 installed skills**. `setup-pstack` is adapted to native OpenCode configuration.

The upstream revision and file hashes are recorded in [upstream.json](upstream.json). The MIT notices are in [LICENSE](LICENSE) and [LICENSE.cursor-team-kit](LICENSE.cursor-team-kit). [The guide](docs/guide/README.md) and the installed skills use native OpenCode instructions. Upstream attribution is retained in the manifest and licenses.

## Install and run

Requirements: OpenCode V2, Bun and Git. Tested with OpenCode **2.2.7**, Bun **1.3.10**, and the repository's pinned `@opencode/plugin` **2.0.14**. GitHub workflows additionally require authenticated `gh`; statechart model checking has the Java/TLA+ prerequisites documented in its skill.

From this repository:

```bash
./scripts/install/pstack.sh
```

Then run from the project you want to work on:

```bash
oc-pstack
oc-pstack run "Investigate the failing test and fix it with runtime evidence"
```

Use `/poteto-mode <task>`, `/how <question>`, `/interrogate <scope>`, `/poteto-help`, or any other bundled skill command. The primary agent loads poteto-mode for substantive tasks; direct skill requests keep their own scope. Simple questions do not require the full workflow.

The installer validates the profile and generated launcher against a private OpenCode server before writing `~/.local/bin/oc-pstack`. It keeps skills here in `profiles/pstack/skills`; it does not install `@falentio/opencode-pstack` or copy skills into global directories. Set `OPENCODE_O_BIN_DIR` to choose a different launcher directory. The checkout must remain available.

## Isolation and models

The wrapper selects:

- `OPENCODE_O_PROFILE=pstack`
- `OPENCODE_CONFIG_DIR=<checkout>/profiles/pstack`
- `XDG_CONFIG_HOME=~/.config/opencode-o/pstack` (override with `OPENCODE_O_PSTACK_CONFIG_HOME`)
- `XDG_STATE_HOME=~/.local/state/opencode-o/pstack` (override with `OPENCODE_O_PSTACK_STATE_HOME`), keeping service discovery separate from oc-lite and ordinary OpenCode
- `OPENCODE_DB=opencode-pstack.db` unless the caller explicitly selected a database

The installer selects managed service port 49376 when no explicit port is configured; oc-lite uses 49375. Existing port choices are preserved. `OC_PSTACK_PROFILE_DIR` can select an alternate profile for isolated diagnostics.

The normal `opencode` command and other profile launchers remain independent. The normal data/authentication location is retained. `GH_CONFIG_DIR` is preserved or resolved before changing XDG config, so GitHub authentication keeps working. Provider configuration from the ordinary global OpenCode config is **not** imported: add any required provider definitions to this profile's isolated config or the target project's config.

Project configuration still merges by OpenCode design. Same-name skill/agent conflicts fail visibly. A project copy identified by a pinned `cursor/plugins` manifest is the deliberate exception: this profile serves its native skill in memory and leaves the pinned project files unchanged. Run from the target project: this repository's root config belongs to the default harness, so using its root as the working project can load that harness too.

The primary session keeps its selected model. `/setup-pstack` configures all **17 original roles**, ordered candidate/reviewer panels, the ordered cross-family judge pool and the four reasoning budgets in `$OPENCODE_CONFIG_DIR/pstack-models.json`. It validates the native catalog, presents every role and panel count, and saves only after the user's confirmation. Existing primary/agent selections remain untouched. No sample user role file is installed.

`pstack_models` inspects, validates and resolves this table. A resolution returns one native call per panel seat (including duplicates/aliases), or at most one eligible cross-family judge. Callers copy the returned routing prefix into the ordinary `subagent.description`. The `execute.before` hook re-reads the saved role, validates the role and seat, and sets the actual `subagent.model`. This uses the real native tool and its normal permission/lifecycle machinery, not an alternative executor. Untagged ordinary subagent calls remain unchanged. Follow-ups retain their existing child model; changed settings apply to new children.

`unlimited`, `large`, `medium`, and `small` target `max`, `xhigh`, `high`, and `medium`. The resolver uses advertised variants, difficulty offsets and fast/standard siblings, preserving the verification-speed exception and exact inheritance aliases. Unavailable/rejected choices use disclosed same-family fallbacks, then the original parent fallback where allowed. A parent fallback never satisfies a mandatory different-family audit. Explicit native model rejections persist per session in plugin storage and are not retried.

See [the fidelity audit](PORTING.md) for restored procedures and explicit platform gaps.

## Porting decisions

Skills, playbooks, references and guides directly name OpenCode tools and arguments: `skill({id})`, `subagent({agent, description, prompt, background, sessionID})`, `shell`, `read`, and native session APIs. Background workers notify their parent on completion; the workflow does not poll them. Model routing uses installed provider/model references and preserves the user's choice. No runtime adapter is injected and no skill starts with a translation preamble.

Commands are native executors. They preserve literal user text and attachments and append a scoped skill instruction without interpolating the request into shell/template syntax.

In Freefy, the review workflow is disabled before its runtime dependencies, tools, hooks and saved-goal recovery are initialized. The no-op plugin entry and the already hidden reviewer definition can remain in discovery, but no review tools, hooks or recovery are activated; project `correct` and `setup-pstack` registrations yield to the profile's native commands. The project's `/pstack` alias and product context remain available. The Freefy AGENTS/DEVELOPMENT instructions distinguish native pstack review from oc-lite's controlled PR review.

[falentio/opencode-pstack](https://github.com/falentio/opencode-pstack) was a design reference, not a dependency. Useful lessons were explicit V2 registration, loading routed skills through the native skill tool, validating the whole catalog, and retaining workflow state through compaction. This implementation uses the latest Cursor source, a local profile plugin and original helper scripts, rather than copying that port's older skill set or `poteto_*` tool runtime.

Differences and limits:

- Upstream explicit-only invocation is preserved as native `metadata.opencode/autoinvoke: false`. Those skills stay registered and can be loaded explicitly by ID; they are not automatically advertised. Every skill also has a slash command.
- Compaction instructions preserve the active workflow and user opt-out; the active skill is reloaded from its native source after a summary. This is guidance, not a durable job runner.
- Cursor cloud VMs, Automations/Benny, hosted Project state, and `/loop` scheduling are not implemented. Background execution uses the capabilities exposed by the installed OpenCode; it cannot guarantee automatic resumption after process exit. Worktree-based parallelism must have disjoint write scopes.
- Original `watch-pr`, plan checker, decision-log and statechart helpers are bundled. PR-watcher dependencies are installed from their own frozen lockfile. There is no mandatory Graphite dependency.
- A skill does not extend user authorization for publishing, messaging, deployment, force-push, or deletion.

## Validation and removal

```bash
bun run check:pstack
bun run test:pstack-models:live # actual subagent calls with a loopback-only fixture provider
./scripts/doctor/pstack.sh --preflight
./scripts/doctor/pstack.sh
bun run doctor:profile-services # requires installed oc-lite and oc-pstack wrappers
./scripts/uninstall/pstack.sh
```

The test suite checks role/panel/budget resolution, execution-time routing, preserved explicit-only discovery, complete registration, conflicts, malformed skills, preserved model/permission settings, compaction guidance, pinned assets, launcher quoting, GitHub config and scoped uninstall. Doctor starts a private temporary server and checks all 62 skill bodies, commands and profile agents from two project locations. It also loads poteto-mode, a principle and a companion skill into a real session without calling a model. The separate `doctor:profile-services` regression starts both managed services with temporary state/data paths, checks alternating clients reuse the right profile, and stops only those test services. It does not prove model-authenticated task quality, PR shipping or long-running autonomy.

Uninstall removes only the launcher owned by this checkout; it retains the repository, sessions and user configuration.

## Updating the port

Use a clean checkout of `cursor/plugins` at the desired revision:

```bash
bun profiles/pstack/scripts/sync-upstream.ts /path/to/cursor-plugins
bun run check:pstack
./scripts/doctor/pstack.sh
```

This replaces generated skill/guide trees and the two upstream delegate definitions. Commands are registered from that catalog at runtime. Review the diff before accepting an update. The sync script records the source commit and asset hashes. Native behavioral rewrites live in `overrides/skills` and `overrides/docs`; unambiguous tool/path renames are applied at build time by `scripts/native-markdown.ts`. The runtime plugin and primary agent remain locally maintained. Do not run the sync script over unrecorded direct edits to generated skills.
