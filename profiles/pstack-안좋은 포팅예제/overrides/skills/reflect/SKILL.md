---
name: reflect
description: Spawn three parallel review subagents over the active transcript,
  surface learnings, and route each to a concrete edit on an existing skill. Use
  when the user says reflect.
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Use the current OpenCode session ID and its scoped message history. Read it with `opencode api session.message.list --param sessionID=<id>` or the equivalent native session API; follow its pagination. Never scan unrelated sessions. Save a task-local export only when the reviewers need a file, and label a digest as a digest rather than a raw transcript.

## 2. Spawn three reviewers in parallel

Launch three independent `subagent` calls with `agent: "general"`. Their prompts prohibit edits and allow only the evidence sources required for their lens. MCP access depends on the current agent's permissions, not a read-only flag.

Call `pstack_models({action: "resolve", role: "reflect-tooling"})` and use the returned native `agent`, `model`, and `descriptionPrefix` in `subagent`; append the task name to the prefix and provide the full prompt. The execution hook re-resolves the role and enforces its configured model. The Judgment and Divergent reviewers and the synthesizer use `reflect-judgment-divergent-synthesizer`. Keep three distinct lenses and contexts, regardless of whether their configured models coincide.

| Lens | Prompt template |
|---|---|
| Judgment | `references/judgment-reviewer.md` |
| Tooling | `references/tooling-reviewer.md` |
| Divergent | `references/divergent-reviewer.md` |



Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `subagent` response body.

## 3. Synthesize

Resolve `reflect-judgment-divergent-synthesizer` and spawn its returned native call to synthesize. It spot-verifies citations using available permitted tools. Pass `references/synthesizer.md` with each reviewer's full output. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

List Backlog items in the result. Post them to an external tracker only when the user authorized that action.

Never edit a skill under `plugins/cache/`. Before approval, show its destination, `.opencode/skills/<skill>/` or `$OPENCODE_CONFIG_DIR/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the bundled `create-skill` skill and draft the change, validate its metadata/references, and exercise a representative scoped task before accepting it.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `create-skill` and revise its trigger description and check both a request that should match and one that should not.
- `new skill via create-skill: <kebab-name>`: hand creation to `create-skill`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
