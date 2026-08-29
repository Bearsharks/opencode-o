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
- `terraworker` using `opencode-go/kimi-k3` with high reasoning;
- a read-only `runner` using `opencode-go/gpt-5.6-luna` with medium reasoning;
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

Runner runs on `opencode-go/gpt-5.6-luna`. Its configured total context is
capped at 272,000 tokens (240,000 input + 32,000 output) through a
`provider.opencode-go.models.gpt-5.6-luna.limit` override in this profile's
`opencode.jsonc`. The A-Max profile's `runner` agent is a symlink to this
definition, so it inherits this default unless an A-Max-level model override
is active.

Global and project OpenCode configuration still merge by OpenCode design. Run
`scripts/doctor/max.sh` from the repository root to detect known agent and local
plugin conflicts and verify resolved plugin origins.
