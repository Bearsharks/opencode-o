import { connectFixture } from "./criteria-fixture";
import { resolve } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import { testHost, ready } from "./test-host";

const cases = [
  ["feature, refactoring", "grok-4.7"], ["bug-fix", "grok-4.7"], ["perf-issue", "grok-4.7"], ["hillclimb", "grok-4.7"],
  ["judgment and prose", "claude-opus-5-5"], ["hardest tasks", "claude-opus-5-5"], ["how explorer", "grok-4.7"], ["how explainer", "claude-opus-5-5"],
  ["why investigators", "grok-4.7"], ["why synthesizer", "claude-opus-5-5"], ["reflect tooling", "grok-4.7"], ["reflect judgment, divergent, synthesizer", "claude-opus-5-5"],
  ["arena runners", "claude-opus-5-5", 0], ["arena runners", "grok-4.7", 1], ["arena cross-judge pool", "claude-opus-5-5"],
  ["swarm workers", "grok-4.7-fast"], ["architect runners", "claude-opus-5-5", 0], ["architect runners", "grok-4.7", 1],
  ["interrogate reviewers", "claude-opus-5-5", 0], ["interrogate reviewers", "grok-4.7", 1],
] as const;
const wire: { model: string; effort: string; caseIndex: number }[] = [];
let phase = 0;
let schemaVerified = false;
let commentSickoSystemVerified = false;
const potetoSystemVerified = new Set<number>();
let heldRequestStarted!: () => void;
const heldStarted = new Promise<void>(resolve => { heldRequestStarted = resolve; });
const commentSystem = readFileSync(resolve(import.meta.dir, "../agent-templates/comment-sicko.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
let calls = 0;
const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json();
  calls++;
  const childMessage = body.messages.find((message: any) => message.role === "user" && JSON.stringify(message.content).includes("PSTACK_CHILD_CASE_"));
  let delta: any;
  let finish: string;
  if (childMessage) {
    const index = Number(JSON.stringify(childMessage.content).match(/PSTACK_CHILD_CASE_(\d+)/)?.[1]);
    if (index < 4 && JSON.stringify(body.messages.filter((m: any) => m.role === "system")).includes("full agent style") && JSON.stringify(body.messages).includes(resolve(import.meta.dir, "../skills/poteto-mode/SKILL.md"))) potetoSystemVerified.add(index);
    if (cases[index]?.[0] === "judgment and prose") commentSickoSystemVerified = body.messages.some((message: any) => message.role === "system" && (typeof message.content === "string" ? message.content : JSON.stringify(message.content)).includes(commentSystem));
    if (JSON.stringify(body.messages).includes("HOLD ORDER FROM THE PARENT")) { heldRequestStarted(); await Bun.sleep(2000); }
    wire.push({ model: body.model, effort: body.reasoning_effort, caseIndex: index });
    delta = { role: "assistant", content: "CHILD_DONE" }; finish = "stop";
  } else if (phase < 2) {
    const fn = (name: string, args: object, index: number) => ({ index, id: `call_phase_${phase}_${index}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
    delta = { role: "assistant", tool_calls: phase === 0
      ? [fn("pstack_todo", { action: "write", items: ["Ground", "Sketch", "Agree", "Implement", "Scrap"].map((content, i) => ({ id: String(i), content, status: "pending" })) }, 0), fn("pstack_models", { action: "inspect" }, 1)]
      : [fn("pstack_todo", { action: "read" }, 0), fn("subagent", { agent: "general", description: "Invalid call without role", prompt: "PSTACK_CHILD_CASE_999. Return CHILD_DONE only.", background: false }, 1), fn("pstack_models", { action: "resolve", role: "architect runners" }, 2)] };
    finish = "tool_calls"; phase++;
  } else if (phase === 2) {
    phase++;
    const schema = body.tools?.find((tool: any) => tool.function?.name === "subagent")?.function?.parameters;
    schemaVerified = schema?.required?.includes("role") && schema?.properties?.role?.enum?.length === 17;
    delta = { role: "assistant", tool_calls: cases.map(([role, , seat], i) => ({ index: i, id: `call_case_${i}`, type: "function", function: { name: "subagent", arguments: JSON.stringify({ agent: i < 4 ? "poteto-agent" : role === "judgment and prose" ? "comment-sicko" : role === "arena cross-judge pool" || role.startsWith("how ") ? "explore" : "general", description: `Case ${i} native delegation`, role, decision: { onPass: "proceed", onFail: "repair" }, ...(seat !== undefined ? { seat } : {}), verification: role === "swarm workers", background: false, prompt: `PSTACK_CHILD_CASE_${i}. Return CHILD_DONE only.` }) } })) };
    finish = "tool_calls";
  } else { delta = { role: "assistant", content: "PSTACK_ALL_ROLES_DONE" }; finish = "stop"; }
  const chunk = (value: any, reason: string | null) => ({ id: `completion_${calls}`, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason: reason }] });
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, finish))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const host = await testHost({ model: "pstack-test/gpt-parent#high", default_agent: "pstack", agents: { pstack: { mode: "primary" } }, plugins: [
  resolve(import.meta.dir, "../plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1` } },
] });
try {
  await ready(host, "pstack-test-models"); await ready(host, "pstack"); await ready(host, "pstack-test-probe");
  const session = await host.client.session.create({ location: { directory: host.project }, agent: "pstack", model: { providerID: "pstack-test", id: "gpt-parent", variant: "high" } });
  connectFixture(host.project);
  await host.client.session.command({ sessionID: session.id, name: "architect", text: "Exercise the native role delegation tools." });
  await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(60000) });
  const context = await host.client.session.context({ sessionID: session.id });
  const serialized = JSON.stringify(context);
  if (!serialized.includes("# Architect") || !serialized.includes("Exercise the native role delegation tools.")) throw new Error("Slash command lost the skill body or user arguments");
  const tools = context.flatMap((message: any) => message.type === "assistant" ? message.content.filter((part: any) => part.type === "tool") : []);
  const todoRead: any = tools.find((tool: any) => tool.name === "pstack_todo" && tool.state.input.action === "read");
  const content = todoRead?.state.content?.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
  if (todoRead?.state.status !== "completed" || !content?.includes("Ground") || !content?.includes("Scrap")) throw new Error(`Todo read did not return persisted phase list: ${JSON.stringify(todoRead)}`);
  const rejected: any = tools.find((tool: any) => tool.name === "subagent" && tool.state.input.description === "Invalid call without role");
  if (rejected?.state.status !== "error" || !/role/.test(rejected.state.error.message)) throw new Error("Missing-role call was not rejected");
  if (!schemaVerified) throw new Error("Native model did not receive required role schema");
  if (!commentSickoSystemVerified) throw new Error("Comment Sicko's full original instructions did not reach its model request");
  if (potetoSystemVerified.size !== 4) throw new Error("Poteto delegates did not receive the full-style mandate and installed skill path");
  const modelTools: any[] = tools.filter((tool: any) => tool.name === "pstack_models");
  if (modelTools.length !== 2 || modelTools.some(tool => tool.state.status !== "completed")) throw new Error(`Model inspection/resolution tool failed: ${JSON.stringify(modelTools)}`);
  if (wire.length !== cases.length) throw new Error(`Expected ${cases.length} child requests; got ${wire.length}. Context: ${JSON.stringify(context).slice(-12000)}`);
  for (let i = 0; i < cases.length; i++) {
    const observed = wire.filter(w => w.caseIndex === i);
    if (observed.length !== 1 || observed[0].model !== cases[i][1] || observed[0].effort !== "xhigh") throw new Error(`Wrong provider request for ${cases[i][0]}: ${JSON.stringify(observed)}`);
  }
  const initialWire = [...wire];
  const children = (await host.client.session.list({ parentID: session.id, limit: 100 })).data;
  const controlled = children.find(child => child.agent === "poteto-agent")!;
  const supervise = async (action: string, sessionID: string) => {
    const result: any = await host.client.rpc.call({ rpcID: "pstack-test-probe", method: "call", location: { directory: host.project }, input: { tool: "pstack_agents", sessionID: session.id, args: { action, sessionID } } });
    return result.output;
  };
  if ((await supervise("inspect", controlled.id)).output?.running !== false || wire.length !== initialWire.length) throw new Error("Inspect woke an idle child");
  const foreign = await host.client.session.create({ location: { directory: host.project } });
  if (!(await supervise("inspect", foreign.id)).toolError) throw new Error("Supervisor accepted an unowned session");
  const held = await supervise("hold", controlled.id);
  if (held.toolError) throw new Error(held.toolError);
  let holdTimeout: ReturnType<typeof setTimeout>;
  try { await Promise.race([heldStarted, new Promise((_, reject) => { holdTimeout = setTimeout(() => reject(new Error("Hold did not reach the child")), 10000); })]); }
  finally { clearTimeout(holdTimeout!); }
  const stopped = await supervise("stop", controlled.id);
  if (stopped.toolError) throw new Error(stopped.toolError);
  await host.client.session.wait({ sessionID: controlled.id }, { signal: AbortSignal.timeout(15000) });
  if ((await host.client.session.get({ sessionID: controlled.id })).outcome !== "interrupted") throw new Error("Stop did not interrupt the running child");
  writeFileSync(resolve(import.meta.dir, "../provenance/models-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), server: await host.client.server.info(), roles: 17, childRequests: initialWire.length, schemaVerified, commentSickoSystemVerified, potetoSystemVerified: true, inspectWithoutWake: true, unownedSessionRejected: true, holdAndStop: true, todoWriteRead: true, untaggedCallCreatedNoChild: true, wire: initialWire, limits: "Deterministic loopback provider; proves all role calls reach native child execution and provider model/effort requests. Does not prove autonomous model compliance with all skill branches." }, null, 2) + "\n");
  console.log(`PASS 17 roles, ${initialWire.length} native child sessions, both delegate prompts and inspect/hold/stop`);
} finally { await host.close(); endpoint.stop(true); }
