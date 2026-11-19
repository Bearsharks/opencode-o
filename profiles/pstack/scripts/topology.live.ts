import { connectFixture } from "./criteria-fixture";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { testHost, ready } from "./test-host";
const seen = new Set<string>();
let nestedSchema = false;
const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json();
  const user = body.messages.filter((m: any) => m.role === "user").map((m: any) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
  const level = user.includes("TOPOLOGY_EXPLAINER") ? "explainer" : user.includes("TOPOLOGY_REVIEWER") ? "reviewer" : user.includes("TOPOLOGY_WORKER") ? "worker" : user.includes("TOPOLOGY_MANAGER") ? "manager" : "root";
  if(level!=="root" && !user.includes("작업 기준: docs/tasks/fixture.md"))
    throw new Error("Nested delegation lost the repository criteria: "+level);
  seen.add(level);
  const hasResult = body.messages.some((m: any) => m.role === "tool");
  if (level === "manager") nestedSchema ||= body.tools?.some((t: any) => t.function?.name === "subagent") ?? false;
  const call = level !== "explainer" && !hasResult;
  const next: any = { root: ["general", "hardest tasks", "MANAGER"], manager: ["poteto-agent", "feature, refactoring", "WORKER"], worker: ["comment-sicko", "judgment and prose", "REVIEWER"], reviewer: ["explore", "how explainer", "EXPLAINER"] };
  const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${level}`, type: "function", function: { name: "subagent", arguments: JSON.stringify({ agent: next[level][0], role: next[level][1], ...(level === "root" ? {decision: { onPass: "proceed", onFail: "repair" }, } : {}), description: `Topology ${level} delegation`, prompt: `TOPOLOGY_${next[level][2]}. Complete your assigned part.`, background: false }) } }] } : { role: "assistant", content: `${level.toUpperCase()}_DONE` };
  const chunk = { id: `topology_${level}`, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const profile = JSON.parse(readFileSync(resolve(import.meta.dir, "../opencode.jsonc"), "utf8"));
const checkDepthGate = process.argv.includes("--check-depth-gate");
if (checkDepthGate) profile.experimental = { ...profile.experimental, subagent_depth: 1 };
const host = await testHost({ ...profile, model: "pstack-test/gpt-parent#high", plugins: [resolve(import.meta.dir, "../plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1` } }] });
try {
  for (const id of ["pstack", "pstack-test-models", "pstack-test-probe"]) await ready(host, id);
  const root = await host.client.session.create({ location: { directory: host.project }, agent: "pstack" });
  connectFixture(host.project);
  await host.client.session.prompt({ sessionID: root.id, text: "TOPOLOGY_ROOT. Delegate a manager." });
  await host.client.session.wait({ sessionID: root.id }, { signal: AbortSignal.timeout(30000) });
  const managers = (await host.client.session.list({ parentID: root.id })).data;
  const workers = managers.length ? (await host.client.session.list({ parentID: managers[0].id })).data : [];
  const reviewers = workers.length ? (await host.client.session.list({ parentID: workers[0].id })).data : [];
  const explainers = reviewers.length ? (await host.client.session.list({ parentID: reviewers[0].id })).data : [];
  if (checkDepthGate) {
    if (seen.has("worker")) throw new Error("subagent_depth did not limit nested execution");
    console.log("PASS native depth limit blocks manager delegation at depth 1");
  } else {
  if (!nestedSchema || !seen.has("explainer") || managers.length !== 1 || workers.length !== 1 || reviewers.length !== 1 || explainers.length !== 1) {
    const context = managers.length ? await host.client.session.context({ sessionID: managers[0].id }) : await host.client.session.context({ sessionID: root.id });
    throw new Error(`Three-level topology did not execute: ${JSON.stringify({ seen: [...seen], nestedSchema, context }).slice(-6000)}`);
  }
  const result: any = await host.client.rpc.call({ rpcID: "pstack-test-probe", method: "call", location: { directory: host.project }, input: { tool: "pstack_agents", sessionID: root.id, args: { action: "inspect", sessionID: workers[0].id } } });
  if (result.output.output?.session.id !== workers[0].id) throw new Error("Root could not inspect its grandchild");
  writeFileSync(resolve(import.meta.dir, "../provenance/topology-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), server: await host.client.server.info(), rootManagerWorker: true, managerCanDelegate: true, rootCanInspectGrandchild: true, workerReviewAndInvestigation: true, workerAgent: workers[0].agent, limits: "Three local program levels plus review/investigation helper calls, using a loopback model. VM isolation and a large fleet are separate prerequisites, not claimed by this test." }, null, 2) + "\n");
  console.log("PASS three program levels, worker review/investigation calls and grandchild supervision");
  }
} finally { await host.close(); endpoint.stop(true); }
