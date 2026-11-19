import assert from "node:assert/strict";
import test from "node:test";
import { rebuildLegacyCycle } from "../plugins/pstack/rework.ts";

const heads = ["a", "b", "c", "d"].map((x) => x.repeat(40));
const history = (index, status, at) => [
  { type: "user", text: JSON.stringify({ repo: "o/r", pr: 4, head: heads[index] }) },
  {
    type: "assistant",
    finish: "stop",
    time: { completed: at },
    content: [{ type: "text", text: "SHIPPING_RESULT: " + status }],
  },
];
const old = (status) => ({ since: 0, heads, pause: { at: 5, result: "SHIPPING_RESULT: " + status } });
test("repair a legacy pause from environmental blocks across Shipping sessions", () => {
  const sessions = [
    history(0, "REWORK", 1),
    history(1, "BLOCKED", 2),
    history(2, "BLOCKED", 3),
    history(3, "BLOCKED", 4),
  ];
  assert.deepEqual(rebuildLegacyCycle(old("BLOCKED"), sessions, "o/r", 4), {
    version: 2,
    since: 0,
    heads: heads.slice(0, 1),
  });
});
test("preserve actual legacy failures, including a candidate subsequently blocked", () => {
  const sessions = heads.map((_, i) => history(i, "REWORK", i + 1));
  sessions.push(history(1, "BLOCKED", 6));
  const cycle = old("REWORK");
  assert.deepEqual(rebuildLegacyCycle(cycle, sessions, "o/r", 4), { ...cycle, version: 2 });
});
