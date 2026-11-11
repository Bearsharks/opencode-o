---
name: poteto-help
description: Explain OpenCode pstack setup and select the right skill or
  playbook. Use when the user asks for pstack help rather than requesting
  execution.
metadata:
  opencode/autoinvoke: false
---

# Poteto help

Answer the question and give one usable prompt. Read the relevant installed skill before describing it. Do not start a workflow in response to a help question; an explicit request to do work should execute the relevant skill.

## Get set up

Install with `scripts/install/pstack.sh` from the opencode-o checkout, then run `oc-pstack` in the target project. Use `/setup-pstack` to inspect available models and configure the 17-role model table, panel sizes/order and four reasoning budgets. The primary keeps its selected model. Delegates use the role table, and parent aliases preserve the exact parent model and variant. Use `/reload` after configuration changes when needed.

Start substantive work with `/poteto-mode <goal and completion checks>`. The pstack primary routes substantive tasks to this skill. Explicitly named skills retain their own scope, and an explicit user opt-out ends mode behavior. After compaction, reload the active skill and playbook before continuing. There is no special key chord required to make the profile primary use pstack.

The profile includes `deslop`, `control-cli`, `control-ui`, and `create-skill`. It supplies no hosted automation, separate machines, or durable scheduling service. Background agents run under the current OpenCode service. A running session can watch and poll, but exiting does not schedule an automatic wake.

## Pick a skill

