import { mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { testHost, ready } from "./test-host";
const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json();
  const chunk = { id: "history-test", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "Recorded." }, finish_reason: null }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const host = await testHost({ model: "pstack-test/gpt-parent#high", plugins: [resolve(import.meta.dir, "../plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1`, compactionText: "Compacted conversation without the original user wording." } }] });
try {
  for (const [name, autoinvoke] of [["jay-mode", false], ["priya-mode", true]] as const) {
    const folder = resolve(host.project, ".opencode/skills/personal", name); mkdirSync(folder, { recursive: true });
    writeFileSync(resolve(folder, "SKILL.md"), `---\nname: ${name}\ndescription: Personal mode test\nmetadata: {opencode/autoinvoke: ${autoinvoke}}\n---\nUse this personal mode only as configured.\n`);
  }
  await ready(host, "pstack"); await ready(host, "pstack-test-probe"); await ready(host, "pstack-test-models");
  const skills = (await host.client.skill.list({ location: { directory: host.project } })).data;
  if (skills.find(s => s.name === "jay-mode")?.autoinvoke !== false || skills.find(s => s.name === "priya-mode")?.autoinvoke !== true) throw new Error("Generated nested personal mode invocation policies were not honored by native loader");
  const other = resolve(host.directory, "unrelated-project"); mkdirSync(other);
  const local = await host.client.session.create({ location: { directory: host.project } });
  const foreign = await host.client.session.create({ location: { directory: other } });
  await host.client.session.prompt({ sessionID: local.id, text: "LOCAL_HISTORY_EVIDENCE" });
  await host.client.session.prompt({ sessionID: foreign.id, text: "FOREIGN_HISTORY_EVIDENCE" });
  await host.client.session.wait({ sessionID: local.id }, { signal: AbortSignal.timeout(15000) });
  await host.client.session.wait({ sessionID: foreign.id }, { signal: AbortSignal.timeout(15000) });
  await host.client.session.compact({ sessionID: local.id });
  await host.client.session.wait({ sessionID: local.id }, { signal: AbortSignal.timeout(15000) });
  if (JSON.stringify(await host.client.session.context({ sessionID: local.id })).includes("LOCAL_HISTORY_EVIDENCE")) throw new Error("Fixture did not remove the original message from compacted context");
  const call = (args: object) => host.client.rpc.call({ rpcID: "pstack-test-probe", method: "call", location: { directory: host.project }, input: { tool: "pstack_history", sessionID: local.id, args } });
  const listed: any = await call({ action: "list" });
  const ids = listed.output.output.sessions.map((s: any) => s.id);
  if (!ids.includes(local.id) || ids.includes(foreign.id)) throw new Error(`Workspace-scoped list incorrect: ${JSON.stringify(listed)}`);
  const read: any = await call({ action: "read", sessionID: local.id });
  if (!JSON.stringify(read).includes("LOCAL_HISTORY_EVIDENCE")) throw new Error("History did not return stored user message");
  const current: any = await call({ action: "current" });
  if (current.output.output.session.id !== local.id) throw new Error("Current transcript identification failed");
  const found: any = await call({ action: "search", sessionID: local.id, query: "local_history_evidence" });
  if (found.output.output.messages.length !== 1) throw new Error("Literal topic search returned the wrong regions");
  const exported: any = await call({ action: "export", sessionID: local.id });
  const exportedPath = exported.output.output.path;
  if (!readFileSync(exportedPath, "utf8").includes("LOCAL_HISTORY_EVIDENCE") || (statSync(exportedPath).mode & 0o777) !== 0o600) throw new Error("Private full transcript export failed");
  rmSync(dirname(exportedPath), { recursive: true });
  const refused: any = await call({ action: "read", sessionID: foreign.id });
  if (!/outside the active workspace/.test(refused.output.toolError ?? "")) throw new Error(`Cross-workspace session read was not refused: ${JSON.stringify(refused)}`);
  writeFileSync(resolve(import.meta.dir, "../provenance/history-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), server: await host.client.server.info(), scopedList: true, actualMessageRead: true, currentChatIdentified: true, topicSearch: true, privateFullExport: true, fullHistoryAfterCompaction: true, foreignWorkspaceRefused: true, nestedPersonalModeExplicitOnly: true, personalModeOptIn: true }, null, 2) + "\n");
  console.log("PASS workspace history list/read and rejection of unrelated-project reads");
} finally { await host.close(); endpoint.stop(true); }
