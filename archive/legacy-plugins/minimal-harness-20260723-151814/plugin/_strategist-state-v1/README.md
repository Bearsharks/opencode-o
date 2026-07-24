# Strategist State v1

`agents/` contains the exact driver, strategist, and probe-code prompt snapshot
that belongs to this plugin version. Use the root activation and rollback scripts
so the state plugin and agent contracts change together.

This plugin migrates the active advisor-state v5 behavior to the `strategist`
agent while preserving the proven advisor judgment contract and read-awareness
budget.

## Preserved behavior

- Canonical ask values: `plan`, `advise`, and `review`
- First strategist consultation creates a new task; later consultations resume
  the same task ID. A later call without that ID or with a different ID is
  rejected before a new subagent session can be created.
- Invalid responses preserve the observed task ID for retry
- Strategist responses require only non-empty `decision` and `summary`
- The strategist-only `advisor` skill owns the strict judgment contract
- The strategist-only `plan` skill owns plan construction; plan item structure
  is intentionally not validated by this plugin
- Strategist responses use `needs` for inputs required before judgment and
  `required` for driver obligations after an accepted direction
- Driver sessions start with 600 returned lines and 25,000 returned characters
- Direct reads cost 100%; driver-launched probe-code reads cost 25%
- Strategist-launched probe-code reads do not consume the driver budget
- Budget allocation preserves the existing reason, strategy, and positive
  integer validation without a separate approval step
- Synthetic-only messages from the self-improvement bridge do not initialize a
  driver budget

## Deliberate exclusions

- No mutation gate
- No required strategist call
- No fixed schema for `plan` items
- No persistent state, diff tracking, staleness calculation, or application
  history

The previous `_advisor-state-v5/` implementation remains unchanged for rollback.
