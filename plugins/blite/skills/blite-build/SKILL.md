---
name: blite-build
description: Implement agreed requirements with their agreed design and verification methods and deliver them as a ready PR at a pinned head. Defines what the code and the PR must satisfy before independent review.
disable-model-invocation: true
---

# Build and PR

The goal is an implementation whose verification methods pass because the success they check is met, delivered as a PR a reviewer can judge at one fixed head.

If you are the lead, first read [Every agent](../../instructions/global.md), [Lead](../../instructions/roles/lead.md), and [bstack-run](../../docs/bstack-run.md), unless you already have.

## Code

Preconditions: the requirements with their success definitions, the policies to keep or change, the agreed design, and the agreed verification method for each requirement.

Give an `impl` worker all of them. The worker implements the requirements and the tests their verification methods need.

For each requirement, use its latest agreed verification method. It must pass at the head and have been observed to fail when the behavior is absent.

## PR

The PR is done when:

- its diff carries no noise (debug output, dead code, comments that restate the code) and its commits are small and ordered;
- the checks still pass at its head;
- the work folder is archived;
- it is ready for review, not a draft;
- its title is `type(scope): subject`;
- its body is under 40 lines with `## Why`, `## What changed`, and `## Verification`, and long evidence sits in a file or a PR comment linked from the body;
- its head is pinned as the code to be judged.
