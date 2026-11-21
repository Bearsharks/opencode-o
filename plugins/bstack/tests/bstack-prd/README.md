# `bstack-prd` tests

Run from the source repository root:

```sh
python3 -B -m unittest discover -s plugins/bstack/tests/bstack-prd
```

Each test uses a disposable Git root and plugin copy with a separate temporary
`BSTACK_STATE_DIR`. The fake `bstack-run` receives review briefs on stdin, records invocations, and
holds selected foreground runs without launching a model. Coverage includes
the two-REVISE limit and resetting the count when the user's answer is appended.

For opt-in live coverage, see [the behavior suite](../live/behavior/README.md).
