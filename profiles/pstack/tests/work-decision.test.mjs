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
      async () => ({ path: "fixture", text: row.agreement }),
    );
    const decision = { outcome: row.criterion, onPass: "proceed", onFail: "repair" };
    assert.ok(row.original.includes(row.criterion)); // quotation from the historical handoff/closure
    const role = row.name.startsWith("300") ? "hardest tasks" : "bug-fix";
    await assert.rejects(
      run({ role, prompt: row.original, decision }),
      /absent from the current task document/,
    );
    assert.equal(spent, 0);
    assert.ok(row.corrected.includes(row.correctedOutcome));
    const output = await run({
      role,
      prompt: row.corrected,
      decision: { ...decision, outcome: row.correctedOutcome },
    });
    assert.ok(output.includes("작업 기준: fixture") && output.includes(row.corrected));
    assert.equal(spent, 1);
    console.log(row.name, "historical FAIL (0 worker starts); corrected PASS (1 worker start)");
    // The same words become a valid criterion when they actually ARE the requirement.
    const authorized = withDecision(
      async () => true,
      async () => ({ path: "fixture", text: row.criterion }),
    );
    assert.equal(await authorized({ role, prompt: row.original, decision }), true);
  });
}
test("no decision change costs zero workers, across unrelated domains", async () => {
  for (const outcome of ["Export preserves row order", "Keep the payment idempotent"]) {
    const run = withDecision(
      async () => assert.fail("unexpected worker"),
      async () => ({ path: "fixture", text: outcome }),
    );
    await assert.rejects(
      run({
        role: "swarm workers",
        verification: true,
        prompt: "Measure again",
        decision: { outcome, onPass: "proceed", onFail: "proceed" },
      }),
      /same next action/,
    );
  }
});
test("discovery can proceed before criteria are fixed", async () => {
  const run = withDecision(
    async (job) => job.prompt,
    async () => undefined,
  );
  assert.equal(
    await run({ role: "how explorer", prompt: "Explore the requested export" }),
    "Explore the requested export",
  );
});

test("implementation receives the worktree document path even without decision fields", async () => {
  const task = { role: "feature, refactoring", prompt: "Implement the purchase action." };
  await assert.rejects(
    withDecision(
      async () => assert.fail("unexpected writer"),
      async () => undefined,
    )(task),
    /connect the worktree task document/,
  );
  const criteria = { path: "pinned reference", text: "Only one charge per order." };
  const prompt = await withDecision(
    async (job) => job.prompt,
    async () => criteria,
  )(task);
  assert.ok(
    prompt.includes(criteria.path) && !prompt.includes(criteria.text) && prompt.includes(task.prompt),
  );
});

test("a retired condition in the change history cannot block a repair", async () => {
  const run = withDecision(
    async () => assert.fail("unexpected worker"),
    async () => ({ path: "docs/task.md", text: "Return to the shop.\n## 변경이력\nRestore the old pose." }),
  );
  await assert.rejects(
    run({
      role: "bug-fix",
      decision: { outcome: "Restore the old pose.", onPass: "proceed", onFail: "repair" },
    }),
    /absent from the current task document/,
  );
});
