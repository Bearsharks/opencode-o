---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

When coordinating in Claude Code, delegate implementation, exploration, and verification through the [Claude Code harness](../../docs/harness/claude-code.md).

Explore the codebase to answer "how does X work?" questions.

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

## 1. Explain

Launch `bstack-run run --role explore --brief "$BRIEF"` with the user's question, no writes, and this brief:

> You are writing an architectural explanation for a senior engineer. Explore the codebase and write an explanation that a senior engineer unfamiliar with this area could read and walk away with a solid mental model. They should understand the architecture well enough to start working in it confidently. Do not modify the codebase.

## 2. Present

Present the worker's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.
