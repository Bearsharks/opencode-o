---
name: pre-implementation-review-quality-gate
description: Orchestrator workflow for conducting a proportional, user-confirmed three-stage review of product purpose, system architecture, and program design before implementation.
---

## Pre-Implementation Review

Use the following review workflow for implementation work. Reuse decisions
already confirmed in the current session, start at the first unresolved stage,
and keep the depth of each stage proportional to the task.

1. **Product and purpose review.** Interview the user in the current session to
   establish the problem being solved, intended user experience or behavior,
   success criteria, scope and non-goals, and any unresolved product or policy
   choices. After the user confirms this level, continue to the system and
   architecture review.
2. **System and architecture review.** Interview the user in the current
   session to establish system and module boundaries, responsibility and state
   ownership, API/data/event flow, reuse of existing architecture,
   compatibility requirements, and the expected impact radius. After the user
   confirms this level, continue to the program design review.
3. **Program design review.** Present the proposed code shape for user review,
   including responsibility separation; core types, data structures, and
   invariants; important function or method inputs and outputs; normal and
   failure call flows; files and key symbols to create or modify;
   implementation slices; verification approach; and the program-design
   decisions that require user judgment. Use the presentation medium that best
   fits the task. An HTML artifact may be used when visual comparison or flow
   inspection is valuable, but HTML is not required. Ask the user to confirm
   the program design before implementation.

## Session-Derived Refinements

Apply these additions in priority order:

- **P0:** Implementation starts only after the user explicitly confirms the
  latest presented design exactly as presented. Any design revision after a
  confirmation — whether proposed by the user or by the orchestrator — voids
  the prior confirmation: present the revised delta and obtain a fresh
  confirmation before implementing. A user reply that resolves some decision
  points while raising a new design question or counter-proposal is NOT a
  confirmation; answer the question and re-confirm first. Never begin or
  announce implementation in the same message that introduces a design
  revision.
- **P0:** Verify routes, workflow steps, sections, and module boundaries from
  source before using those terms in architecture claims.
- **P0:** When a design, request, or reference implementation is provided,
  compare it with the current implementation and surface missing, removed, or
  incomplete behavior during product review.
- **P1:** Distinguish external modules, application-internal shared components,
  and feature-specific adapters when explaining reuse.
- **P1:** Check relevant shared layouts, sibling surfaces, headers, footers, and
  auxiliary actions when determining impact radius.
- **P1:** For multi-file or structural work, present a repository-relative file
  tree marked as new, modified, deleted, or reused. Use a complete path list for
  small changes.
