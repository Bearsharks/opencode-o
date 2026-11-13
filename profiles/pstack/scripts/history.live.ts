import { mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { testHost, ready } from "./test-host";
let nativeSearchIssued = false;
const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json();
  if (!nativeSearchIssued && JSON.stringify(body.messages).includes("NATIVE_SCOPE_SEARCH")) {
    nativeSearchIssued = true;
    const tool = body.tools.find((t: any) => t.function?.name === "pstack_history");
    if (!tool?.function.parameters.properties.sessionID.description.includes("Optional for search")) throw new Error("Model received ambiguous search schema");
    const delta = { role: "assistant", tool_calls: [{ index: 0, id: "history_native", type: "function", function: { name: "pstack_history", arguments: JSON.stringify({ action: "search", repositoryHistory: true, query: "LOCAL_HISTORY_EVIDENCE", limit: 100 }) } }] };
    const chunk = (d: any, f: string | null) => ({ id: "history-native", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: d, finish_reason: f }] });
    return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, "tool_calls"))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  }
  const chunk = { id: "history-test", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "Recorded." }, finish_reason: null }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const host = await testHost({ model: "pstack-test/gpt-parent#high", plugins: [resolve(import.meta.dir, "../plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1`, compactionText: "Compacted conversation without the original user wording." } }] });
try {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: host.project, stdio: "pipe" });
  git("init"); writeFileSync(resolve(host.project, "seed"), "history fixture"); git("add", "seed");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  const relatedPath = resolve(host.directory, "related-worktree");
  git("worktree", "add", "--detach", relatedPath, "HEAD");
  for (const [name, autoinvoke] of [["jay-mode", false], ["priya-mode", true]] as const) {
    const folder = resolve(host.project, ".opencode/skills/personal", name); mkdirSync(folder, { recursive: true });
    writeFileSync(resolve(folder, "SKILL.md"), `---\nname: ${name}\ndescription: Personal mode test\nmetadata: {opencode/autoinvoke: ${autoinvoke}}\n---\nUse this personal mode only as configured.\n`);
  }
  await ready(host, "pstack"); await ready(host, "pstack-test-probe"); await ready(host, "pstack-test-models");
  const connectedServer = await host.client.server.info();
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
  if (found.output.output.matches.length !== 1) throw new Error("Literal topic search returned the wrong regions");
  const sibling = await host.client.session.create({ location: { directory: relatedPath } });
  for (const id of [local.id, sibling.id, foreign.id]) {
    await host.client.session.prompt({ sessionID: id, text: "컴팩션 compaction 덮어 HISTORY_SCOPE_MATCH" });
    await host.client.session.wait({ sessionID: id }, { signal: AbortSignal.timeout(15000) });
    await host.client.session.prompt({ sessionID: id, text: "Second HISTORY_SCOPE_MATCH" });
    await host.client.session.wait({ sessionID: id }, { signal: AbortSignal.timeout(15000) });
  }
  async function searchAll(args: object) {
    const matches: any[] = []; let cursor: string | null = null; let iterations = 0;
    do {
      const reply: any = await call({ action: "search", ...args, ...(cursor ? { cursor } : {}) });
      if (reply.output.toolError) throw new Error(reply.output.toolError);
      const page = reply.output.output;
      if (page.source.serverPID !== connectedServer.pid || page.source.version !== connectedServer.version || page.source.configuredDatabase !== "pstack-native-test.db" || page.source.otherDatabasesSearched !== false || page.complete !== (page.cursor === null)) throw new Error("Missing search scope/completeness contract");
      matches.push(...page.matches); cursor = page.cursor;
      if (++iterations > 100) throw new Error("Search failed to advance");
    } while (cursor);
    if (new Set(matches.map(m => m.message.id)).size !== matches.length) throw new Error("Search duplicated messages across pages");
    return matches;
  }
  const workspaceMatches = await searchAll({ query: "HISTORY_SCOPE_MATCH", limit: 1 });
  if (workspaceMatches.length !== 2 || workspaceMatches.some(m => m.sessionID !== local.id)) throw new Error(`Workspace search lost or leaked messages: ${JSON.stringify(workspaceMatches)}`);
  const repositoryMatches = await searchAll({ repositoryHistory: true, query: "HISTORY_SCOPE_MATCH", limit: 1 });
  if (repositoryMatches.length !== 4 || repositoryMatches.some(m => m.sessionID === foreign.id) || !repositoryMatches.some(m => m.sessionID === sibling.id)) throw new Error("Repository search omitted a worktree or leaked another project");
  for (const query of ["컴팩션", "compaction", "덮어"]) {
    const matches = await searchAll({ repositoryHistory: true, query, limit: 100 });
    if (!matches.some(m => m.sessionID === local.id) || !matches.some(m => m.sessionID === sibling.id) || matches.some(m => m.sessionID === foreign.id)) throw new Error(`Original no-session query failed: ${query}`);
  }
  for (let i = 0; i < 51; i++) {
    await host.client.session.prompt({ sessionID: local.id, text: `Padding ${i}` });
    await host.client.session.wait({ sessionID: local.id }, { signal: AbortSignal.timeout(15000) });
  }
  await host.client.session.prompt({ sessionID: local.id, text: "HISTORY_TAIL_ONLY" });
  await host.client.session.wait({ sessionID: local.id }, { signal: AbortSignal.timeout(15000) });
  if ((await searchAll({ sessionID: local.id, query: "HISTORY_TAIL_ONLY", limit: 1 })).length !== 1) throw new Error("Search stopped at the first raw message page");
  const singleton = await searchAll({ sessionID: local.id, query: "HISTORY_SCOPE_MATCH", limit: 1 });
  if (singleton.length !== 2) throw new Error("Single-session matching pagination failed");
  const first: any = await call({ action: "search", query: "HISTORY_SCOPE_MATCH", limit: 1 });
  const mixed: any = await call({ action: "search", repositoryHistory: true, query: "HISTORY_SCOPE_MATCH", cursor: first.output.output.cursor });
  if (!mixed.output.toolError?.includes("scope/query")) throw new Error("Cursor accepted a changed search scope");
  const changedQuery: any = await call({ action: "search", query: "different", cursor: first.output.output.cursor });
  if (!changedQuery.output.toolError?.includes("scope/query")) throw new Error("Cursor accepted a changed query");
  const invalidCursor: any = await call({ action: "search", query: "HISTORY", cursor: "hs_00000000-0000-0000-0000-000000000000" });
  if (!invalidCursor.output.toolError?.includes("expired")) throw new Error("Unknown search cursor was accepted");
  const missingRead: any = await call({ action: "read" });
  if (!missingRead.output.toolError?.includes("sessionID")) throw new Error("Read lost its required-session guard");
  const missing: any = await call({ action: "search" });
  if (!missing.output.toolError?.includes("query")) throw new Error("Missing query diagnostic failed");
  const wrongSession: any = await call({ action: "search", sessionID: foreign.id, query: "HISTORY" });
  if (!wrongSession.output.toolError?.includes("outside")) throw new Error("Explicit search leaked another workspace");
  for (let i = 0; i < 22; i++) await host.client.session.create({ location: { directory: host.project } });
  const empty: any = await call({ action: "search", query: "LOCAL_HISTORY_EVIDENCE" });
  if (!empty.output.output.cursor || empty.output.output.matches.length) throw new Error("Fixture did not reach an empty bounded scan page");
  if ((await searchAll({ query: "LOCAL_HISTORY_EVIDENCE" })).length !== 1) throw new Error("Empty-page continuation lost pre-compaction history");
  const exported: any = await call({ action: "export", sessionID: local.id });
  const exportedPath = exported.output.output.path;
  if (!readFileSync(exportedPath, "utf8").includes("LOCAL_HISTORY_EVIDENCE") || (statSync(exportedPath).mode & 0o777) !== 0o600) throw new Error("Private full transcript export failed");
  rmSync(dirname(exportedPath), { recursive: true });
  const refused: any = await call({ action: "read", sessionID: foreign.id });
  if (!/outside the active workspace/.test(refused.output.toolError ?? "")) throw new Error(`Cross-workspace session read was not refused: ${JSON.stringify(refused)}`);
  await host.client.session.prompt({ sessionID: local.id, text: "NATIVE_SCOPE_SEARCH" });
  await host.client.session.wait({ sessionID: local.id }, { signal: AbortSignal.timeout(30000) });
  const context: any[] = await host.client.session.context({ sessionID: local.id });
  const searchCall = context.flatMap(m => m.type === "assistant" ? m.content.filter((p: any) => p.type === "tool") : []).find(t => t.name === "pstack_history");
  if (!nativeSearchIssued || searchCall?.state.status !== "completed" || searchCall.state.input.sessionID) throw new Error("Native no-session tool invocation failed");
  writeFileSync(resolve(import.meta.dir, "../provenance/history-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), server: await host.client.server.info(), scopedList: true, actualMessageRead: true, currentChatIdentified: true, topicSearch: true, nativeNoSessionInvocation: true, searchBeyondFirstMessagePage: true, multiSessionSearch: true, repositorySearch: true, matchingPagination: true, emptyScanContinuation: true, cursorScopeBinding: true, originalNoSessionQueries: true, privateFullExport: true, fullHistoryAfterCompaction: true, foreignWorkspaceRefused: true, nestedPersonalModeExplicitOnly: true, personalModeOptIn: true }, null, 2) + "\n");
  console.log("PASS scoped multi-session/repository search, matching pagination, empty continuation, pre-compaction messages and cross-project rejection");
} finally { await host.close(); endpoint.stop(true); }
