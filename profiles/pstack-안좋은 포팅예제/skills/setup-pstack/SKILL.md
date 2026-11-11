---
name: setup-pstack
description: Configure pstack's 17 role-specific models, ordered reviewer
  panels, cross-family judge pool, and four reasoning budgets in OpenCode. Use
  for /setup-pstack or requests to change pstack models, panel sizes, or
  reasoning budget.
metadata:
  opencode/autoinvoke: true
---

# Setup pstack

Configure `$OPENCODE_CONFIG_DIR/pstack-models.json`. This is the role table consumed by the runtime, not an agent-model shortcut. Do not alter unrelated provider credentials, the primary session model, or other profiles.

## 1. Detect models and load current choices

Call `pstack_models({action: "inspect"})` for the saved configuration, revision, all 17 roles and effective selections. Call `pstack_models({action: "catalog", query: "..."})` for available native models and variants; omit query only when the full catalog is needed. Never invent an ID or variant.

When no role table exists, preserve the user's current agent choices as the proposed starting choices shown by inspect. The upstream defaults distinguish Grok for code/investigation and Claude for judgment, with one of each in panels. Offer those families only when the catalog confirms available native IDs and the user wants that change. Do not silently replace an existing user choice to imitate an unavailable default.

`inherit-parent` and `auto` mean the exact parent session model and variant, overriding a base agent's fixed model. They stay unchanged by budget adjustments. Duplicate and alias panel entries each retain their own seat.

## 2. Select a reasoning budget

Ask for the budget, naming the current value; `large` is the upstream default when setting up a new table. Use native `question` with these choices:

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

Apply the target to every real model and panel entry. Use only the model's advertised reasoning variants, selecting the highest available level at or below the target. Show any fallback or model with no reasoning control. If no suitable level exists, require a different choice. Keep model families, panel order and aliases when the user changes only the budget.

## 3. Show all 17 roles and confirm

| JSON role key | Original role | Value |
|---|---|---|
| `feature-refactoring` | feature, refactoring | one model |
| `bug-fix` | bug-fix | one model |
| `perf-issue` | perf-issue | one model |
| `hillclimb` | hillclimb | one model |
| `judgment-prose` | judgment and prose | one model |
| `hardest-tasks` | hardest tasks | one model |
| `how-explorer` | how explorer | one model |
| `how-explainer` | how explainer | one model |
| `why-investigators` | why investigators | one model |
| `why-synthesizer` | why synthesizer | one model |
| `reflect-tooling` | reflect tooling | one model |
| `reflect-judgment-divergent-synthesizer` | reflect judgment, divergent, synthesizer | one model |
| `arena-runners` | arena runners | ordered model list |
| `arena-cross-judge-pool` | arena cross-judge pool | ordered candidate list, at most one eligible judge |
| `swarm-workers` | swarm workers | one model |
| `architect-runners` | architect runners | ordered model list |
| `interrogate-reviewers` | interrogate reviewers | ordered model list |

Panel length sets the seat count, including repeated models and parent aliases. It is not always two. The cross-judge pool tries entries in order, excludes aliases and the parent's model family, and selects one available different-family model. If no family can be verified, report that instead of calling the review cross-family. A user-confirmed `families` map can identify otherwise unknown model families using `provider/model` keys.

Show the complete table, effective effort, panel counts, pool order, unsupported choices and removed/retired role keys before writing. Ask for confirmation of the complete selection, reusing explicit choices already provided. Configuration approval authorizes these role overrides on later calls; do not require repeated permission for each spawn.

## 4. Validate, then save

The JSON shape is `{ "version": 1, "budget": "large", "roles": { ...all 17 keys... }, "families": { ...optional verified family names... } }`. A role value is an available `provider/model#variant` string or `auto`/`inherit-parent`; panels and the pool use nonempty arrays of those strings. The runtime applies the budget to advertised reasoning variants. This is not a token-count limit.

Call `pstack_models({action: "validate", config: <complete proposed object>})`. Resolve all reported errors; do not save an invalid table merely because runtime fallbacks could run. Re-read the existing file and compare it with the revision/current choices observed before editing. If another process changed it, merge the user's requested changes into the latest table and validate again rather than overwriting them.

After confirmation, write the complete JSON to the path returned by inspect. Then call inspect again and resolve the changed roles to verify the saved choices. The runtime re-reads the table for new calls without a server restart. Existing child-session follow-ups retain their existing model and identity. Do not create a sample user configuration during installation.

## 5. Explain the runtime behavior

Callers resolve a role through `pstack_models`, then copy the returned `agent`, `model`, and `descriptionPrefix` into a native `subagent` call. The execution hook enforces the saved role and seat before child creation. Panel configuration does not spawn anything by itself.

Difficulty changes the budget target by +1 for hardest work, -1 for judgment and -2 for routine work. Only explicit urgency selects an advertised fast sibling; verification preserves the configured swarm model/speed. Rejected model references are remembered for the current session, including plugin reload, and are not retried. Same-family available fallbacks are disclosed; the final parent fallback does not satisfy a mandatory different-family audit.

Confirm the saved path and effective table. When useful, offer `create-verification-skill` and `create-formal-verification-skill` once each if the project lacks them. Generate either only when requested.
