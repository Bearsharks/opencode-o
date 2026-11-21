---
name: bstack-interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
metadata:
  opencode/autoinvoke: false
---

**bstack 실행 경계 (아래 원본에서 이 부분만 대체):** 원본 arena의 대응 절차는 bstack-arena다. 의도를 먼저 되짚고 읽기 전용 reader에게 서로 다른 반증 시도를 맡긴다. 메인이 권한 안에서 격리된 probe를 직접 실행·재확인하고 조건·명령·출력을 남긴다. 불가능한 범위만 권한 있는 실행자에게 요청한다. 기존 기록 열람만으로 재실행했다 하지 않는다. 재현 없이는 미검증이며 변경을 적용하지 않는다.

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. State the intent with the **in-your-own-words** skill, from the user's message, the commits, and the PR description. Ask the user when the intent is unclear.

## Fan out

Run Phase A steps 3 and 4 and Phase B of the **arena** skill, with four changes. Resolve `role: "interrogate reviewers"` with `pstack_models` in place of the `arena runners` role, preserving the configured reviewer list and seat count. Copy the scope's uncommitted changes into each worktree. Spawn each adversary with native `subagent`, `agent: "general"`, `role: "interrogate reviewers"`, its returned zero-based `seat`, and `background: true`. In place of the arena task and rationale, give each adversary the scope, the intent, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

## Verify

Verify each finding per arena Phase F by rerunning its command. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.