| The user wants to | Skill |
|---|---|
| Do any non-trivial task with rigor | [`/poteto-mode`](../poteto-mode/SKILL.md) |
| Check that the agent understood their goal and the problem before it starts | [`/in-your-own-words`](../in-your-own-words/SKILL.md) |
| Get a prompt rewritten deeper, not bigger, before sending it: what a top professional would add, their raw material and methods, and an outside check. It returns the prompt and doesn't do the task | [`/sharpen`](../sharpen/SKILL.md) |
| Know how code works now, or where new code should live | [`/how`](../how/SKILL.md) |
| Know why code is shaped this way, or where a number came from | [`/why`](../why/SKILL.md) |
| Understand a change or subsystem, explained plainly | [`/teach`](../teach/SKILL.md) |
| Catch up on their own recent work on a topic | [`/recall`](../recall/SKILL.md) |
| Catch up on what changed in this chat since their last message, in plain words and small visuals, with every item waiting on them listed and decidable from the reply alone | [`/ketchup`](../ketchup/SKILL.md) |
| Catch up like `/ketchup`, in a short subtitled video of slides, with the waiting calls as text under it | [`/ketchup-video`](../ketchup-video/SKILL.md) |
| Know what a small diff could break outside itself | [`/blast-radius`](../blast-radius/SKILL.md) |
| Settle types and module shape before code that crosses a function boundary | [`/architect`](../architect/SKILL.md) |
| Get several attempts at one brief, merged into the best one | [`/arena`](../arena/SKILL.md) |
| Run parallel checks over slices, or race workers, using local subagents | [`/swarm`](../swarm/SKILL.md) |
| Have independent reviewers inspect a diff and try to break it | [`/interrogate`](../interrogate/SKILL.md) |
| Fix a bug test-first when a cheap local test exists | [`/tdd`](../tdd/SKILL.md) |
| Apply TypeScript rules to `.ts` or `.tsx` work | [`/typescript-best-practices`](../typescript-best-practices/SKILL.md) |
| Strip comments before review, using a reviewer that didn't write them | [`/no-comments`](../no-comments/SKILL.md) |
| Clean AI tells out of prose | [`/unslop`](../unslop/SKILL.md) |
| Write docs, an RFC, a README, a PR description, or a commit message to a standard | [`/technical-writing`](../technical-writing/SKILL.md) |
| Hear the last reply again in plain words | [`/bro`](../bro/SKILL.md) |
| Give agents a scripted way to drive the app and prove behavior | [`/create-verification-skill`](../create-verification-skill/SKILL.md) |
| Bring a verification skill and its feature map back in line with the app | [`/maintain-verification-skill`](../maintain-verification-skill/SKILL.md) |
| Formally verify a race, invariant, or other property that tests rarely reach | [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) |
| Bring a formal verification back in line after the code it covers changed, and learn whether a failure is drift or a bug | [`/maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) |
| Show a PM or designer what the user sees as a chart checked by a TLA+ model, with the shortest path to each state that breaks a rule | [`/statechart`](../statechart/SKILL.md) |
| Vet a performance number before reporting or acting on it | [`/benchmark-checklist`](../benchmark-checklist/SKILL.md) |
| Run a large or cross-cutting change, or one to review after stepping away | [`/figure-it-out`](../figure-it-out/SKILL.md) |
| Keep a decision log during a run, and review it afterward | [`/show-me-your-work`](../show-me-your-work/SKILL.md) |
| Configure primary/delegate models and available variants | [`/setup-pstack`](../setup-pstack/SKILL.md) |
| Turn their own working habits into a personal mode skill | [`/automate-me`](../automate-me/SKILL.md) |
| Turn what a finished task taught into skill edits | [`/reflect`](../reflect/SKILL.md) |
| Stop agents from repeating the same mistakes in this repo | [`/correct`](../correct/SKILL.md) |
| Build a page whose buttons call an authorized bot webhook | [`/make-bot-ui`](../make-bot-ui/SKILL.md) |
| Find their way around pstack | `/poteto-help` |

If a skill directory next to this one is missing from the table, read its frontmatter and route by its description. The `principle-*` directories are covered under principles below.

Close calls:

- `/how` explains what the code does. `/why` explains the reasons. `/teach` runs one or both and explains the result plainly.
- `/arena` gives every worker the same brief and merges the best parts. `/swarm` splits work into slices or a race and returns one report.
- `/architect` implements right after it settles the design. Add "with checkpoint" to review the design before it writes code.
- `/interrogate` reviews the diff. `/blast-radius` looks for breakage outside the diff and proves the one fact that makes the change safe.
- `/recall` rebuilds context across recent chats. `/ketchup` covers only this chat since the user's last message. Resuming one specific chat or branch is the Session pickup playbook.
- `/figure-it-out` designs one rigorous run. The Orchestrate playbook runs a program that spans days and many PRs. The Autonomous run playbook drives one task to a finish condition.


## Playbooks and principles

Playbooks are files under `poteto-mode/playbooks`, not separate skills. Ask `/poteto-mode` to investigate, fix a bug, build a feature, babysit a PR, verify and ship a stack, resume a session, pause safely, or plan multiple phases. A planning-only request must not start implementation. PR status checks do not authorize merging.

Principles are loaded individually with the native `skill` tool when their trigger applies. Read the leaf before citing it. Skill calls and file references use installed OpenCode paths; do not fetch another platform's instructions to fill a gap.

## Troubleshoot

- Wrong primary: verify `oc-pstack` uses its own managed service and profile. See the profile README.
- Model setting ignored: inspect the current session and agent model, then reload configuration. Do not claim model diversity when delegates share one model.
- Missing skill: inspect the native catalog and installed directory. Report permission denial instead of reading around it.
- Conflicting writers: assign disjoint output paths or authorized local worktrees; serialize when isolation is unavailable or forbidden by the project.
- No unattended progress: define an observable completion predicate and explain that no durable wake scheduler is installed.
- Success claimed from a build alone: request evidence from the actual behavior, stored value, or measured profile.

## Make it your own

Use `/automate-me` to derive a personal workflow from scoped history, `/reflect` to propose durable skill improvements, and `/create-skill` to author an OpenCode skill. Keep user authorization boundaries. Link to installed files and distinguish local modifications from upstream provenance.

## Reply

Lead with the answer. Give at most one example prompt, then the relevant installed file link. Keep the answer short unless the user asked for the complete map.
