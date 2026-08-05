# Harness Gap Analysis & Roadmap

## Current State

### opencode-o (Token Efficiency)
- **Topology**: `orchestrator` -> `terraworker` | `lunaworker` -> `probe` (via `investigate` tool)
- **Read budget**: 600 lines / 25K chars per agent, with Probe discount (1/10, 1/5, 1/2)
- **Plugin**: `harness-state.ts` enforces topology, reusable Probe slots, read-budget accounting
- **Orchestrator**: read-only (no edit/write), delegates all implementation
- **Strategic reading**: `reuse` > `investigate` > `direct` hierarchy

### opencode-o-max (Max Quality)
- **Topology**: `HTOrchestrator` -> `terraworker` | `runner`
- **Plugin**: `max-topology.ts` enforces topology only (no read budget)
- **HTOrchestrator**: can edit/write directly, uses Runner for broad exploration
- **No read-budget accounting**; chooses based on quality, time, context cleanliness

### oc-lite (Single Worker)
- **Topology**: `worker` -> `runner`
- **Plugin**: `oc-lite-topology.ts` enforces the two-agent topology only
- **Worker**: edits directly and uses Runner for broad exploration or high-output verification
- **No Terra, A-Max background execution, Kanban, or read-budget accounting**

---

## Gap Analysis

### 1. Parallel Edit Isolation (Git Worktrees)
**Leading practice**: Claude Code and Codex use `git worktree` to let multiple agents edit files simultaneously without conflicts. Each agent works in an isolated worktree, then merges back.

**Current state**: opencode-o relies on prompt-level "Avoid overlapping edit scopes" — no enforcement mechanism.

**Gap**: No worktree orchestration. Parallel Terra/Luna tasks that touch the same files risk conflicts.

**Impact**: Limits safe parallelism; forces overly conservative scope partitioning.

---

### 2. OS-Level Sandboxing
**Leading practice**:
- Claude Code: Seatbelt (macOS) / seccomp (Linux) profiles restrict filesystem, network, process spawn
- Codex: Docker containers with landlock/network isolation
- Cursor: Cloud VMs with full OS isolation

**Current state**: opencode-o uses bash permission patterns (`allow`/`deny`/`ask`) — application-level control only.

**Gap**: No OS-level sandbox. A rogue bash command can access any file the user can.

**Impact**: Security risk for untrusted codebases; no defense-in-depth against prompt injection.

---

### 3. Declarative Lifecycle Hooks
**Leading practice**:
- Claude Code: `PreToolUse`, `PostToolUse`, `Stop`, `Notification` hooks for auto-formatting, PII scanning, gating
- Codex: Similar hook system for pre/post tool execution
- Cursor: Hooks for capability gating

**Current state**: opencode-o plugin uses `tool.execute.before/after` internally, but no user-facing hook DSL for:
- Auto-formatting after edit (Prettier/Biome)
- PII/secret scanning before commit
- Custom gating (e.g., require tests before allowing completion)

**Gap**: No declarative hook configuration. All enforcement requires writing plugin code.

**Impact**: Harder to extend; users cannot add custom policies without TypeScript.

---

### 4. Trajectory Recording & Replay
**Leading practice**:
- Codex: `record`/`replay` commands capture full session for debugging and eval
- SWE-agent: Trajectory logging with tool calls, observations, rewards
- mini-SWE-agent: Lightweight trajectory format for benchmarking

**Current state**: No trajectory recording. Sessions are ephemeral; no way to replay or analyze.

**Gap**: No structured trajectory export, no replay mechanism, no eval integration.

**Impact**: Cannot debug failure modes systematically; cannot run SWE-bench or Terminal-Bench.

---

### 5. Browser/Computer-Use Verification
**Leading practice**: Cursor cloud agents use browser automation to verify UI changes end-to-end.

**Current state**: opencode-o has `bunx playwright test` allowed but no structured browser verification workflow.

**Gap**: No built-in "verify this UI change in a real browser" capability.

**Impact**: UI changes rely on unit tests or manual verification; no visual regression detection.

---

### 6. Evaluation Harness
**Leading practice**: Dedicated eval pipelines for SWE-bench Verified/Multilingual/Pro, Terminal-Bench, tracking:
- Pass@k (correctness)
- Token usage, cost, latency
- Reliability (retry behavior, flaky tests)

