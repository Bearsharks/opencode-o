---
name: blite-build
description: Implement an approved PRD against its pinned checks and deliver it as a ready PR at a pinned head. Defines what the code and the PR must satisfy before independent review.
disable-model-invocation: true
---

# Build and PR

The goal is code at which each pinned check passes because its 목적 is met, delivered as a PR a reviewer can judge at one fixed head.

If you are the lead and did not come here through blite-mode, first read what [blite-mode](../blite-mode/SKILL.md) points to.

## Code

Give an `impl` worker `design.md`, `index.md` with its 정책 section, and `checks.md`. For each F-ID, use the last row in `checks.md`. Its verification method must pass at the head and have been observed to fail when the behavior is absent.

## PR

The PR is done when:

- its diff carries no noise (debug output, dead code, comments that restate the code) and its commits are small and ordered;
- the checks still pass at its head;
- the PRD folder is archived as [blite-feature](../blite-feature/SKILL.md) defines;
- it is ready for review, not a draft;
- its title is `type(scope): subject`;
- its body is under 40 lines with `## Why`, `## What changed`, and `## Verification`, and long evidence sits in a file or a PR comment linked from the body;
- its head is pinned as the code to be judged.
