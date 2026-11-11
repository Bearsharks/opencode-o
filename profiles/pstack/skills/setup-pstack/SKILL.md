---
metadata:
  opencode/autoinvoke: true
name: setup-pstack
description: Configure which native models pstack uses per role and at what reasoning budget. Detect available models and save role overrides applied to subagent execution. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write `$OPENCODE_CONFIG_DIR/pstack-models.json`, the native per-role configuration read at subagent execution. Use `pstack_models` to plan, validate and atomically save the exact choices the user approves.

## Steps

### 1. Detect available models

Enumerate native chat model references (`provider/model` or `provider/model#variant`) with `pstack_models(action: "catalog")`, following `nextOffset` until the requested provider scope is complete. The native `opencode_models` catalogue can supply additional model details. These advertised references are the dependable source. If no models can be detected, ask the user for the IDs they can use. Never save an unconfirmed reference. `inherit-parent` and `auto` remain valid aliases even though they are not catalogue entries.

### 2. Load current state

The default mapping is the 17-role table in step 5. Call `pstack_models(action: "plan")` to load the current budget and role choices, or defaults when the file/role is missing. The result reports retired roles such as `how critics` in `dropped` and excludes them from the proposed table. It does not write anything. Keep the returned `revision` for the eventual reviewed save.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer the native `question` tool over free text. Offer these four options with these exact labels, and name the current budget when the rule records one. With no rule, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Call `pstack_models(action: "plan", budget: <chosen label>)`. Start from the skill defaults and preserve existing model/provider choices, ordered lists, duplicate seats and aliases. The four budgets set the starting reasoning target of every real entry, panels included, to `max`, `xhigh`, `high`, or `medium`. Use advertised variants on the selected native model, preferring its highest effort at or below the target, then an advertised same-family alternative when needed; never fabricate an ID or choose effort above the budget. If none is available, mark that role as needing a choice. Aliases do not change. `unlimited` raises Claude Opus 5.5 to max when advertised; Grok 4.7 tops out at xhigh in the original defaults. `large` retains xhigh. `small` starts both at medium, preserving each configured fast/standard model where available. Show provider limitations rather than claiming an unsupported effort was applied.

**(c) Show the roles and confirm.** Show every role with its model, marking any native reference not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the advertised native references plus `inherit-parent` and `auto` (both mean: this role runs on the parent chat model, preserving the parent chat's current selection) as the options. Prefer `question` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values from a family other than the parent's, in list order, so order it by preference. An `inherit-parent` or `auto` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Call `pstack_models(action: "validate", config: <reviewed candidate>)`. Every real reference must be advertised, including its variant; `inherit-parent` and `auto` always pass. If any choice is unavailable, stop and ask again. Missing role keys are valid and retain defaults, but normal setup reviews all 17 rows.

### 5. Write the rule

After approval, call `pstack_models(action: "save", config: <exact approved object>, expectedRevision: <reviewed revision>)`. A new file uses `expectedRevision: null`. Save overwrites the whole JSON atomically and rejects changed-on-disk settings or unavailable references. If settings changed during review, reread and reconcile the difference; do not silently overwrite another change.

The JSON contains `version: 1`, `budget`, and `roles`; `families` optionally identifies opaque proxy models for independent-family checks. Single roles hold one reference or alias; panels/pools hold arrays. Delete a role key to restore its default. Do not copy the model descriptions below as native IDs: use the validated catalogue-backed object returned by planning.

| Role key | Original default intent |
| --- | --- |
| `feature, refactoring` | Grok 4.7, xhigh, fast |
| `bug-fix` | Grok 4.7, xhigh, fast |
| `perf-issue` | Grok 4.7, xhigh, fast |
| `hillclimb` | Grok 4.7, xhigh, fast |
| `judgment and prose` | Claude Opus 5.5, xhigh |
| `hardest tasks` | Claude Opus 5.5, xhigh |
| `how explorer` | Grok 4.7, xhigh, fast |
| `how explainer` | Claude Opus 5.5, xhigh |
| `why investigators` | Grok 4.7, xhigh, fast |
| `why synthesizer` | Claude Opus 5.5, xhigh |
| `reflect tooling` | Grok 4.7, xhigh, fast |
| `reflect judgment, divergent, synthesizer` | Claude Opus 5.5, xhigh |
| `arena runners` | [Claude Opus 5.5 xhigh, Grok 4.7 xhigh fast] |
| `arena cross-judge pool` | [Claude Opus 5.5 xhigh, Grok 4.7 xhigh fast], ordered pool |
| `swarm workers` | Grok 4.7, xhigh, fast |
| `architect runners` | [Claude Opus 5.5 xhigh, Grok 4.7 xhigh fast] |
| `interrogate reviewers` | [Claude Opus 5.5 xhigh, Grok 4.7 xhigh fast] |

### 6. Confirm

Tell the user the file was saved and applies to fresh subagent invocations, including in the current chat. A reused child keeps its original model. Re-running setup updates the configuration.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, invoke `/create-formal-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.
