# Set up pstack

In this page you install the plugin, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the plugin

From this repository, install and validate the separate OpenCode profile:

```sh
./scripts/install/pstack.sh
./scripts/doctor/pstack.sh
```

Then run `oc-pstack` in the project you want to work on. It uses this profile's native plugin, skills and isolated session database. The [profile README](../../README.md) states the current installation and verification status; do not treat an unfinished checkout as a released installation.

## Pick your models

Run:

```text
/setup-pstack
```

[`/setup-pstack`](../../skills/setup-pstack/SKILL.md) detects available native models, asks for a reasoning budget, shows every role and panel, and asks what you want. Answer the questions. It writes `$OPENCODE_CONFIG_DIR/pstack-models.json`; each native subagent invocation resolves its required role from that file.

The defaults run at `xhigh` reasoning, the same as the `large` budget. `unlimited` lifts each model to its highest tier, up to `max`. Opus goes to `max`. Grok tops out at `xhigh`, so it stays there. `medium` and `small` lower the reasoning and spend fewer tokens.

You only override what you care about. A missing role key keeps the skill default. To restore a default, delete that role key. Rerunning `/setup-pstack` keeps deliberate changes to model families, lists and aliases. An explicitly saved old default stays pinned; delete its key, or the file, then run setup again to adopt defaults.

Set a role to `inherit-parent` or `auto` to run on the parent chat model. Both aliases mean the same thing and are not provider model IDs. The native role executor resolves the parent model explicitly so a subagent's own agent default cannot override that choice. Panel lists preserve order and duplicates and create one seat per entry. Setup also configures `swarm workers`, the default unless a comparison assigns a model to an arm.

## Accept the verification offers, or don't

At the end of setup, `/setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.opencode/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to pstack, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with [`/create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone thought to write. A formal verification skill checks one key property of your code, such as "a job never runs twice at once", in every case within a stated scope. Say yes when your code has concurrency, retries, a state machine, or a parser, where a bug is costly and tests rarely reach the case that breaks. Otherwise say no, and run it later if that changes. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers it.

Saved role changes apply to the next fresh subagent invocation, including in an existing chat. A reused child keeps its original model; use a fresh child for new work.

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

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. For a persistent mode, run `/pstack-mode on poteto-mode`, then send the task. Native session instructions keep the full skill active on every turn, through compaction and service restarts. `/pstack-mode off` removes it and `/pstack-mode status` reports the selection. Plain `/poteto-mode` loads the skill for that request rather than enabling a persistent mode.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
