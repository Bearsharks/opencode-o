---
name: blite-build
description: Implement an approved PRD using the agreed verification methods and deliver it as a ready PR at a pinned head. Defines what the code and the PR must satisfy before independent review.
disable-model-invocation: true
---

# Build and PR

The goal is an implementation whose verification methods pass because their 목적 is met, delivered as a PR a reviewer can judge at one fixed head.

If you are the lead and did not come here through blite-mode or blite-free, first read what [blite-free](../blite-free/SKILL.md) points to.

## Code

Give an `impl` worker `design.md`, `index.md` with its 정책 section, and `checks.md`. The worker implements the feature and the tests needed by its verification methods.

For each F-ID, use the last row in `checks.md`. Its verification method must pass at the head and have been observed to fail when the behavior is absent.

## PR

The PR is done when:

- its diff carries no noise (debug output, dead code, comments that restate the code) and its commits are small and ordered;
- the checks still pass at its head;
- the PRD folder is archived as [blite-feature](../blite-feature/SKILL.md) defines;
- it is ready for review, not a draft;
- its title is `type(scope): subject`;
- its body is under 40 lines with `## Why`, `## What changed`, and `## Verification`, and long evidence sits in a file or a PR comment linked from the body;
- its head is pinned as the code to be judged.
