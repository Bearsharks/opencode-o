# Port

Source: `ecc/skills/context-and-decisions/` (ECC, `4adeee6732a12d1540f49a4d50a38ce8c97f9a53`). The source `LICENSE`, reference, and template are unchanged; `LICENSE-ECC` is `ecc/LICENSE` from the same commit.

Changed lines in `SKILL.md`:

- L4, L45–48, L56, L68, L85–88, L96: Use the project's ADR and documentation workflows instead of requiring ECC skills; use `bstack-run impl` for delegated ADR writes and preserve approval gates.
- Model invocation stays enabled so the skill triggers on its own, as in ECC.
- L12: Return the result to the PRD cell in clarification without separate artifact writes.
- L31: Use Claude's `AskUserQuestion` when a decision or approval is needed.
