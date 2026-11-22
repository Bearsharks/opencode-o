### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. Trace the affected subsystem.
2. `architect` for the shape.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing to `bstack-run run --role impl --brief "$BRIEF"` with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). An implementation worker owns its scoped diff directly; the coordinator assigns the independent review. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
   Before delegating implementation of a new feature, require the current approved PRD unless the user explicitly waived it. Give the worker the approved index, review run ID and applicable `F-xx/성공 정의` cells, and the PRD's 정책 section (policies to keep or change). If waived, include the user's waiver and the agreed criteria.
5. Clean up and pin the head. Have one `impl` worker strip diff noise (debug output, dead code, comments that restate code, per **no-comments**), rerun the checks, and rebase into small, ordered commits. Stack follow-ups. Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next. The code is now final; pin that head.
6. Review the pinned head once. Launch the [structure reviewer](../../../templates/review-structure.md) and [behavior reviewer](../../../templates/review-behavior.md) in parallel, each with `bstack-run run --role review --worktree`. The behavior reviewer runs the change on the matching surface and judges the applicable `F-xx/검증` cells with commands + EXPECT no weaker than the PRD, recording evidence by cell. If waived, verify against the agreed criteria instead. A feature pass is not evidence that a product hypothesis is supported. "Inconclusive" or wrong-surface is not a pass. Flag it. No worker writes while review runs. For blocking findings, one worker fixes them, pin the new head, and re-review only the perspectives the change affects. Record the passing head SHA and both review run IDs.
   If implementation or review turns up an existing contract or policy that the PRD's 정책 section does not cover, or a conflict with one, do not settle it yourself as a pre-existing gap or out of scope. Ask the user, append the answer with `bstack-prd append`, update the 정책 section, and get the PRD re-approved before relying on it.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR** with the reviewed head, and hand the head SHA and review run IDs to Babysit and Shipping.

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
