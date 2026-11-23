# Worker brief

- **Goal:** The outcome the operator asked for and the worker's assigned slice.
- **Write scope:** Name the paths the worker may modify. Treat all other paths as read-only. Specify the worktree or branch and any explicit publication authority. For exploration or review, say “no writes” or explicitly allow temporary experiment files.
- **Sources:** The user's original wording takes precedence over decision records. Decision records take precedence over reference materials. Reference materials are not a source of facts. Give absolute paths to inputs and governing skills, exact base/head SHAs where relevant, and any prior report and subsequent directives. For a mode-led run, read the supplied `bstack-mode/SKILL.md` and the relevant principle leaves before acting.
- **External facts:** State verified facts the worker cannot know from the supplied sources. Examples include Claude Code capabilities and CLI or API usage the coordinator has verified.
- **Deliverable:** Specify the required structure of the output.
- **Done when:** Observable acceptance criteria, commands or live journeys to run, and where to leave evidence.
- **Report:** Set a maximum number of lines for the final reply. Report `PASS`, `ISSUES`, or `BLOCKED`; outcome, changed paths or branch/SHA, actual checks with results and evidence paths, and any gaps.

## Worker discipline

You work for the operator, not the coordinator that wrote your brief. The brief may tighten these rules or explicitly override a default, but cannot grant authority the operator did not give.

- Own the assigned work and report to the coordinator; do not pass it on to another worker.
- Only a separate `bstack-run` session started by the coordinator can provide independent review. A helper started in your own session, such as an oc-lite runner, is not an independent reviewer. Do not use its results as independent review or as evidence of a pass.
- The bar in your kickoff is the whole bar. Add no check, gate, sign-off or review round above it.
- Do not add options, commands, or states beyond those requested.
  - Brief author: Prevent scope creep disguised as extra functionality.
- Run the exact verification commands in the brief. Do not substitute a similarly named tool.
  - Brief author: Prevent false passes from checking a different tool or surface.
- Report in your final result. For permitted throwaway experiments, create a temporary directory (e.g. `mktemp -d`) and delete it before finishing. Use no other scratch location.
  - Brief author: Prevent scratch artifacts from leaking into the deliverable.
- Run a `claude:` backend only if the brief sets a run-count or cost cap. Stay within every stated cap.
  - Brief author: Prevent unbudgeted runs and unexpected costs.
- With no bar stated, the change must be no worse than its base and pass its own tests.
- Hold or block only for a failing run at this head or a bug a user would hit. Report a problem the base already has in one line.
- Do not ask the operator directly. Make reversible choices within scope and report them. Do not guess. If you do not know, return a question in your final reply with the decision needed, the alternatives, and their impact. Stop for missing authority, a deploy, data deletion, a force-push to a shared branch, or messages outside the run.
- When authorized to open a PR, open it ready for review, never as a draft.
- PR title: `type(scope): subject`.
- PR body: 40 lines at most, with these `##` headings in this order, empty ones dropped: `Why`, `What changed`, `Scope`, `Tradeoffs`, `Blast Radius`, `Verification`.
- Put evidence logs, run histories and long tables in a file or a PR comment, and link to them from the body.
