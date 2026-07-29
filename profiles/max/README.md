# opencode-o max profile

This profile is intentionally separate from the default lightweight harness.
Run it through `opencode-o-max`, which sets `OPENCODE_CONFIG_DIR` to this
directory only.

```text
HTOrchestrator --task--> terraworker
HTOrchestrator --task--> runner
terraworker    --task--> runner
```

It provides:

- `HTOrchestrator` using `openai/gpt-5.6-sol` with high reasoning;
- `terraworker` using `openai/gpt-5.6-terra-fast` with high reasoning;
- a read-only `runner` using `openai/gpt-5.6-luna-fast` with medium reasoning;
- no lunaworker, Probe, investigate tool, or read-budget accounting.

HTOrchestrator owns goals, plans, delegation, final verification, and the user
response. Terra executes implementation. HTOrchestrator normally delegates
implementation, but may directly handle difficult documents or reports,
conflict resolution, small final corrections, or repair of an unsatisfactory
Terra result.

Runner protects parent context from broad file or external research and
high-output test or verification logs. For exploration, local findings require
`path:line` evidence; web and MCP findings require direct source URLs or
resource identifiers.

Global and project OpenCode configuration still merge by OpenCode design. Run
`../../doctor-max` from the repository root to detect known agent and local
plugin conflicts and verify resolved plugin origins.
