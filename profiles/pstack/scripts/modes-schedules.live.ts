import { resolve } from "node:path";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { testHost, ready } from "./test-host";

const requests: any[] = [];
const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json(); requests.push(body);
  const chunk = { id: "mode-schedule-test", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const config = { model: "pstack-test/gpt-parent#high", agents: { pstack: { mode: "primary" } }, default_agent: "pstack", plugins: [resolve(import.meta.dir, "../plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1`, compactionText: "Compacted fixture conversation." } }] };
let host = await testHost(config, { preserve: true });
const directory = host.directory;
const body = readFileSync(resolve(import.meta.dir, "../skills/bro/SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
try {
  async function activate() { for (const name of ["pstack", "pstack-test-models", "pstack-test-probe"]) await ready(host, name); }
  await activate();
  const owner = await host.client.session.create({ location: { directory: host.project }, agent: "pstack" });
  const call = async (tool: string, args: object, sessionID = owner.id) => {
    const result: any = await host.client.rpc.call({ rpcID: "pstack-test-probe", method: "call", location: { directory: host.project }, input: { tool, sessionID, args } });
    if (result.output.toolError) throw new Error(result.output.toolError);
    return result.output.output;
  };
  const wait = (sessionID = owner.id) => host.client.session.wait({ sessionID }, { signal: AbortSignal.timeout(15000) });
  const assertMode = (expected: boolean) => {
    const system = requests.at(-1)?.messages.filter((m: any) => m.role === "system").map((m: any) => m.content).join("\n") ?? "";
    if (system.includes(body) !== expected) throw new Error(`Persistent mode expected=${expected} but provider system differs: ${system.slice(Math.max(0, system.indexOf(body) - 200), system.indexOf(body) + body.length + 150)}`);
  };
  await host.client.session.command({ sessionID: owner.id, name: "pstack-mode", text: "on bro" }); await wait(); assertMode(true);
  await host.client.session.prompt({ sessionID: owner.id, text: "SECOND_TURN" }); await wait(); assertMode(true);
  await host.client.session.compact({ sessionID: owner.id }); await wait();
  await host.client.session.prompt({ sessionID: owner.id, text: "AFTER_COMPACTION" }); await wait(); assertMode(true);
  const timer = await call("pstack_schedule", { action: "create", prompt: "RESTART_TIMER_MARKER", delayMs: 1500 });
  const todo = [{ id: "one", content: "Retain this phase across restart", status: "pending" }];
  await call("pstack_todo", { action: "write", items: todo });
  await host.close();
  await Bun.sleep(1600);
  host = await testHost(config, { directory }); await activate();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const jobs = (await call("pstack_schedule", { action: "list" })).jobs;
    if (jobs.find((j: any) => j.id === timer.job.id)?.fires === 1) break;
    await Bun.sleep(50);
  }
  await wait(); assertMode(true);
  const restarted = (await call("pstack_schedule", { action: "list" })).jobs.find((j: any) => j.id === timer.job.id);
  if (restarted?.fires !== 1 || restarted.status !== "completed") throw new Error("Overdue one-shot was not delivered exactly once on restart");
  const readTodo = await call("pstack_todo", { action: "read" });
  if (JSON.stringify(readTodo.items) !== JSON.stringify(todo)) throw new Error("Todo list was lost on process restart");
  await host.client.session.command({ sessionID: owner.id, name: "pstack-mode", text: "off" }); await wait();
  if ((await host.client.session.instructions.entry.list({ sessionID: owner.id })).some(entry => entry.key === "pstack-mode")) throw new Error("Mode entry remains active after off");
  // OpenCode preserves cached history and sends an explicit retraction until compaction.
  if (!JSON.stringify(requests.at(-1).messages).includes('no longer applies. Disregard it.')) throw new Error("Native mode retraction did not reach the model");
  await host.client.session.compact({ sessionID: owner.id }); await wait();
  await host.client.session.prompt({ sessionID: owner.id, text: "AFTER_MODE_OFF" }); await wait(); assertMode(false);
  const source = await host.client.session.create({ location: { directory: host.project } });
  const eventJob = await call("pstack_schedule", { action: "create", prompt: "EVENT_WAKE_MARKER", event: { type: "session.execution.succeeded", sessionID: source.id } });
  await host.client.session.prompt({ sessionID: source.id, text: "Finish this source event" }); await wait(source.id);
  const eventDeadline = Date.now() + 8000;
  let fired = false;
  while (Date.now() < eventDeadline) {
    const job = (await call("pstack_schedule", { action: "list" })).jobs.find((j: any) => j.id === eventJob.job.id);
    if (job?.fires >= 1) { fired = true; break; }
    await Bun.sleep(50);
  }
  if (!fired) throw new Error("Native session event did not wake the owner");
  await call("pstack_schedule", { action: "cancel", id: eventJob.job.id }); await wait();
  await host.client.session.command({ sessionID: owner.id, name: "loop", text: "1s FIXED_LOOP_MARKER" }); await wait();
  await Bun.sleep(1200); await wait();
  const beforeStop = (await call("pstack_schedule", { action: "list" })).jobs.find((j: any) => j.prompt === "FIXED_LOOP_MARKER");
  if (!beforeStop || beforeStop.fires < 1) throw new Error("Fixed /loop did not fire");
  await host.client.session.command({ sessionID: owner.id, name: "loop", text: "stop" }); await wait();
  const stopped = (await call("pstack_schedule", { action: "list" })).jobs.find((j: any) => j.id === beforeStop.id);
  await Bun.sleep(1200);
  const afterStop = (await call("pstack_schedule", { action: "list" })).jobs.find((j: any) => j.id === beforeStop.id);
  if (afterStop.status !== "cancelled" || afterStop.fires !== stopped.fires) throw new Error("Cancelled loop continued firing");
  const delivered = JSON.stringify(requests.map(request => request.messages));
  if (!delivered.includes("RESTART_TIMER_MARKER") || !delivered.includes("EVENT_WAKE_MARKER")) throw new Error("Scheduled prompts did not reach the provider requests");
  writeFileSync(resolve(import.meta.dir, "../provenance/modes-schedules-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), server: await host.client.server.info(), modeAcrossTurns: true, modeAcrossCompaction: true, modeAcrossRestart: true, modeOff: true, todoAcrossRestart: true, overdueOneShot: true, nativeEventWake: true, fixedLoop: true, stopCancelsFutureWakes: true, limits: "Deterministic loopback model. Fixed timers, a native session event and restart are exercised; external-service event delivery and crash-at-every-instruction exactly-once semantics are not claimed." }, null, 2) + "\n");
  console.log("PASS persistent mode, compaction, restart, todo recovery, timers, native event wake and /loop stop");
} finally { await host.close(); endpoint.stop(true); rmSync(directory, { recursive: true, force: true }); }
