### Shipping

**You own what lands. Hand each authorized PR to the independent Shipping primary, land only the verified run from the root, then keep your hands off the stack.**

A request to review and merge the current PR (including “검수하고 머지해”) authorizes the handoff below. The caller owns stack order and any code fixes. The independent Shipping primary owns the per-PR verdicts and merge.

1. **Identify the PR and its acceptance scenario.** Resolve the active forge as usual and use the PR already in the conversation. Read its current base and head. Prepare the GitHub owner/repo, PR number, full head SHA and optional reproduction notes for `pstack_ship`. The tool reviews and can immediately merge the submitted PR, so submit only the current frontier. Leave independent reviewers and execution verification to Shipping.
2. **Land only the contiguous authorized run rooted at the bottom.** A verified PR above a pending one waits. If a PR moves to trunk on its own, the Shipping primary needs to verify it against that base first.
3. **Re-check that the verdicts still describe the code.** Include any changed base, callers or requirements in the handoff. Shipping decides which perspective still applies after a rebase or repair.
4. **Land bottom-up, one PR at a time.** Call `pstack_ship(repo, pr, head, notes)` now. On rework, fix the owning PR, push, and resubmit its new head from the same session. On a blocker, stop at that PR. Only a confirmed merge into the intended base advances the stack. Retarget the next child to trunk on the selected forge, rebase it onto the merge result, and push with `--force-with-lease` before handing it off in turn.
5. **Leave the stack alone while it lands.** Step 4's move of the next PR is the only change to a branch or base, because a merge lands whatever its branch and base hold at that moment, verdict or not. On GitHub, watch the run with the queued watcher from `playbooks/babysit.md` (`scripts/watch-pr/watch-pr --queued-stack --stack-prs <bottom-to-top>`) under `/loop` until it reports `COMPLETE` at the ceiling. On Origin, re-read the current PR with `origin pr view <pr> --checks` each time `origin pr checks <pr> --watch` returns, until the ceiling reads merged. A base that moves to trunk when its parent merges is expected, not damage to repair. If a merge stalls, find out why before you change anything.
6. **Stop at the ceiling.** Extending the run takes new verdicts, so it is a new pass through step 1.

**Reply:** the verified run and its ceiling, each PR's verdict and who produced it, what landed and how you confirmed it, and what the next gap needs.