**Current state**: No eval harness. No way to measure harness quality systematically.

**Gap**: No benchmark integration, no metric collection, no regression tracking.

**Impact**: Cannot compare harness versions quantitatively; improvements are anecdotal.

---

## Roadmap

### Phase 1: Foundation (1-2 weeks)
**Goal**: Enable systematic measurement and debugging.

1. **Trajectory recording plugin**
   - Capture tool calls, observations, agent decisions, timestamps
   - Export as JSONL in SWE-agent-compatible format
   - Add `replay` command to reconstruct session state

2. **Eval harness scaffold**
   - SWE-bench Verified integration (Docker-based task execution)
   - Metric collection: pass@1, tokens, cost, latency
   - CI pipeline for regression tracking

**Verification**: Run 10 SWE-bench tasks, compare pass@1 against Claude Code baseline.

---

### Phase 2: Safety & Isolation (2-3 weeks)
**Goal**: Reduce security risk and enable safe parallelism.

3. **OS-level sandbox (macOS first)**
   - Seatbelt profile generator plugin
   - Restrict filesystem to workspace + temp dirs
   - Block network by default, allowlist specific domains
   - Add `sandbox: true` option to agent config

4. **Git worktree orchestration**
   - Plugin to create worktrees per Terra/Luna task
   - Auto-merge on task completion (with conflict detection)
   - Add `worktree: true` option to task delegation

**Verification**: Run 5 parallel edit tasks, verify zero conflicts; audit sandbox escape attempts.

---

### Phase 3: Extensibility (1-2 weeks)
**Goal**: Make the harness user-extensible without plugin code.

5. **Declarative lifecycle hooks**
   - Config DSL: `hooks: { "PostToolUse.edit": "bunx biome write {file}" }`
   - Built-in hooks: auto-format, secret-scan, test-gate
   - Hook execution sandboxed (no filesystem escape)

6. **Browser verification workflow**
   - Add `verify_ui` tool: takes screenshot, compares to baseline, reports diffs
   - Playwright integration for interaction testing
   - Visual regression detection (pixel diff + structural diff)

**Verification**: Add auto-format hook to opencode-o, verify all edits are formatted; run 3 UI tasks with visual verification.

---

### Phase 4: Advanced Capabilities (ongoing)
**Goal**: Close remaining gaps and explore new frontiers.

7. **Cloud/VM isolation** (optional, for untrusted codebases)
   - Firecracker microVM or Docker container per session
   - Full OS isolation with network policy
   - Snapshot/restore for fast startup

8. **Multi-agent coordination protocols**
   - Explicit message-passing between agents (beyond task delegation)
   - Shared blackboard for evidence accumulation
   - Consensus protocols for conflicting edits

9. **Adaptive strategy selection**
   - Learn from trajectory data which reading strategy works best per task type
   - Auto-tune read budget based on task complexity
   - Dynamic topology selection (o vs o-max) based on task characteristics

**Verification**: A/B test adaptive strategy on 50 tasks; measure token savings vs quality tradeoff.

---

## Priority Matrix

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Trajectory recording | High (enables eval + debugging) | Low | **P0** |
| Eval harness | High (quantitative improvement) | Medium | **P0** |
| OS sandbox | High (security) | Medium | **P1** |
| Worktree orchestration | Medium (parallelism) | Medium | **P1** |
| Lifecycle hooks | Medium (extensibility) | Low | **P2** |
| Browser verification | Low (UI-specific) | Medium | **P3** |
| Cloud isolation | Low (niche use case) | High | **P4** |

---

## Success Metrics

### Phase 1
- [ ] Trajectory export works for 10+ sessions
- [ ] SWE-bench pass@1 within 10% of Claude Code baseline
- [ ] CI pipeline runs eval on every PR

### Phase 2
- [ ] Zero filesystem escapes in 100 sandbox test cases
- [ ] Zero merge conflicts in 20 parallel edit tasks
- [ ] Sandbox overhead < 5% latency increase

### Phase 3
- [ ] Auto-format hook reduces manual formatting to zero
- [ ] Visual regression detection catches 90% of UI bugs
- [ ] Users can add custom hooks without TypeScript

### Phase 4
- [ ] Adaptive strategy saves 20% tokens vs fixed strategy
- [ ] Multi-agent coordination reduces rework by 30%
- [ ] Cloud isolation enables 100% safe execution of untrusted code
