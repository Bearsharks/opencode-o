# Advisor State v5

v5 preserves the v4 implementation unchanged and wraps its pre-tool hook.

## Change from v4

The wrapper skips v4's pre-tool hook only for driver `edit`, `write`, and
`apply_patch` calls. Those calls no longer require a successful advisor task.
All other v4 behavior remains active: canonical advisor ask headers, one
advisor task ID per driver session, advisor response validation, and read-budget
reporting.

The v4 source remains under `_advisor-state-v4/` and is not modified.
