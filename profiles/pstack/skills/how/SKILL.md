---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
metadata:
  opencode/autoinvoke: false
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Every spawn is a native `subagent` with `agent: "explore"` for read-only access and `background: true`. Explorers use `role: "how explorer"`; every explainer uses `role: "how explainer"`. Resolve the role with `pstack_models(action: "resolve", role: ...)` and pass the role to every call. The role configuration is in the profile's `pstack-models.json`. Missing explorer and explainer entries retain the defaults of Grok 4.7 at xhigh reasoning with fast speed and Claude Opus 5.5 at xhigh reasoning, respectively, using advertised OpenCode model identities. `auto` and `inherit-parent` entries run on the parent chat model. If an adjusted model is refused, the native selector retries the unadjusted configured model before this workflow's fallback: the role's original default, then the closest available model in that default's family, finally the parent model when none remains. Never reuse refused identities, and report every fallback notice. Pick `difficulty` and `urgent` for each job's reasoning and speed per the Subagents section of **poteto-mode**. Wait for completion notifications before the dependent synthesis; do not poll children.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Spawn one explainer that explores and explains in one pass, built from `references/explainer-prompt.md` without the explorer-findings section. Go to step 4.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

## 2. Explore (complex only)

Decompose the question into 2 to 4 angles, each a distinct slice of the subsystem. Spawn all explorers in a single message, each with `references/explorer-prompt.md` and its angle filled in.

## 3. Synthesize (complex only)

Once all explorers have returned, spawn one explainer with `references/explainer-prompt.md` and every explorer's findings filled in.

## 4. Present

Present the explainer's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
