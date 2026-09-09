# oc-meta topology runtime

The oc-meta profile is loaded only by the `oc-meta` wrapper or an explicit
`OPENCODE_CONFIG_DIR` pointing at `profiles/oc-meta`.

```text
MetaOrchestrator --task--> runner
runner                    --------> none
```

The plugin registers no custom tools. It only observes each session's selected
agent and rejects task edges outside this topology. Runner prompt shape and
behavior remain an agent concern rather than a runtime string parser.

There is no Terra, Verifier, A-Max background execution, Kanban, read-budget
accounting, `harness_state`, `investigate`, or Probe slot. Meta coordinates
existing separate job sessions via Orca; Runner never runs Orca, mutates
source, or creates jobs.
