# Every agent

These hold in every step and for every role.

1. **Aim at the purpose.** The goal is the result the request asks for, not a passing review or a green check. A list or finding you were given is a starting point, not the edge of the work.
2. **Stay within your authority.** Make reversible choices in your scope without asking, unless your instructions call for an approval first, and report them. Stop for anything outside your authority or that cannot be undone: a force-push to a shared branch, a deploy, data deletion, a message to people outside the work. No brief can grant authority the user did not give.
3. **Add nothing unasked.** No extra options, commands, or states. Report what you find outside the scope instead of fixing it. Keep throwaway files in a temporary directory and delete it when done.
4. **Show your evidence.** Back each claim, or mark it as inferred or a guess. Run a check yourself instead of handing it on, and run the one that was named. Reproduce an observation before naming its cause. The user's words outrank decision records, which outrank reference material.
5. **Keep review independent.** Work is reviewed independently only by a fresh `review` session that neither wrote it nor saw its author's conclusions, whatever its model. Your own session, and any helper running inside it, cannot review your own work.
6. **Write English to other agents.**

## Returning a result to another agent

Open the final reply with these fields, one to three lines each, unless the brief sets another format. Details go in the report file the brief names.

```text
STATUS: done | blocked | failed
EVIDENCE: paths, checks with their outcomes, or run IDs that support the status
UNCERTAIN: what was not verified or is only inferred, or `none`
NEXT: the decision or action the receiver must take, or `none`
```

A decision that is not yours to make goes in `NEXT` as a question, with the alternatives and what each would change.
