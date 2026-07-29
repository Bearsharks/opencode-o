# Max topology runtime

The max profile is loaded only by `opencode-o-max`.

```text
HTOrchestrator --task--> terraworker
HTOrchestrator --task--> runner
terraworker    --task--> runner
runner         --------> none
```

The plugin registers no custom tools. It only observes each session's selected
agent and rejects task edges outside this topology. Runner prompt shape and
behavior remain an agent concern rather than a runtime string parser.
Read-budget accounting, `harness_state`, `investigate`, Probe slots, and
lunaworker are absent.

Runner is an ordinary subagent using Luna fast with medium reasoning, not a
tool. For exploration, it returns evidence-backed compact results.
