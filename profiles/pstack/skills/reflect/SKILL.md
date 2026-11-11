---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
metadata:
  opencode/autoinvoke: false
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, call `pstack_history(action: "current")` to identify this conversation exactly. Export its full messages with `pstack_history(action: "export", sessionID: ...)`. The returned private JSONL includes messages from before compaction, with native message IDs, types and timestamps. Pass that absolute path to the reviewers; do not inline the raw transcript. Do not search unrelated workspaces. If a full transcript is unavailable, pass a tight digest and state that limitation.

## 2. Spawn three reviewers in parallel

One message, three native `subagent` calls with `agent: "general", background: true` and the role named below. Use the full agent mode: reviewers need available MCP tools to check the referenced tickets, chat threads and traces. They must not edit files.

Each reviewer and the synthesizer names a required `role` in the profile's `pstack-models.json`. Resolve through `pstack_models` and pass that role on every native call. Missing roles keep the defaults below; `auto` and `inherit-parent` retain the parent model. Choose `difficulty` and `urgent` per **poteto-mode**. A rejected adjustment returns to the configured baseline, then this workflow's original role default, then the nearest advertised model in that family; report fallbacks and never reuse rejected identities.

| Lens | Native role | Default model intent | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | Claude Opus 5.5, xhigh reasoning | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | Grok 4.7, xhigh reasoning, fast speed | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | Claude Opus 5.5, xhigh reasoning | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the native subagent result and completion notification.

## 3. Synthesize

One native `subagent` call with `agent: "general", role: "reflect judgment, divergent, synthesizer", background: true` (default Claude Opus 5.5 at xhigh reasoning). It spot-verifies citations through available MCP tools, so keep full agent mode. Pass `references/synthesizer.md` verbatim with every reviewer's full output inlined. It returns Accepted / Rejected / Backlog.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a package cache or the managed `skills/` / `bundled-skills` tree. Before approval, show the destination: `.opencode/pstack/skills/<skill>/` for this project or `$OPENCODE_CONFIG_DIR/local-skills/<skill>/` for this profile. After approval, copy the complete skill folder there and edit the copy. Preserve its native invocation metadata. Validate all relative references after the copy; rebase references outside that folder to their actual native locations rather than leaving broken links. These explicit override locations take precedence over the bundled native skills. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the bundled native `create-skill` skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `create-skill` and run its description-optimization loop.
- `new skill via create-skill: <kebab-name>`: hand creation to `create-skill`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
