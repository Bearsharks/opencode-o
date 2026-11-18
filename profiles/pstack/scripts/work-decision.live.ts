// Real native child sessions, offline provider. The transport boundary is the unit of cost.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ready, testHost } from "./test-host";
import cases from "../tests/decision-replays.json";
let generation = 0;
const endpoint = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (req) => {
    const b = await req.json();
    generation++;
    const chunk = (delta: object, finish_reason: string | null) => ({
      id: "decision-replay",
      object: "chat.completion.chunk",
      created: 1,
      model: b.model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    return new Response(
      "data: " +
        JSON.stringify(chunk({ role: "assistant", content: "OK" }, null)) +
        "\n\ndata: " +
        JSON.stringify(chunk({}, "stop")) +
        "\n\ndata: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
const root = resolve(import.meta.dir, "..");
const host = await testHost({
  model: "pstack-test/gpt-parent#high",
  agents: { pstack: { mode: "primary" } },
  plugins: [
    root + "/plugins/pstack",
    resolve(import.meta.dir, "fixtures/probe"),
    {
      package: resolve(import.meta.dir, "fixtures/models"),
      options: { url: `http://127.0.0.1:${endpoint.port}/v1` },
    },
  ],
});
try {
  for (const id of ["pstack", "pstack-test-probe", "pstack-test-models"]) await ready(host, id);
  for (const row of cases) {
    const location = { directory: host.project };
    const parent = await host.client.session.create({ agent: "pstack", location });
    await host.client.session.prompt({ sessionID: parent.id, text: row.agreement });
    await host.client.session.wait({ sessionID: parent.id });
    const children = async () => (await host.client.session.list({ parentID: parent.id })).data;
    const run = async (prompt: string, outcome: string) => {
      const r = await host.client.rpc.call({
        location,
        rpcID: "pstack-test-probe",
        method: "call",
        input: {
          sessionID: parent.id,
          tool: "subagent",
          args: {
            agent: "general",
            role: row.name.startsWith("300") ? "hardest tasks" : "bug-fix",
            prompt,
            description: "Review the observed outcome",
            background: false,
            decision: { source: "request", outcome, onPass: "proceed", onFail: "repair" },
          },
        },
      });
      return r.output as { toolError?: string };
    };
    const before = generation;
    assert.match((await run(row.original, row.criterion)).toolError ?? "", /absent from the cited source/);
    assert.equal((await children()).length, 0);
    assert.equal(generation, before);
    assert.equal((await run(row.corrected, row.correctedOutcome)).toolError, undefined);
    assert.equal((await children()).length, 1);
    assert.equal(generation, before + 1);
    console.log(
      row.name,
      "historical FAIL: 0 child sessions / 0 provider calls; corrected PASS: 1 child session / 1 provider call",
    );
  }
} finally {
  await host.close();
  endpoint.stop(true);
}
