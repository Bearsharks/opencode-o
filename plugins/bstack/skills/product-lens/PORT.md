# Port

Source: `ecc/skills/product-lens/` (ECC, `4adeee6732a12d1540f49a4d50a38ce8c97f9a53`). `LICENSE-ECC` is `ecc/LICENSE` from the same commit.

Changed lines in `SKILL.md`:

- L4: Disable model invocation because `bstack-clarify` loads the method via Read.
- L13: Return the diagnosis to the PRD cell during clarification instead of writing separate artifacts.
- L15, L43, L96: Replace the ECC capability-skill handoff with `bstack-run impl` for specification work outside clarification.
- L29: Use Claude's `AskUserQuestion` for diagnostic questions the evidence cannot answer.
- L93–95: Preserve integration goals without requiring ECC slash commands.
