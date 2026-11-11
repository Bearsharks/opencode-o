# Set up pstack

In this page you install the plugin, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the profile

From the opencode-o checkout run `./scripts/install/pstack.sh`, then start `oc-pstack` in your project. The profile bundles native skills and commands. It does not install a marketplace package. See [README](../../README.md) for prerequisites and isolation.

## Pick your models

Run:

```text
/setup-pstack
```

[`/setup-pstack`](../../skills/setup-pstack/SKILL.md) detects the models you have access to, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It validates and writes `$OPENCODE_CONFIG_DIR/pstack-models.json`, the role table enforced at native subagent execution. All 17 roles, ordered panels and the cross-judge pool are shown before confirmation.

The upstream default budget is `large` (xhigh). `unlimited` targets max, `medium` high and `small` medium. The runtime selects each native model's highest advertised effort at or below the target and reports any fallback. Existing model choices are retained until you approve the complete proposed table.

On rerun, change only the requested role choices or budget and preserve all other entries. The saved table contains all 17 keys so omissions cannot silently change behavior. Use `inherit-parent` or `auto` for a role that should follow the exact parent model. Inspect and validate before saving; do not delete unrelated agent/provider configuration.

You might be wondering what happens if you use Auto. Set a role to `inherit-parent` or `auto` and the runtime passes your exact parent model and variant, so even an agent-level fixed model cannot override that inheritance. Both values mean the same thing, and neither is a model slug. For a panel role the value is a list, and one subagent runs per entry, so the list length sets the panel size. Setup also configures `swarm workers`, the default model for every `/swarm` worker unless a race names a model for each arm.

## Accept the verification offers, or don't

At the end of setup, `/setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.opencode/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to pstack, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with [`/create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone thought to write. A formal verification skill checks one key property of your code, such as "a job never runs twice at once", in every case within a stated scope. Say yes when your code has concurrency, retries, a state machine, or a parser, where a bug is costly and tests rarely reach the case that breaks. Otherwise say no, and run it later if that changes. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers it.

The saved role table applies to new subagent calls immediately. Existing child-session follow-ups retain their model identity. The primary chat's model is unchanged.

## Keep the cost in check

pstack spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/setup-pstack` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper, faster models in the code roles is a good split.
- Set a role to `auto` or `inherit-parent` so it runs on the chat's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/poteto-mode` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the task checklist. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. The pstack primary routes substantive tasks to the mode; an explicit opt-out stops it. Start a new task with `/poteto-mode` to select a fresh playbook. Other bundled skills preserve the original explicit-only discovery policy while remaining loadable by exact ID.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
