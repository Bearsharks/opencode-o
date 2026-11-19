import { connectFixture } from "./criteria-fixture";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { testHost, ready } from "./test-host";
let emitted = false, childModel: any;
const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json();
  const child = body.messages.some((m: any) => m.role === "user" && JSON.stringify(m.content).includes("SETUP_CHILD"));
  let delta: any, finish: string;
  if (child) { childModel = { model: body.model, effort: body.reasoning_effort }; delta = { role: "assistant", content: "CHILD_DONE" }; finish = "stop"; }
  else if (!emitted) { emitted = true; delta = { role: "assistant", tool_calls: [{ index: 0, id: "setup_child", type: "function", function: { name: "subagent", arguments: JSON.stringify({ agent: "poteto-agent", role: "bug-fix", decision: { onPass: "proceed", onFail: "repair" }, difficulty: "routine", description: "Check saved model", background: false, prompt: "SETUP_CHILD. Return done." }) } }] }; finish = "tool_calls"; }
  else { delta = { role: "assistant", content: "DONE" }; finish = "stop"; }
  const chunk = { id: "setup-fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const host = await testHost({ model: "pstack-test/gpt-parent#high", plugins: [resolve(import.meta.dir, "../plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1` } }] });
try {
  const path = resolve(host.profile, "pstack-models.json");
  writeFileSync(path, JSON.stringify({ version: 1, budget: "large", roles: { "how critics": "auto", "bug-fix": "pstack-test/gpt-parent#high", "how explorer": "auto", "arena runners": ["inherit-parent", "pstack-test/claude-opus-5-5#high", "inherit-parent"] } }));
  for (const id of ["pstack", "pstack-test-models", "pstack-test-probe"]) await ready(host, id);
  const session = await host.client.session.create({ location: { directory: host.project }, model: { providerID: "pstack-test", id: "gpt-parent", variant: "high" } });
  connectFixture(host.project);
  const call = async (args: object) => {
    const response: any = await host.client.rpc.call({ rpcID: "pstack-test-probe", method: "call", location: { directory: host.project }, input: { tool: "pstack_models", sessionID: session.id, args } });
    if (response.output.toolError) throw new Error(response.output.toolError);
    return response.output.output;
  };
  const first = await call({ action: "catalog", provider: "pstack-test", limit: 2 });
  const second = await call({ action: "catalog", provider: "pstack-test", limit: 2, offset: first.nextOffset });
  if (first.models.length !== 2 || second.models[0].ref === first.models[0].ref) throw new Error("Catalogue pagination failed");
  const before = readFileSync(path, "utf8");
  const plan = await call({ action: "plan", budget: "unlimited" });
  if (plan.rows.length !== 17 || plan.dropped[0]?.role !== "how critics" || readFileSync(path, "utf8") !== before) throw new Error("Planning mutated settings or omitted roles/retired entries");
  if (plan.config.roles["how explorer"] !== "auto" || plan.config.roles["arena runners"].length !== 3 || plan.config.roles["bug-fix"] !== "pstack-test/gpt-parent#max") throw new Error("Budget plan changed user choices incorrectly");
  await call({ action: "validate", config: plan.config });
  const saved = await call({ action: "save", config: plan.config, expectedRevision: plan.revision });
  if (JSON.parse(readFileSync(path, "utf8")).roles["how critics"] !== undefined) throw new Error("Retired role was saved");
  let stale = false, invalid = false;
  try { await call({ action: "save", config: plan.config, expectedRevision: plan.revision }); } catch { stale = true; }
  try { await call({ action: "save", config: { version: 1, roles: { "bug-fix": "missing/model" } }, expectedRevision: saved.revision }); } catch { invalid = true; }
  if (!stale || !invalid) throw new Error("Save accepted stale review or unavailable model");
  await host.client.session.prompt({ sessionID: session.id, text: "Verify the saved role's real child call." });
  await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30000) });
  if (childModel?.model !== "gpt-parent" || childModel.effort !== "high") throw new Error(`Saved role did not reach provider: ${JSON.stringify(childModel)}`);
  writeFileSync(resolve(import.meta.dir, "../provenance/setup-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), cataloguePaging: true, all17Roles: true, planIsReadOnly: true, retiredRolesReported: true, aliasesAndDuplicateSeatsPreserved: true, budgetApplied: true, validatedAtomicSave: true, staleSaveRejected: true, unavailableModelRejected: true, savedRoleReachedNativeChild: childModel }, null, 2) + "\n");
  console.log("PASS 17-role setup planning, validation, atomic save and actual saved-model delegation");
} finally { await host.close(); endpoint.stop(true); }
