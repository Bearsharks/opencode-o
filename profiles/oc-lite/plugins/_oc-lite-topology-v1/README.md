# oc-lite topology runtime

The oc-lite profile is loaded only by the `oc-lite` wrapper or an explicit
`OPENCODE_CONFIG_DIR` pointing at `profiles/oc-lite`.

```text
worker --task--> runner
runner           --------> none
```

The plugin registers no custom tools. It only observes each session's selected
agent and rejects task edges outside this topology. Runner prompt shape and
behavior remain an agent concern rather than a runtime string parser.

There is no Terra, A-Max background execution, Kanban, read-budget accounting,
`harness_state`, `investigate`, or Probe slot.
