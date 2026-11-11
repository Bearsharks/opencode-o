import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { testHost, ready } from "./test-host";

const wire: { marker: string; model: string; effort: string }[] = [];
const emitted = new Set<string>();
const controls = new Map<string, object>();
const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json();
  const users = body.messages.filter((m: any) => m.role === "user");
  const child = JSON.stringify(users).match(/FAILURE_CHILD_(SYNC|BG)_(REJECT|RETRY)|CONTROL_CHILD_\w+/)?.[0];
  let delta: any, finish = "stop";
  if (child) {
    wire.push({ marker: child, model: body.model, effort: body.reasoning_effort });
    if ((body.model === "grok-4.7" && body.reasoning_effort === "medium") || (body.model === "claude-opus-5-5" && body.reasoning_effort === "high")) {
      return Response.json({ error: { message: `Unsupported model ${body.model}#${body.reasoning_effort}`, type: "invalid_request_error", code: "model_not_found" } }, { status: 404 });
    }
    delta = { role: "assistant", content: "CHILD_DONE" };
  } else {
    const marker = JSON.stringify(users.at(-1)).match(/FAILURE_PARENT_(SYNC|BG)_(REJECT|RETRY)|CONTROL_CASE_\d+/)?.[0];
    if (marker && !emitted.has(marker)) {
      emitted.add(marker);
      const calls = controls.has(marker) ? [controls.get(marker)] : ["bug-fix", "judgment and prose"].map(role => ({ agent: "general", role, difficulty: "routine", description: `${marker} ${role}`, background: marker.includes("_BG_"), prompt: marker.replace("PARENT", "CHILD") }));
      delta = { role: "assistant", tool_calls: calls.map((args, index) => ({ index, id: `${marker}_${index}`, type: "function", function: { name: "subagent", arguments: JSON.stringify(args) } })) };
      finish = "tool_calls";
    } else delta = { role: "assistant", content: "PARENT_DONE" };
  }
  const chunk = (d: any, f: string | null) => ({ id: "failure-fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: d, finish_reason: f }] });
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, finish))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const host = await testHost({ model: "pstack-test/gpt-parent#high", plugins: [resolve(import.meta.dir, "../plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1` } }] });
try {
  writeFileSync(resolve(host.profile, "pstack-models.json"), JSON.stringify({ version: 1, roles: { "bug-fix": "pstack-test/grok-4.7#xhigh", "judgment and prose": "pstack-test/claude-opus-5-5#max" } }));
  for (const id of ["pstack", "pstack-test-models", "pstack-test-probe"]) await ready(host, id);
  for (const mode of ["SYNC", "BG"]) {
    const parent = await host.client.session.create({ location: { directory: host.project }, model: { providerID: "pstack-test", id: "gpt-parent", variant: "high" } });
    for (const phase of ["REJECT", "RETRY"]) {
      await host.client.session.prompt({ sessionID: parent.id, text: `FAILURE_PARENT_${mode}_${phase}` });
      await host.client.session.wait({ sessionID: parent.id }, { signal: AbortSignal.timeout(30000) });
      const children = (await host.client.session.list({ parentID: parent.id, limit: 100 })).data;
      await Promise.all(children.map(child => host.client.session.wait({ sessionID: child.id }, { signal: AbortSignal.timeout(30000) })));
      const seen = wire.filter(w => w.marker === `FAILURE_CHILD_${mode}_${phase}`);
      if (seen.length !== 2) throw new Error(`Expected 2 ${mode} ${phase} requests: ${JSON.stringify(seen)}; ${JSON.stringify(await host.client.session.context({ sessionID: parent.id })).slice(-7000)}`);
      if (phase === "RETRY" && (seen.find(w => w.model === "grok-4.7")?.effort !== "xhigh" || seen.find(w => w.model === "claude-opus-5-5")?.effort !== "max")) throw new Error(`Both refusals must survive and restore baselines: ${JSON.stringify(seen)}`);
    }
  }
  const parent = await host.client.session.create({ location: { directory: host.project }, model: { providerID: "pstack-test", id: "gpt-parent", variant: "high" } });
  const control = async (args: object) => {
    const marker = `CONTROL_CASE_${controls.size}`;
    controls.set(marker, { agent: "general", role: "bug-fix", description: marker, background: false, ...args });
    await host.client.session.prompt({ sessionID: parent.id, text: marker });
    await host.client.session.wait({ sessionID: parent.id }, { signal: AbortSignal.timeout(15000) });
    const context = await host.client.session.context({ sessionID: parent.id });
    return context.flatMap((m: any) => m.type === "assistant" ? m.content.filter((p: any) => p.type === "tool") : []).find((t: any) => t.state.input?.description === marker)?.state;
  };
  const seed = await control({ prompt: "CONTROL_CHILD_SEED. Original directive: retain this exact brief." });
  if (seed?.status !== "completed") throw new Error(`Seed failed: ${JSON.stringify(seed)}`);
  const child = (await host.client.session.list({ parentID: parent.id, limit: 100 })).data[0];
  const invalid = await control({ sessionID: child.id, prompt: "CONTROL_CHILD_INVALID_REUSE" });
  if (invalid?.status !== "error" || !invalid.error.message.includes("fresh child")) throw new Error("Unjustified reuse was accepted");
  const reused = await control({ sessionID: child.id, role: "hardest tasks", retainedState: { kind: "checkout", reason: "This fixture models a required private checkout whose state must remain with this child." }, prompt: "CONTROL_CHILD_REUSED. Original directive: retain this exact brief. Later directive: finish the follow-up." });
  if (reused?.status !== "completed" || wire.filter(w => w.marker === "CONTROL_CHILD_SEED").at(-1)?.model !== "grok-4.7") throw new Error("Justified reuse changed the child's model or failed");
  const changedAgent = await control({ sessionID: child.id, agent: "poteto-agent", retainedState: { kind: "checkout", reason: "Required fixture checkout" }, prompt: "CONTROL_CHILD_WRONG_AGENT" });
  if (changedAgent?.status !== "error") throw new Error("Reuse changed the child's agent");
  const foreign = await host.client.session.create({ location: { directory: host.project } });
  const unowned = await control({ sessionID: foreign.id, retainedState: { kind: "checkout", reason: "Required fixture checkout" }, prompt: "CONTROL_CHILD_UNOWNED" });
  if (unowned?.status !== "error") throw new Error("An unrelated session was reused");
  const audit = await control({ role: "arena cross-judge pool", model: "pstack-test/gpt-parent#high", independent: true, prompt: "CONTROL_CHILD_SELF_AUDIT" });
  if (audit?.status !== "error" || !audit.error.message.includes("different model family")) throw new Error("Explicit model bypassed mandatory independent audit");
  const next = await control({ prompt: "CONTROL_CHILD_FRESH_FIX. Consolidated original and later directives." });
  if (next?.status !== "completed" || (await host.client.session.list({ parentID: parent.id, limit: 100 })).data.length !== 2) throw new Error("A normal follow-up did not create a fresh child");
  if (wire.some(w => /INVALID|WRONG_AGENT|UNOWNED|SELF_AUDIT/.test(w.marker))) throw new Error("A rejected control reached the provider");
  writeFileSync(resolve(import.meta.dir, "../provenance/model-failures-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), simultaneousForegroundRefusals: true, simultaneousBackgroundRefusals: true, restoredConfiguredBaselines: true, strictReuseChecked: true, ownedReuseRetainsModelAndAgent: true, normalFollowupIsFresh: true, explicitSelfAuditBlocked: true, wire }, null, 2) + "\n");
  console.log("PASS parallel provider refusals, baseline retries, strict session reuse and independent audit enforcement");
} finally { await host.close(); endpoint.stop(true); }
