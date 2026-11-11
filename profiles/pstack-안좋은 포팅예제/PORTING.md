# pstack fidelity audit

Compared against `cursor/plugins` pstack commit `de8ee15dd1194627d21eb5fcd41cb1873208dabb`. This records the functional comparison, not a claim that every natural-language workflow has been executed with a production model. The installed prompts use OpenCode names directly; there is no runtime translation document or adapter preamble.

## Restored omissions

| Original capability | Current implementation and proof |
|---|---|
| 17 role-specific model choices | `plugins/pstack/roles.ts` has all 17 original labels and native JSON keys. `setup-pstack` inspects the existing table, discovers available models, presents every role, validates, and saves after confirmation. |
| Four reasoning budgets | unlimited→max, large→xhigh, medium→high, small→medium. Uses advertised variants at/below target, including explicit fallback notices. Unit tests exercise all four; live provider requests confirm selected reasoning effort. |
| Panel models/order/count | Arena, Architect and Interrogate use their own configured lists. Duplicate models and parent aliases remain separate seats, including a one-entry list. The live fixture creates a four-seat panel with duplicates and inheritance. |
| Ordered cross-judge pool | Excludes aliases, unknown families and the parent's family; returns at most one eligible judge in order. Reports an empty eligible set. The live fixture selects the later eligible entry after alias/same-family entries. |
| Per-task difficulty and speed | Hardest +1, judgment -1, routine -2, capped at available effort levels. Uses only advertised fast/standard sibling IDs. Swarm verification retains its configured speed. Inheritance aliases preserve exact parent model/variant. |
| Actual native call routing | `pstack_models` returns native call data and a role/seat description prefix. `subagent` execute-before reads the saved table and enforces the model; it does not replace the native executor or its permissions. Roles select models independently of agent identity; specialized agents such as comment-sicko retain their native prompt and permission rules. Live test deliberately supplies wrong models and verifies seven real child sessions and provider requests. |
| Availability and refusal handling | Setup validation rejects unavailable choices. Runtime uses disclosed available same-family fallback and final parent fallback where allowed. Explicit native model refusals persist in plugin session storage and are not retried. |
| Existing settings and resumption | No user role file is installed automatically. Existing primary/agent models are preserved before setup. Saved aliases force true parent inheritance even with a base-agent model. Existing child follow-ups retain their original model/identity. |
| Session pickup | All five steps restored: trail, operational state, done/pending, remaining-playbook routing, artifact verification. |
| Autonomous run | All six steps restored: predicate, wake prerequisite, measured iterations, supporting fixes, per-iteration trail, predicate/dead-end exit. Wake infrastructure limitations are separate. |
| Orchestrate | Restored optional sub-coordinators, three-level limit, about ten concurrent workers per coordinator, one-PR ownership, independent different-family verification, first-unit-through-merge before expanding, and full supervision rules. |
| Arena/Swarm isolation and evidence | Restored Arena's candidate-specific output locations and Swarm's per-worker writable output, exact SHA and measurement-method requirements. |
| Mandatory different-family audit | `show-me-your-work` again requires a different-family auditor. No eligible model means NOT RUN, never same-model substitution or an audited-success claim. Arena's optional cross-judge retains its own explicit skip path. |
| Explicit-only skill discovery | The upstream flag is mapped to `metadata.opencode/autoinvoke: false`, not dropped. Skills remain registered and loadable by exact ID. Original 57 explicit-only skills are preserved. |
| Supporting artifacts | All 58 upstream skill directories and their supporting files remain; three required companion skills and native create-skill bring the total to 62. Pinned file hashes and provenance are in upstream.json. |
| Guides and instructions | Restored portable setup, prompting, overnight, customization and review examples instead of retaining abbreviated guides. Native model selection and unsupported host operations are stated where they occur. |

The original built-in model slugs are not assumed to be installed native IDs. Setup shows the original code/investigation versus judgment family preferences, but detects real native IDs and preserves existing user choices until confirmation. This is a model-availability constraint, not a four-agent replacement for the role table.

Native `model` overrides are authorized by the user's saved role choices. An explicitly requested one-off override uses an ordinary untagged native call. The runtime does not infer a task's semantic role from free text: the workflow selects the role, and the code enforces the selected role's configured model and seat. Untagged calls are not forcibly routed.

## Platform capabilities not implemented

| Capability | Boundary |
|---|---|
| Durable timer/heartbeat wakes and restart after process exit | No scheduler is installed. Native background notifications resume a live service; checkpoints preserve state but are not timers. A task requiring strict unattended cadence must report that missing prerequisite. |
| Hosted cloud VMs and cloning worker process state | No VM provisioning or process-memory fork. Local worktrees/disjoint paths are available only within project/user authorization; same-session continuation is not a clone of another machine. |
| Hosted Project store and forge event subscription service | Local task files and available native/forge APIs preserve state/evidence. A hosted multi-day store or CI subscription service is not claimed; unavailable subscriptions are reported. |
| Benny Slack automations | Excluded because hosted triggers, secret delivery and automation execution are unavailable. No local substitute is advertised as Benny. |
| make-bot-ui routine creation, secret requests and agent wakes | Original phase boundaries are retained, but dependent phases are BLOCKED/NOT RUN without a concrete equivalent host integration. A generic existing-webhook page is explicitly not completion of the original workflow. |
| Dedicated persistent UI custom-mode toggle | The selected pstack primary is the profile entrypoint and routes substantive work to poteto-mode. Explicit opt-out and explicit skill calls remain supported. No keyboard/UI feature from another host is invented. |
| Native todo tool | The tested 2.2.7 catalog has no todo/todowrite tool. A Markdown checklist preserves the plan and required steps, but does not claim a dedicated task UI or API. |

OpenCode session APIs replace filesystem transcript assumptions. `worktree-audit.sh` reports native ownership as unknown and requires checking actual owners; absence of another application's transcript cannot establish safe deletion. Existing authorization, project restrictions and secret handling remain authoritative.

## Validation and limits

- `bun run check:pstack`: role schema, all budgets, difficulty/speed, panel/alias semantics, ordered family selection, refusal memory, actual execute-before mutation and resume identity; full skill registration, explicit-only metadata, native commands, provenance, paths and worktree safety.
- `bun run test:pstack-models:live`: a real isolated OpenCode 2.2.7 server with a deterministic loopback-only provider runs the native tool pipeline, creates seven child sessions, and verifies resolved models, variants and reasoning fields in actual provider requests. It uses no hosted API credentials.
- `scripts/doctor/pstack.sh`: real catalog and explicit skill loading, without model inference.
- `doctor:profile-services`: profile service isolation.

These checks do not prove production model judgment, a real PR merge, unattended scheduling, cloud provisioning, or hosted automation execution. The unavailable features above are not represented as implemented equivalents.
