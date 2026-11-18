import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withDecision } from "../plugins/pstack/work-decision.ts";

const cases = JSON.parse(readFileSync(new URL("decision-replays.json", import.meta.url)));
for (const row of cases) {
  test(row.name + ": original rejected; corrected dispatches once", async () => {
    let spent = 0;
    const run = withDecision(
      async (job) => {
        spent++;
        return job.prompt;
      },
      async () => row.agreement,
    );
    const decision = { source: "fixture", outcome: row.criterion, onPass: "proceed", onFail: "repair" };
    assert.ok(row.original.includes(row.criterion)); // quotation from the historical handoff/closure
    const role = row.name.startsWith("300") ? "hardest tasks" : "bug-fix";
    await assert.rejects(run({ role, prompt: row.original, decision }), /absent from the cited source/);
    assert.equal(spent, 0);
    const output = await run({ role, prompt: row.corrected, decision: { ...decision, outcome: row.agreement } });
    assert.ok(output.includes(row.agreement) && output.includes(row.corrected));
    assert.equal(spent, 1);
    console.log(row.name, "historical FAIL (0 worker starts); corrected PASS (1 worker start)");
    // The same words become a valid criterion when they actually ARE the requirement.
    const authorized = withDecision(
      async () => true,
      async () => row.criterion,
    );
    assert.equal(await authorized({ role, prompt: row.original, decision }), true);
  });
}
test("no decision change costs zero workers, across unrelated domains", async () => {
  for (const outcome of ["Export preserves row order", "Keep the payment idempotent"]) {
    const run = withDecision(
      async () => assert.fail("unexpected worker"),
      async () => outcome,
    );
    await assert.rejects(
      run({
        role: "swarm workers",
        verification: true,
        prompt: "Measure again",
        decision: { source: "fixture", outcome, onPass: "proceed", onFail: "proceed" },
      }),
      /same next action/,
    );
  }
});
test("ordinary implementation keeps its original brief", async () => {
  const run = withDecision(
    async (job) => job.prompt,
    async () => assert.fail("unexpected source read"),
  );
  assert.equal(
    await run({ role: "feature, refactoring", prompt: "Implement the requested export" }),
    "Implement the requested export",
  );
});
