# oc-lite profile

`oc-lite` is a single-primary-worker profile with one read-only Runner.

```text
worker --subagent--> runner
freefy-pr-reviewer --subagent--> runner
runner           --------> none
```

The Worker uses the session/UI-selected model and its variant; it has no agent
model or request overrides. Runner uses exactly `openai/gpt-6-luna` with
high reasoning effort and low text verbosity. The Worker performs implementation directly. Its prompt keeps only role,
context management, reading strategy, and completion conditions. Runner is
product-read-only, with the same ordered role permissions as A-Max and an
evidence-backed compact result contract. See the shared
[Runner authority policy](../RUNNER-POLICY.md): assigned local builds/tests,
temporary output/dependencies, loopback servers/browser checks, read-only
SQLite diagnostics and requested Git fetches are allowed without per-command
exceptions. Product edits, Git authoring, credentials, actual provider sends
and external publication are not authorized. Shell guardrails are not an
OS/network sandbox and cannot fix `listen EPERM` by themselves.

`oc-lite` additionally permits assigned gameplay/UI input checks in an
already-running, task-owned local game session identified by the Worker. The
Worker owns launch/restart/stop, source and profile selection; Runner may inspect
the handed-off session, send test keyboard/mouse/touch inputs, and capture
evidence. Normal gameplay/save effects must be explicitly authorized for the
selected test actor; this does not allow direct save edits, resets, product edits,
publication, payment, or credential access. See `agents/runner.md` for the exact
scope. This oc-lite exception does not change other profiles' Runner policies.

The topology plugin loads agent Markdown during setup. Restart the oc-lite
process and use a new Runner child to pick up changed role instructions; an
already-running child is not evidence that the new policy has loaded. Do not
restart a user's running game to reload an agent profile.

The V2 topology plugin loads this profile's Markdown agents from any working
directory and enforces the two-agent subagent graph. It does not provide
orchestration, Terra workers, A-Max background execution, Kanban, or custom
tools. Runner is visible to the V2 subagent catalog (V2 hides agents from
invocation as well as display when `hidden: true`).

Use OpenCode V2 (tested with v2.0.14) through the separately installed
`oc-lite` wrapper. V2 does not expose LSP tools; use project lint and
typecheck commands instead:

```bash
./scripts/install/oc-lite.sh
oc-lite
oc-lite run "Hello"
./scripts/doctor/oc-lite.sh
```

Preflight rejects conflicting global and caller-project agents, harness plugins,
and inherited permission rules without changing their files. The full doctor
uses a private, isolated V2 server to check the effective agents, permissions,
and exactly one local topology plugin, then checks model availability in the
caller's database. It does not run a paid model request; when using the wrapper in
another project, rerun preflight from that project to inspect its merged files.

The wrapper uses the installed stock CLI and its one managed background service.
Opening another oc-lite window, creating a SessionManager task, or running `api`,
`mcp`, or `plugin` reuses that service. Different sessions still run concurrently;
the engine's existing per-session coordinator prevents two turns in the same
session from running simultaneously. Do not mix standalone executors into the
same session DB. Explicit disposable diagnostics can still use `serve` on an
isolated DB; no management commands are blocked.

The wrapper preserves the caller's `OPENCODE_DB` and `XDG_DATA_HOME`, including
the normal existing `opencode.db`. It selects a dedicated service registration
under `~/.local/state/opencode-o/oc-lite` via `XDG_STATE_HOME`; override it with
`OC_LITE_STATE_HOME`. Config isolation alone does not isolate a background service. On first setup,
the installer selects service port 49375 when no explicit port is configured.
Existing user port settings are preserved. It neither copies
sessions/credentials nor introduces a new engine channel. A managed service keeps
its startup configuration: changing a profile or database requires a deliberate
service restart after its active work ends. `OC_LITE_PROFILE_DIR` selects the
startup profile; all clients sharing a DB must use the same service registration.
Existing standalone oc-lite windows must be reopened to join the service.

Global oc-lite config remains under `~/.config/opencode-o/oc-lite/opencode`.
Before changing XDG config, the wrapper preserves `GH_CONFIG_DIR` or the caller's
existing GitHub config location. Model selection remains per session. The full
doctor uses a disposable DB for its isolated topology checks and the actual
managed service for existing-account/model checks; it never runs model inference.

SessionManager registers each task's existing report MCP through the stock
location-scoped API. A task's worktree and report socket remain its binding; the
shared process does not inherit a single task's `OPENCODE_CONFIG_CONTENT`.
Closing a managed task interrupts only its exact session before closing its TUI.

Run `./scripts/doctor/oc-lite.sh` to verify the active topology, Worker model
inheritance and Runner's exact model availability in the caller's database.
It creates a throwaway session only in a disposable database and makes no
paid model requests. One-shot `oc-lite models` output may be empty before the
private registry is ready.


## Aria Job Messages

When `~/Documents/SessionManager/state/job-messages/oc-lite.json` exists, the
profile connects its worker to the `job_messages` MCP server. Override the path
with `OPENCODE_JOB_MESSAGES_CONFIG` when needed. The worker gets `createSession`,
`sendMessage`, `completeJob`, and `readAgentMessages`; its native session ID is
provided automatically. Runner cannot call these messaging tools.

Aria replies stay in the server queue. This plugin delivers only a short arrival
notice with native `delivery: "steer"` to the original worker session. It does not
change the selected model or inject the reply body. Restart an existing oc-lite
process after installation. See SessionManager's `docs/job-messages.md` for the
Aria MCP Events connection and subscription.

검수 흐름이 활성화된 메인과 oc-review는 `setupJobMessages(..., { exposeModelTools: false })`를 사용합니다. 메시지 MCP를 모델 도구 목록에서 제외하고 제어부의 직접 API 연결은 유지합니다. 일반 oc-lite의 기본 Aria 도구 노출은 바꾸지 않습니다.
