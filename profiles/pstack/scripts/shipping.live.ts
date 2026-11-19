import { releaseMerged } from "../plugins/pstack/criteria";
import { connectFixture, fixtureGit } from "./criteria-fixture";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, request as forward } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ready, testHost } from "./test-host";

const root = resolve(import.meta.dir, "..");
let firstHead = "",
  fixedHead = "",
  bHead = "";
const tmp = mkdtempSync(resolve(tmpdir(), "pstack-shipping-"));
const log = resolve(tmp, "commands");
const merge = () =>
  `gh pr merge https://github.invalid/fixture/project/pull/3 --squash --match-head-commit ${fixedHead || firstHead}`;
writeFileSync(
  resolve(tmp, "gh"),
  `#!/usr/bin/env node
const fs=require("node:fs"),cp=require("node:child_process");
const args=process.argv.slice(2), [group,cmd,id]=args;
const pr=String(id).split("/").at(-1), file=${JSON.stringify(tmp)}+"/pr-"+pr+".json";
if(group!=="pr" || !["view","comment","merge"].includes(cmd))process.exit(2);
const obj=JSON.parse(fs.readFileSync(file,"utf8"));
fs.appendFileSync(${JSON.stringify(log)},args.join(" ")+"\\n");
if(cmd==="view") console.log(JSON.stringify(obj));
if(cmd==="comment") console.log("fixture review published");
if(cmd==="merge"){
 if(!args.includes("--squash") || args[args.indexOf("--match-head-commit")+1]!==obj.headRefOid || obj.state!=="OPEN")process.exit(3);
 const git=(...a)=>cp.execFileSync("git",["-c","user.name=Fixture","-c","user.email=fixture@localhost","-c","commit.gpgsign=false",...a],{cwd:${JSON.stringify(tmp)}+"/dev",encoding:"utf8"}).trim();
 git("merge","--squash",obj.headRefOid);git("commit","-qm","Land fixture PR "+pr);
 obj.state="MERGED";obj.mergeCommit={oid:git("rev-parse","HEAD")};fs.writeFileSync(file,JSON.stringify(obj));console.log("fixture merged");
}
`,
  { mode: 0o755 },
);
const structureDelivered = Promise.withResolvers<void>();
const releaseBehavior = Promise.withResolvers<void>();
const shippingRequests = new Set<string>();
const reviewRoots = new Map<string, string>();
function createReview(user: string, task: string, sha: string) {
  const root = /Git 검수 워크트리가 필요할 때만 (.+?)\/<전체-SHA>/.exec(user)?.[1];
  assert.ok(root, "Missing Shipping worktree location in reviewer brief");
  const path = resolve(root, sha + "-structure");
  reviewRoots.set(task, root);
  // The test uses its private temp directory and verifies quoting before forming a shell command.
  assert.ok(!path.includes("'"));
  return "git worktree add --detach '" + path + "' " + sha;
}
let docPathA = "";
let initialBase = "";
const limitHeads: string[] = [];
let cancelTarget = "";
let limitReviews = 0;
let blockRepair = false;
let advanceBaseBeforeMerge: (() => void) | undefined;
const continuation = "PR 4: 실패 원인을 다시 조사하고 재작업을 계속해.";
const comment = (verdict: string, base = "", head = "") =>
  `gh pr comment 3 --body "기준: ${docPathA} ${base} ${head} ${verdict === "PASS" ? "Changed A criterion" : "Immediate entry"} | 관찰: fixture evidence | 판정: ${verdict}"`;
