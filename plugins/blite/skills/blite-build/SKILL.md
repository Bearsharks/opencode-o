---
name: blite-build
description: Implement an approved PRD against its pinned checks and deliver it as a ready PR at a pinned head. Defines what the code and the PR must satisfy before independent review.
disable-model-invocation: true
---

# Build and PR

The goal is code at which each pinned check passes because its 목적 is met, delivered as a PR a reviewer can judge at one fixed head.

If you are the lead and did not come here through blite-mode, read [the instructions for every agent](../../instructions/global.md), [the lead role](../../instructions/roles/lead.md), and [bstack-run](../../docs/bstack-run.md) first.

## Code

Give an `impl` worker `design.md`, the approved `index.md` with its 정책 section, `checks.md`, and the check SHA. The code is done when:

- every row of `checks.md` passes at the head by its own method, except rows the PRD removed and rows a later row replaced;
- `checks.md` and the tests it names are identical to their content at the check SHA.

## PR

An `impl` worker removes diff noise (debug output, dead code, comments that restate the code), reruns the checks, and leaves small ordered commits. Then the lead, or a worker whose brief grants it, archives the PRD folder as [blite-feature](../blite-feature/SKILL.md) defines, pushes the branch, and opens the PR. The PR is done when:

- it is ready for review, not a draft;
- its title is `type(scope): subject`;
- its body is under 40 lines with `## Why`, `## What changed`, and `## Verification`, and long evidence sits in a file or a PR comment linked from the body;
- its head is pinned as the code to be judged.
