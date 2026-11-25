### Feature

**You own the design and the result.** Workers write the code; independent reviewers judge it against checks pinned before the code existed.

1. **PRD.** Read [the PRD skill](../../blite-feature/SKILL.md) and continue or start the PRD for this request. Do not start step 3 without an approved PRD: its `approval` line and review run ID.
2. **Design.** Have an `explore` worker trace the affected code. Choose the design yourself: the data shape and the structure that organizes it (a state machine over scattered booleans, a table over branching, a typed model over repeated shape assumptions), and the files in scope.
3. **Pin the checks.** An `impl` worker fills in `.bstack/<name>/checks.md` from the [check table template](../../blite-feature/references/template/checks.md), one row per PRD requirement, and prepares the tests it names without changing production code. Results of running them go in the worker report, not the table. Read the table, commit it with its tests, and record that commit as the check SHA.
4. **Implement.** Give an `impl` worker the design, the approved `index.md` with its 정책 section, the check SHA, and `checks.md`. The table and its tests stay as pinned: `git diff <check SHA> HEAD -- <test paths>` stays empty, and `checks.md` stays identical to its copy at the check SHA wherever the PRD folder sits. A worker that finds a check wrong stops and reports.
5. **Clean up and open the PR.** An `impl` worker strips diff noise (debug output, dead code, comments that restate the code), reruns the checks, and leaves small ordered commits. Move the PRD with `git mv .bstack/<name> .bstack/archive/<name>` and commit. Push the branch and open a ready PR from this head: title `type(scope): subject`, body under 40 lines with `## Why`, `## What changed`, `## Verification`. Pin that head. The code is now final.
6. **Review and merge.** Run [Shipping](shipping.md). On `FAIL`, one `impl` worker finds why the findings were missed and fixes the change; on `STALE`, one rebases onto the current base. Either way it reruns the checks, and you send the new head to the same Shipping run with `bstack-run ask`. Stop at `MERGED` or at a blocker the user must decide.

Keep discoveries outside the agreed scope as non-blocking findings in the report. Do not add them to the PRD or `checks.md`, or expand the work to fix them. If an in-scope check must change, or a contract conflict blocks the agreed work, ask the user. Append the answer verbatim to `request.md`, update the PRD and `checks.md` rows it affects, fix the code, pin a new check SHA, and continue. A user decision needs no new PRD review.

**Reply:** what was built, each requirement with the evidence that passed it, the merge commit, and open decisions.
