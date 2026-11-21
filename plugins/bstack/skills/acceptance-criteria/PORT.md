# Port

Source: `profiles/pstack/skills/acceptance-criteria/` (oc-pstack, `360c07e4a7cd6566ce26f6d8b66aa9a2b1f95801`).

Changed lines in `SKILL.md`:

- L4: Replace OpenCode autoinvocation metadata with disabled model invocation because `bstack-clarify` loads the method via Read.
- L9: Return criteria to the PRD cell during clarification without running the standalone task-document workflow.
- L15: Route delegated observation through `bstack-run explore` and user preferences through `AskUserQuestion`.
- L19, L23: Use a bstack worktree key and explicitly clear it after squash merge rather than relying on pstack's harness; keep `Task-Doc:` for Shipping.