const cancelWaitOpen = Promise.withResolvers<() => void>();
let cancelAttempts = 0;
const endpoint = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const body = await request.json();
    const last = body.messages.findLastIndex((m: any) => m.role === "user");
    const user = JSON.stringify(body.messages[last].content);
    if (body.model === "gpt-6.2-sol") {
      const agent =
        user.includes("REVIEW_LANE structure") || user.includes("B_REVIEW structure")
          ? "structure"
          : user.includes("REVIEW_LANE behavior") || user.includes("B_REVIEW behavior")
            ? "behavior"
            : "shipping";
      shippingRequests.add(agent + ":" + body.reasoning_effort);
    }
    const tools = body.messages.slice(last + 1).filter((m: any) => m.role === "tool");
    const isFixed = !!fixedHead && user.includes(fixedHead);
    const call = (name: string, args: object, index = 0) => ({
      index,
      id: `call_${name}_${index}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
    let calls: any[] = [];
    let answer = "";
    if (user.includes("CONTEXT_PROBE")) {
      const sys = body.messages
        .filter((m: any) => m.role === "system")
        .map((m: any) => JSON.stringify(m.content))
        .join("\n");
      answer = sys.includes("작업 기준: docs/tasks/B.md")
        ? "B"
        : sys.includes("작업 기준: docs/tasks/A.md")
          ? "A"
          : "none";
    } else if (user.includes("IMPL_RUN")) {
      const isB = user.includes("IMPL_RUN B"),
        path = isB ? "docs/tasks/B.md" : "docs/tasks/A.md";
      assert.ok(user.includes(path) && !user.includes(isB ? "docs/tasks/A.md" : "docs/tasks/B.md"));

      if (!tools.length) calls = [call("read", { path })];
      else answer = JSON.stringify(tools[0].content);
    } else if (user.includes("B_REVIEW")) {
      assert.ok(user.includes("docs/tasks/B.md") && !user.includes("docs/tasks/A.md"));
      if (!tools.length) calls = [call("shell", { command: "git show " + bHead + ":docs/tasks/B.md" })];
      else if (user.includes("B_REVIEW structure") && tools.length === 1) {
        calls = [call("shell", { command: createReview(user, "B", bHead) })];
      } else answer = "PASS B result " + JSON.stringify(tools[0].content);
    } else if (user.includes("B_SHIP")) {
      assert.ok(user.includes("docs/tasks/B.md") && !user.includes("docs/tasks/A.md"));
      if (!tools.length)
        calls = ["structure", "behavior"].map((l, i) =>
          call(
            "subagent",
            {
              agent: "shipping-" + l,
              role: "swarm workers",
              verification: true,
              decision: { onPass: "proceed", onFail: "repair" },
              background: false,
              description: "Review " + l,
              prompt: "B_REVIEW " + l,
            },
            i,
          ),
        );
      else {
        assert.ok(JSON.stringify(tools).includes("Only B users"));
        answer = "SHIPPING_RESULT: BLOCKED\nB awaits deployment evidence";
      }
    } else if (user.includes("limit-review-fixture")) {
      limitReviews++;
      answer = blockRepair
        ? "SHIPPING_RESULT: BLOCKED\nStudio unavailable"
        : "SHIPPING_RESULT: REWORK\nfixture regression still present";
    } else if (user.includes("round-probe") || user.includes(continuation)) {
      const head = /[a-f0-9]{40}/.exec(user)?.[0] ?? limitHeads.at(-1)!;
      if (!tools.length)
        calls = [
          call("pstack_ship", {
            repo: "fixture/project",
            pr: 4,
            head,
            notes: "limit-review-fixture",
            ...(user.includes(continuation) || user.includes("stale-quote")
              ? { resumeInstruction: continuation }
              : {}),
          }),
        ];
      else answer = JSON.stringify(tools[0].content);
    } else if (user.includes("검수하고 머지해") || user.includes("재작업 반영")) {
      assert.ok(JSON.stringify(body.messages).includes("# Active mode: poteto-mode"));
      if (!tools.length)
        calls = [
          call("pstack_ship", {
            repo: "fixture/project",
            pr: 3,
            head: isFixed ? fixedHead : firstHead,
            notes: "Ready for review",
          }),
        ];
      else answer = JSON.stringify(tools[0].content);
    } else if (user.includes("DIRECT_PERMISSION_PROBE")) {
      if (!tools.length) calls = [call("shell", { command: merge() })];
      else answer = "done";
    } else if (user.includes("REVIEW_LANE")) {
      assert.ok(
        user.includes(docPathA) && !user.includes("docs/tasks/B.md"),
        "reviewer lost the task document path",
      );
      if (!isFixed && user.includes("behavior")) await releaseBehavior.promise;
      if (!tools.length)
        calls = [
          call("shell", { command: "git show " + (isFixed ? fixedHead : firstHead) + ":" + docPathA }),
        ];
      else if (tools.length === 1) {
        assert.ok(JSON.stringify(tools).includes(isFixed ? "Changed A criterion" : "Immediate entry"));
        calls = [call("shell", { command: comment("child write") })];
      } else if (!isFixed && user.includes("REVIEW_LANE structure") && tools.length === 2) {
        calls = [call("shell", { command: createReview(user, "A", firstHead) })];
      } else
        answer =
          !isFixed && user.includes("structure") ? "FAIL remove retired adapter" : "PASS inspected candidate";
    } else if (
      !JSON.stringify(body.messages.filter((m: any) => m.role === "system")).includes(
        "Shipping 프라이머리 지침",
      )
    ) {
      answer = "OK";
    } else if (cancelTarget) {
      answer = "SHIPPING_RESULT: BLOCKED\ncancellation fixture";
    } else if (user.includes("<subagent sessionID=")) {
      const both =
        user.includes("PASS inspected candidate") &&
        JSON.stringify(body.messages).includes("FAIL remove retired adapter");
      answer = both
        ? "SHIPPING_RESULT: REWORK\nboth reviewers complete: remove retired adapter"
        : "구조 검수 실패, 행동 검수 대기 중";
      if (!both) structureDelivered.resolve();
      if (both && !JSON.stringify(tools).includes("fixture review published"))
        calls = [call("shell", { command: comment("REWORK", initialBase, firstHead) })];
    } else if (!tools.length) {
      assert.ok(user.includes(docPathA), "Shipping lost criteria ref");
      assert.ok(
        JSON.stringify(body.messages.filter((m: any) => m.role === "system")).includes(
          "Shipping 프라이머리 지침",
        ),
      );
      calls = (isFixed ? ["structure"] : ["structure", "behavior"]).map((lane, i) =>
        call(
          "subagent",
          {
            agent: "shipping-" + lane,
            ...(isFixed ? { sessionID: structureID } : {}),
            role: "swarm workers",
            verification: true,
            decision: { onPass: "proceed", onFail: "repair" },
            background: !isFixed,
            description: "Review " + lane,
            prompt: "REVIEW_LANE " + lane + " " + (isFixed ? fixedHead : firstHead),
          },
          i,
        ),
      );
    } else if (!isFixed) {
      reviewerID = (await host.client.session.list({ limit: 15 })).data.find(
        (s) => s.agent === "shipping-behavior",
      )!.id;
      answer = "검수 중";
    } else if (!JSON.stringify(tools).includes("fixture review published")) {
      calls = [
        call("shell", {
          command: comment(
            "PASS",
            JSON.parse(
              typeof body.messages[last].content === "string"
                ? body.messages[last].content
                : body.messages[last].content[0].text,
            ).baseOid,
            fixedHead,
          ),
        }),
      ];
    } else if (JSON.stringify(tools).includes("SHIPPING_STALE")) {
      answer = "SHIPPING_RESULT: STALE\nBase changed during review";
    } else if (!JSON.stringify(tools).includes("fixture merged")) {
      advanceBaseBeforeMerge?.();
      advanceBaseBeforeMerge = undefined;
      if (tools.length > 2)
        throw new Error("Shipping shell did not execute the gh fixture: " + JSON.stringify(tools));
      calls = [call("shell", { command: merge() })];
    } else if (!JSON.stringify(tools).includes("mergeCommit")) {
      calls = [
        call("shell", {
          command:
            "gh pr view https://github.invalid/fixture/project/pull/3 --json state,baseRefName,mergeCommit",
        }),
      ];
    } else answer = "SHIPPING_RESULT: MERGED\nfixture-confirmed";
    const chunk = (delta: any, finish: any) => ({
      id: "shipping",
      object: "chat.completion.chunk",
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    return new Response(
      "data: " +
        JSON.stringify(
          chunk(
            calls.length ? { role: "assistant", tool_calls: calls } : { role: "assistant", content: answer },
            null,
          ),
        ) +
        "\n\ndata: " +
        JSON.stringify(chunk({}, calls.length ? "tool_calls" : "stop")) +
        "\n\ndata: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
const profile = JSON.parse(readFileSync(resolve(root, "opencode.jsonc"), "utf8"));
for (const name of ["shipping", "shipping-structure", "shipping-behavior"]) {
  profile.agents[name].model = profile.agents[name].model.replace(/^openai\//, "pstack-test/");
}
const path = process.env.PATH;
process.env.PATH = tmp + ":" + path;
// Break only the tool's child /wait connection; the native reviewer keeps running.
let reviewerID = "";
let structureID = "";
const reconnected = Promise.withResolvers<void>();
let waits = 0;
let upstreamPort: number;
const proxy = createServer((req, res) => {
  if (cancelTarget && req.url?.endsWith("/" + cancelTarget + "/wait")) {
    if (++cancelAttempts === 1) res.destroy();
    else {
      req.resume();
      cancelWaitOpen.resolve(() => res.destroy()); // Hold the second wait until the caller cancels.
    }
    return;
  }
  const isReviewerWait = reviewerID && req.url?.endsWith("/" + reviewerID + "/wait");
  const attempt = isReviewerWait ? ++waits : 0;
  const upstream = forward(
    { hostname: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers: req.headers },
    (reply) => {
      res.writeHead(reply.statusCode!, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on("error", () => res.destroy());
  res.on("close", () => upstream.destroy());
  upstream.on("finish", () => {
    if (attempt === 1) res.destroy();
    if (attempt === 2) reconnected.resolve();
  });
  req.pipe(upstream);
});
await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
const proxyUrl = "http://127.0.0.1:" + (proxy.address() as AddressInfo).port;
const host = await testHost(
  {
    ...profile,
    model: "pstack-test/gpt-parent#high",
    plugins: [
      resolve(root, "plugins/pstack"),
      resolve(import.meta.dir, "fixtures/probe"),
      {
        package: resolve(import.meta.dir, "fixtures/models"),
        options: { url: `http://127.0.0.1:${endpoint.port}/v1`, shippingModel: true },
      },
    ],
  },
  { apiProxy: proxyUrl },
);
upstreamPort = Number(readFileSync(resolve(host.directory, "api-port"), "utf8"));
process.env.PATH = path;
try {
  await ready(host, "pstack");
  await ready(host, "pstack-test-models");
  const location = { directory: host.project };
  const worker = await host.client.session.create({ location, agent: "pstack" });
  const a = host.project,
    b = resolve(tmp, "tree-b"),
    dev = resolve(tmp, "dev");
  fixtureGit(a, "init", "-q", "-b", "dev");
  fixtureGit(a, "commit", "--allow-empty", "-qm", "Pre-task base");
  fixtureGit(a, "switch", "-qc", "task-a");
  fixtureGit(a, "worktree", "add", "-q", dev, "dev");
  fixtureGit(a, "worktree", "add", "-q", "-b", "task-b", b, "dev");
  const docA = connectFixture(a, "Immediate entry", "docs/tasks/A.md");
  const docB = connectFixture(b, "Only B users", "docs/tasks/B.md");
  firstHead = docA.head;
  bHead = docB.head;
  docPathA = docA.path;
  const setPR = (id: number, head: string, path: string) =>
    writeFileSync(
      resolve(tmp, "pr-" + id + ".json"),
      JSON.stringify({
        state: "OPEN",
        body: "Fixture PR\n\nTask-Doc: " + path,
        baseRefName: "dev",
        baseRefOid: fixtureGit(dev, "rev-parse", "HEAD"),
        url: "https://github.invalid/fixture/project/pull/" + id,
        headRefOid: head,
        mergeCommit: null,
      }),
    );
  initialBase = fixtureGit(dev, "rev-parse", "HEAD");
  setPR(3, firstHead, docA.path);
  setPR(8, bHead, docB.path);
  async function invoke(directory: string, sessionID: string, tool: string, args: object) {
    const r: any = await host.client.rpc.call({
      rpcID: "pstack-test-probe",
      method: "call",
      location: { directory },
      input: { sessionID, tool, args },
    });
    if (r.output.toolError) throw Error(r.output.toolError);
    return r.output.output;
  }
  const workerB = await host.client.session.create({ agent: "pstack", location: { directory: b } });
  for (const directory of [a, b]) {
    let loaded = false;
    for (let n = 0; n < 120; n++) {
      const plugins = (await host.client.plugin.list({ location: { directory } })).data;
      loaded = ["pstack", "pstack-test-probe", "pstack-test-models"].every((id) =>
        plugins.some((p) => p.id === id && p.state.status === "active"),
      );
      if (loaded) break;
      await Bun.sleep(100);
    }
    if (!loaded)
      throw Error(
        "fixture plugins unavailable for " +
          directory +
          ": " +
          JSON.stringify(
            (await host.client.plugin.list({ location: { directory } })).data.map((p) => [
              p.id,
              p.state.status,
            ]),
          ),
      );
  }
  async function contextPath(id: string) {
    await host.client.session.prompt({ sessionID: id, text: "CONTEXT_PROBE" });
    await host.client.session.wait({ sessionID: id });
    const last = (await host.client.session.context({ sessionID: id })).findLast(
      (m) => m.type === "assistant",
    );
    return last?.type === "assistant" ? last.content.find((p) => p.type === "text")?.text : undefined;
  }
  assert.deepEqual(await Promise.all([contextPath(worker.id), contextPath(workerB.id)]), ["A", "B"]);
  const impl = await Promise.all(
    [
      [a, worker.id, "A"],
      [b, workerB.id, "B"],
    ].map(([dir, id, lane]) =>
      invoke(dir, id, "subagent", {
        role: "feature, refactoring",
        agent: "poteto-agent",
        description: "Implement " + lane,
        prompt: "IMPL_RUN " + lane,
        background: false,
      }),
    ),
  );
  assert.ok(JSON.stringify(impl[0]).includes("Immediate entry"));
  assert.ok(JSON.stringify(impl[1]).includes("Only B users"));
  await host.client.session.prompt({ sessionID: worker.id, text: "DIRECT_PERMISSION_PROBE" });
  await host.client.session.wait({ sessionID: worker.id });
  const ctx = await host.client.session.context({ sessionID: worker.id });
  assert.match(JSON.stringify(ctx), /permission.rejected/);
  await host.client.session.command({ sessionID: worker.id, name: "pstack-mode", text: "on poteto-mode" });
  await host.client.session.wait({ sessionID: worker.id });
  await host.client.session.prompt({
    sessionID: worker.id,
    text: `PR fixture/project#3, head ${firstHead}, requirement: Immediate entry`,
  });
  await host.client.session.wait({ sessionID: worker.id });
  assert.ok(
    (await host.client.session.instructions.entry.list({ sessionID: worker.id })).some(
      (e) => e.key === "pstack-mode" && e.value.includes("poteto-mode"),
    ),
  );
  const submit = async (text: string) => {
    await host.client.session.prompt({ sessionID: worker.id, text });
    await host.client.session.wait({ sessionID: worker.id });
    const messages = await host.client.session.context({ sessionID: worker.id });
    const turn = messages.slice(messages.findLastIndex((m) => m.type === "user" && m.text === text) + 1);
    const calls = turn.flatMap((m) =>
      m.type === "assistant" ? m.content.filter((p) => p.type === "tool") : [],
    );
    assert.deepEqual(
      calls.map((t) => t.name),
      ["pstack_ship"],
    );
    const state = calls[0].state;
    assert.equal(state.status, "completed", state.status === "error" ? state.error.message : undefined);
    const content = state.content.find((p) => p.type === "text");
    assert.ok(content?.type === "text");
    return JSON.parse(content.text);
  };
  const bReview = invoke(b, workerB.id, "pstack_ship", {
    repo: "fixture/project",
    pr: 8,
    head: bHead,
    notes: "B_SHIP",
  });
  const pending = submit("검수하고 머지해");
  try {
    await Promise.race([
      Promise.all([structureDelivered.promise, reconnected.promise]),
      pending.then(() => {
        throw new Error("Returned before both reviewers finished");
      }),
      new Promise<never>((_, reject) =>
        AbortSignal.timeout(15_000).addEventListener(
          "abort",
          () => reject(new Error("First reviewer notification missing")),
          { once: true },
        ),
      ),
    ]);
  } finally {
    releaseBehavior.resolve();
  }
  const first = await pending;
  assert.equal(waits, 2);
  assert.equal(first.status, "REWORK");
  assert.equal(first.path, docA.path);
  assert.equal((await bReview).status, "BLOCKED");
  assert.match(first.result, /both reviewers complete/);
  const shipping = await host.client.session.get({ sessionID: first.sessionID });
  assert.equal(shipping.agent, "shipping");
  assert.ok(!shipping.parentID);
  assert.notEqual(shipping.id, worker.id);
  const children = async () =>
    (await host.client.session.list({ parentID: shipping.id })).data.map((c) => c.agent).sort();
  assert.deepEqual(await children(), ["shipping-behavior", "shipping-structure"]);
  const reviewer = await host.client.session.get({ sessionID: reviewerID });
  assert.equal(reviewer.parentID, shipping.id);
  assert.equal(reviewer.outcome, "succeeded");
  const originalChildren = (await host.client.session.list({ parentID: shipping.id })).data;
  structureID = originalChildren.find((c) => c.agent === "shipping-structure")!.id;
  // Revise A in the same document. No relink or session restart.
  writeFileSync(
    resolve(a, docPathA),
    "# 현재 완료조건\nChanged A criterion\n\n## 변경이력\n- 사용자 결정: A 범위 조정\n",
  );
  fixtureGit(a, "commit", "-qam", "Adjust A only");
  fixedHead = fixtureGit(a, "rev-parse", "HEAD");
  setPR(3, fixedHead, docPathA);
  const reviewA = resolve(reviewRoots.get("A")!, firstHead + "-structure");
  const reviewB = resolve(reviewRoots.get("B")!, bHead + "-structure");
  assert.notEqual(reviewRoots.get("A"), reviewRoots.get("B"));
  assert.ok(existsSync(reviewA) && existsSync(reviewB), "REWORK and BLOCKED must keep worktrees");
  const dirty = resolve(reviewRoots.get("A")!, fixedHead + "-behavior");
  fixtureGit(a, "worktree", "add", "--detach", dirty, fixedHead);
  const excludes = resolve(tmp, "test-excludes");
  writeFileSync(excludes, "user-note\n");
  fixtureGit(a, "config", "--local", "core.excludesFile", excludes);
  writeFileSync(resolve(dirty, "user-note"), "keep this evidence");
  assert.equal(fixtureGit(dirty, "check-ignore", "user-note"), "user-note");
  const oldBase = fixtureGit(dev, "rev-parse", "HEAD");
  advanceBaseBeforeMerge = () => {
    writeFileSync(resolve(dev, "dependency.txt"), "updated dependency");
    fixtureGit(dev, "add", "dependency.txt");
    fixtureGit(dev, "commit", "-qm", "Advance base while reviewing the same head");
    setPR(3, fixedHead, docPathA);
  };
  const drift = await submit(`재작업 반영 ${fixedHead}`);
  assert.equal(drift.status, "STALE");
  assert.equal(drift.baseOid, oldBase);
  assert.equal(drift.head, fixedHead);
  assert.doesNotMatch(readFileSync(log, "utf8"), /^pr merge /m);
  assert.equal(fixtureGit(a, "config", "--worktree", "--get", "pstack.taskDoc"), docA.path);
  const newBase = fixtureGit(dev, "rev-parse", "HEAD");
  assert.notEqual(newBase, oldBase);
  assert.ok(existsSync(reviewA), "STALE must keep worktrees");
  const second = await submit(`재작업 반영 ${fixedHead}`);
  assert.equal(second.baseOid, newBase);
  assert.equal(second.head, fixedHead);
  assert.equal(second.sessionID, shipping.id);
  assert.equal(second.path, first.path);
  assert.deepEqual(second.worktreeCleanup.removed, [reviewA]);
  assert.deepEqual(
    second.worktreeCleanup.retained.map((entry: any) => entry.path),
    [dirty],
  );
  assert.equal(existsSync(reviewA), false);
  assert.equal(readFileSync(resolve(dirty, "user-note"), "utf8"), "keep this evidence");
  assert.ok(fixtureGit(a, "worktree", "list", "--porcelain").includes(reviewB));
  rmSync(resolve(dirty, "user-note"));
  const retry = await submit(`재작업 반영 ${fixedHead}`);
  assert.equal(retry.commit, second.commit);
  assert.deepEqual(retry.worktreeCleanup, { removed: [dirty], retained: [] });
  assert.equal(existsSync(reviewRoots.get("A")!), false);
  assert.ok(existsSync(reviewB));
  assert.equal(second.released, true);
  assert.equal(second.commit, fixtureGit(dev, "rev-parse", "HEAD"));
  assert.equal(fixtureGit(dev, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 2);
  assert.ok(fixtureGit(dev, "show", "HEAD:" + docPathA).includes("Changed A criterion"));
  assert.throws(() => fixtureGit(a, "config", "--worktree", "--get", "pstack.taskDoc"));
  assert.equal(fixtureGit(b, "config", "--worktree", "--get", "pstack.taskDoc"), docB.path);
  assert.ok(readFileSync(resolve(b, docB.path), "utf8").includes("Only B users"));
  assert.deepEqual(await Promise.all([contextPath(worker.id), contextPath(workerB.id)]), ["none", "B"]);
  const bPR = JSON.parse(readFileSync(resolve(tmp, "pr-8.json"), "utf8"));
  await assert.rejects(releaseMerged(b, docB.path, bHead, "dev", bPR), /unconfirmed/i);
  for (const change of [
    { headRefOid: firstHead },
    { baseRefName: "another-base" },
    { body: "Task-Doc: docs/tasks/A.md" },
    { mergeCommit: null },
  ]) {
    await assert.rejects(
      releaseMerged(b, docB.path, bHead, "dev", {
        ...bPR,
        state: "MERGED",
        mergeCommit: { oid: second.commit },
        ...change,
      }),
      /unconfirmed/i,
    );
  }
  assert.equal(fixtureGit(b, "config", "--worktree", "--get", "pstack.taskDoc"), docB.path);
  // A previously reviewed document must never clear a replacement binding.
  assert.equal(
    await releaseMerged(b, docA.path, bHead, "dev", {
      ...bPR,
      state: "MERGED",
      body: "Task-Doc: " + docA.path,
      mergeCommit: { oid: second.commit },
    }),
    false,
  );
  assert.equal(fixtureGit(b, "config", "--worktree", "--get", "pstack.taskDoc"), docB.path);
  assert.match(second.result, /MERGED\s+fixture-confirmed/);
  assert.deepEqual(await children(), ["shipping-behavior", "shipping-structure"]);
  for (const child of originalChildren) {
    const messages = await host.client.session.context({ sessionID: child.id });
    const briefs = messages.filter((m) => m.type === "user").map((m) => m.text);
    assert.ok(briefs.some((text) => text.includes(firstHead) && text.includes(oldBase)));
    assert.equal(
      briefs.some((text) => text.includes(newBase)),
      child.id === structureID,
    );
    assert.equal(
      briefs.some((text) => text.includes(fixedHead)),
      child.id === structureID,
    );
  }
  assert.deepEqual(
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter((line) => !line.startsWith("pr view ")),
    [
      comment("REWORK", oldBase, firstHead).slice(3).replaceAll('"', ""),
      comment("PASS", oldBase, fixedHead).slice(3).replaceAll('"', ""),
      comment("PASS", newBase, fixedHead).slice(3).replaceAll('"', ""),
      merge().slice(3),
    ],
  );
  assert.deepEqual([...shippingRequests].sort(), ["behavior:xhigh", "shipping:medium", "structure:xhigh"]);
  // Initial failure, a duplicate head and two failed repairs still permit another repair.
  connectFixture(a, "Limit fixture", "docs/tasks/limit.md");
  for (let i = 0; i < 5; i++) {
    fixtureGit(a, "commit", "--allow-empty", "-qm", "Round " + i);
    limitHeads.push(fixtureGit(a, "rev-parse", "HEAD"));
  }
  setPR(4, limitHeads[0], "docs/tasks/limit.md");
  assert.equal((await submit("round-probe " + limitHeads[0])).status, "REWORK");
  blockRepair = true;
  for (const head of limitHeads.slice(1, 4)) {
    setPR(4, head, "docs/tasks/limit.md");
    assert.equal((await submit("round-probe " + head)).status, "BLOCKED");
  }
  blockRepair = false;
  for (const i of [0, 0, 1, 2, 3]) {
    setPR(4, limitHeads[i], "docs/tasks/limit.md");
    assert.equal((await submit("round-probe " + limitHeads[i])).status, i === 3 ? "AWAITING_USER" : "REWORK");
  }
  const atPause = limitReviews;
  setPR(4, limitHeads[4], "docs/tasks/limit.md");
  assert.equal((await submit("round-probe " + limitHeads[4] + " stale-quote")).status, "AWAITING_USER");
  assert.equal(limitReviews, atPause);
  assert.equal((await submit(continuation)).status, "REWORK");
  assert.equal(limitReviews, atPause + 1);
  setPR(3, fixedHead, docPathA);
  fixtureGit(a, "config", "--worktree", "pstack.taskDoc", docPathA);
  // Same working session and Shipping root. Disconnect once, then cancel the active retry.
  cancelTarget = shipping.id;
  await host.client.session.prompt({ sessionID: worker.id, text: `재작업 반영 ${fixedHead}` });
  const dropConnection = await Promise.race([
    cancelWaitOpen.promise,
    new Promise<never>((_, reject) =>
      AbortSignal.timeout(5_000).addEventListener(
        "abort",
        () => reject(new Error("Shipping did not reconnect before cancellation")),
        { once: true },
      ),
    ),
  ]);
  const interrupted = await host.client.session.interrupt({ sessionID: worker.id });
  assert.ok(interrupted.interrupted);
  dropConnection();
  await host.client.session.wait({ sessionID: worker.id }, { signal: AbortSignal.timeout(5_000) });
  assert.equal((await host.client.session.get({ sessionID: worker.id })).outcome, "interrupted");
  await Bun.sleep(750);
  assert.equal(cancelAttempts, 2, "User cancellation must not reconnect");
  console.log(
    "PASS Shipping cleans only its clean review worktrees after confirmed merge and retries retained worktrees without merging again, blocked stale-base merge before gh, refreshed reviewer base/head and targeted recheck, three environmental blocks do not pause rework, concurrent A/B worktrees, amended A document at new PR head, local squash merge clears only A, pause after three failed repairs, no new review while paused, explicit user continuation, disconnected child /wait retried on the same reviewer, user interruption stopped further /wait retries, poteto-mode handoff, worker merge denied, background reviewers drained before REWORK, targeted recheck and confirmed merge returned to worker.",
  );
} finally {
  await host.close();
  proxy.closeAllConnections();
  proxy.close();
  endpoint.stop(true);
  rmSync(tmp, { recursive: true, force: true });
}
