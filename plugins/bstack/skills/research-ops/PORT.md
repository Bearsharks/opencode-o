# Port

Source: `ecc/skills/research-ops/` (ECC, `4adeee6732a12d1540f49a4d50a38ce8c97f9a53`). `LICENSE-ECC` is `ecc/LICENSE` from the same commit.

Changed lines in `SKILL.md`:

- L3, L13, L17–25, L67–70: Replace ECC research-skill dependencies with equivalent research paths, using available Claude web tools for discovery and `bstack-run explore` for deeper synthesis.
- L4: Disable model invocation because `bstack-clarify` loads the method via Read.
- L15: Return findings and evidence to the PRD cell during clarification instead of writing a separate artifact.
- L71: Use Claude's `AskUserQuestion` when only the user can resolve the question or supply evidence.
