import { resolve } from "node:path";
import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { testHost, ready } from "./test-host";

const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json();
  const chunk = { id: "core-fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "Recorded." }, finish_reason: null }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const host = await testHost({ model: "pstack-test/gpt-parent#high", plugins: [resolve(import.meta.dir, "../plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1` } }] });
try {
  const fixtureBin = resolve(host.directory, "fixture-bin"); mkdirSync(fixtureBin);
  for (const name of ["gh", "origin"]) writeFileSync(resolve(fixtureBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  async function command(args: string[]) {
    const run = host.run(args, { PATH: `${fixtureBin}:${process.env.PATH}` }); const output = await new Response(run.stdout).text(), error = await new Response(run.stderr).text();
    if (await run.exited !== 0) throw new Error(`${args[0]} failed: ${error}`);
    return output;
  }
  const git = (...args: string[]) => command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args]);
  await git("init", "-b", "main");
  writeFileSync(resolve(host.project, "source.txt"), "fixture\n");
  await git("add", "source.txt"); await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  const used = resolve(host.directory, "topic [1]");
  const unused = resolve(host.directory, "topic [1]-other");
  await git("worktree", "add", "-b", "used", used); await git("worktree", "add", "-b", "unused", unused);
  await ready(host, "pstack"); await ready(host, "pstack-test-probe"); await ready(host, "pstack-test-models");
  const root = await host.client.session.create({ location: { directory: host.project } });
  const worker = await host.client.session.create({ location: { directory: used }, metadata: { pinned: true } });
  const elsewhere = resolve(host.directory, "unrelated"); mkdirSync(elsewhere);
  const foreign = await host.client.session.create({ location: { directory: elsewhere } });
  const call = async (directory: string, sessionID: string, tool: string, args: object) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const list = (await host.client.plugin.list({ location: { directory } })).data;
      if (["pstack", "pstack-test-probe"].every(id => list.some(p => p.id === id && p.state.status === "active"))) break;
      await Bun.sleep(25);
    }
    const result: any = await host.client.rpc.call({ rpcID: "pstack-test-probe", method: "call", location: { directory }, input: { tool, sessionID, args } });
    return result.output;
  };
  const subscription = await call(host.project, root.id, "pstack_schedule", { action: "create", prompt: "PROGRAM_CHANGED_WAKE", event: { type: "rpc.pstack-project.changed", match: { program: "migration", key: "owner" } } });
  const put = await call(realpathSync(host.project), root.id, "pstack_project", { action: "put", program: "migration", key: "owner", value: "root", expectedRevision: 0 });
  if (put.output?.record.revision !== 1) throw new Error(`Project put failed: ${JSON.stringify(put)}`);
  let programEvent = false;
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const state = await call(host.project, root.id, "pstack_schedule", { action: "list" });
    if (state.output.jobs.find((j: any) => j.id === subscription.output.job.id)?.fires === 1) { programEvent = true; break; }
    await Bun.sleep(50);
  }
  if (!programEvent) throw new Error("Project store changes did not deliver the native subscription wake");
  await call(host.project, root.id, "pstack_schedule", { action: "cancel", id: subscription.output.job.id });
  await host.client.session.wait({ sessionID: root.id });
  const isolated = await call(elsewhere, foreign.id, "pstack_project", { action: "get", program: "migration", key: "owner" });
  if (isolated.output?.record !== null) throw new Error("Program state leaked across workspaces");
  const shared = await call(used, worker.id, "pstack_project", { action: "get", root: host.project, program: "migration", key: "owner" });
  if (shared.output?.record.value !== "root") throw new Error(`Worker could not read coordinator store: ${JSON.stringify(shared)}`);
  const race = await Promise.all(["A", "B"].map((value, i) => call(i ? realpathSync(host.project) : host.project, root.id, "pstack_project", { action: "put", program: "migration", key: "owner", value, expectedRevision: 1 })));
  if (race.filter(r => r.output?.record.revision === 2).length !== 1 || race.filter(r => /Stale/.test(r.toolError ?? "")).length !== 1) throw new Error("Concurrent project writes did not reject the stale update");
  const timer = await call(host.project, root.id, "pstack_schedule", { action: "create", prompt: "MULTI_WORKSPACE_TIMER", delayMs: 500 });
  const laterDirectory = resolve(host.directory, "later-workspace"); mkdirSync(laterDirectory);
  const later = await host.client.session.create({ location: { directory: laterDirectory } });
  await call(laterDirectory, later.id, "pstack_schedule", { action: "list" });
  await Bun.sleep(800); await host.client.session.wait({ sessionID: root.id });
  const delivered = (await host.client.message.list({ sessionID: root.id, limit: 100 })).data;
  if (delivered.filter((m: any) => m.type === "synthetic" && m.text.includes("MULTI_WORKSPACE_TIMER")).length !== 1) throw new Error("A second workspace duplicated the timer dispatcher");
  await host.client.session.move({ sessionID: root.id, directory: used });
  const movedJobs = await call(used, root.id, "pstack_schedule", { action: "list" });
  if (!movedJobs.output?.jobs.some((job: any) => job.id === timer.output.job.id)) throw new Error("Moving a session lost ownership of its schedules");
  await host.client.session.move({ sessionID: root.id, directory: host.project });
  await host.client.session.prompt({ sessionID: root.id, text: `Work happened at '${used}' only.` });
  await host.client.session.prompt({ sessionID: worker.id, text: "WORKTREE_MESSAGE" });
  await host.client.session.wait({ sessionID: root.id }); await host.client.session.wait({ sessionID: worker.id });
  const transcript = await call(host.project, root.id, "pstack_history", { action: "read", sessionID: worker.id, relatedWorktrees: true });
  if (!JSON.stringify(transcript).includes("WORKTREE_MESSAGE")) throw new Error(`Related-worktree transcript missing: ${JSON.stringify(transcript)}`);
  const denied = await call(host.project, root.id, "pstack_history", { action: "read", sessionID: foreign.id, relatedWorktrees: true });
  if (!/outside/.test(denied.toolError ?? "")) throw new Error("Related-worktree option allowed an unrelated project");
  const usage = JSON.parse(await command(["bun", resolve(import.meta.dir, "worktree-usage.ts"), host.project]));
  const usedEntry = Object.entries(usage.worktrees).find(([path]) => path.endsWith("/topic [1]"))?.[1] as any;
  const otherEntry = Object.entries(usage.worktrees).find(([path]) => path.endsWith("/topic [1]-other"))?.[1] as any;
  if (!usage.complete || !usedEntry?.pinned || !usedEntry.sessions.includes(root.id) || otherEntry?.lastTs !== 0) throw new Error(`Worktree usage/path matching incorrect: ${JSON.stringify(usage)}`);
  const output = await command(["bash", resolve(import.meta.dir, "../skills/poteto-mode/scripts/worktree-audit.sh"), "-b", "HEAD", host.project]);
  const usedRow = output.split("\n").find(line => line.endsWith("/topic [1]"));
  const unusedRow = output.split("\n").find(line => line.endsWith("/topic [1]-other"));
  if (!usedRow?.includes("hold-active-chat") || !unusedRow?.includes("\tsafe\t")) throw new Error(`Native worktree audit failed:\n${output}`);
  // Only the disposable fixture is removed, to prove historical coverage survives retirement.
  await git("worktree", "remove", "--force", used);
  const retired = await call(host.project, root.id, "pstack_history", { action: "read", sessionID: worker.id, repositoryHistory: true });
  if (!JSON.stringify(retired).includes("WORKTREE_MESSAGE")) throw new Error("Retired worktree history was lost");
  const privateScope = await call(host.project, root.id, "pstack_history", { action: "read", sessionID: foreign.id, repositoryHistory: true });
  if (!/outside/.test(privateScope.toolError ?? "")) throw new Error("Repository history read an unrelated project");
  const agents = (await host.client.agent.list({ location: { directory: host.project } })).data;
  const agent = agents.find(a => a.id === "poteto-agent");
  if (agent?.mode !== "subagent" || !agent.system?.includes(resolve(import.meta.dir, "../skills/poteto-mode/SKILL.md")) || agent.system.includes("@PSTACK_MODE_FILE@")) throw new Error("Poteto delegate path binding failed");
  writeFileSync(resolve(import.meta.dir, "../provenance/core-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), server: await host.client.server.info(), programPersistence: true, nativeProgramChangeWake: true, internalWakesAreSynthetic: true, workspaceIsolation: true, sharedCoordinatorStore: true, staleWriteRejected: true, singleTimerDispatcherAcrossWorkspaces: true, scheduleOwnershipSurvivesMove: true, relatedWorktreeHistory: true, unrelatedProjectDenied: true, exactPathMatching: true, pinnedWorktreeHeld: true, unusedMergedWorktreeClassified: true, potetoAgentBound: true, limits: "Temporary local Git repository and native OpenCode service. No real worktree deletion, PR mutation or VM execution." }, null, 2) + "\n");
  console.log("PASS program store, cross-worktree sharing, history boundaries, real worktree audit and delegate registration");
} finally { await host.close(); endpoint.stop(true); }
