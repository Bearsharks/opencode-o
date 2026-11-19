import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { ClientError } from "@opencode/client";
import type { Context } from "@opencode/plugin/promise/plugin";
import { prTaskPath, readPR, releaseMerged, shippingHandoff, taskDocument, taskPath } from "./criteria";
import { cleanReviewWorktrees, reviewDirectory } from "./review-worktrees";
import { localClient } from "./api";
import { recordFailure, reconcile, rebuildLegacyCycle, pausedResult, type ReworkCycle } from "./rework";

async function waitForSession(
  client: Awaited<ReturnType<typeof localClient>>,
  sessionID: string,
  signal: AbortSignal,
) {
  let retryDelay = 250;
  for (;;) {
    signal.throwIfAborted();
    try {
      await client.session.wait({ sessionID }, { signal });
      signal.throwIfAborted();
      return;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof ClientError && error.reason === "Transport")) throw error;
    }
    await delay(retryDelay, undefined, { signal });
    retryDelay = Math.min(retryDelay * 2, 5_000);
  }
}

// Waiting for one parent turn can return immediately after a background launch.
async function waitForVerdict(
  client: Awaited<ReturnType<typeof localClient>>,
  id: string,
  request: string,
  signal: AbortSignal,
) {
  const waited = new Set<string>();
  let requestedSummary = false;
  const forwarded = new Set<string>();
  for (;;) {
    signal.throwIfAborted();
    await waitForSession(client, id, signal);
    const history = await client.session.context({ sessionID: id });
    const start = history.findLastIndex(
      (m) => m.type === "user" && (m.id === request || m.metadata?.shippingRequest === request),
    );
    if (start < 0) throw new Error("Shipping request is no longer in context; outcome unconfirmed");
    const turn = history.slice(start + 1);
    const launched = new Set<string>();
    const delivered = new Set<string>();
    for (const m of turn) {
      if (
        m.type === "synthetic" &&
        m.metadata?.source === "subagent" &&
        typeof m.metadata.childID === "string"
      )
        delivered.add(m.metadata.childID);
      if (m.type !== "assistant") continue;
      for (const p of m.content) {
        if (p.type !== "tool" || p.name !== "subagent" || p.state.status !== "completed") continue;
        const meta = p.state.metadata;
        if (meta?.status === "running" && typeof meta.sessionID === "string") launched.add(meta.sessionID);
      }
    }
    const missing = [...launched].filter((child) => !delivered.has(child) && !forwarded.has(child));
    const running = missing.filter((child) => !waited.has(child));
    if (running.length) {
      await Promise.all(running.map((sessionID) => waitForSession(client, sessionID, signal)));
      running.forEach((child) => waited.add(child));
      continue; // Re-read native notifications and wait for their parent turn.
    }
    const last = turn.findLast((m) => m.type === "assistant" || m.type === "synthetic");
    const text =
      last?.type === "assistant" && last.finish === "stop" && !last.error
        ? last.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
            .trim()
        : "";
    const verdict = /^SHIPPING_RESULT: (MERGED|REWORK|BLOCKED|PENDING|STALE)(?:\r?\n|$)/.exec(text);
    if (!missing.length && verdict) return { sessionID: id, status: verdict[1], result: text };
    if (missing.length) {
      // A child can become idle before its native completion reaches the parent's inbox.
      const results = await Promise.all(
        missing.map(async (sessionID) => {
          const child = await client.session.get({ sessionID });
          if (!child.outcome) throw new Error("Reviewer outcome unconfirmed: " + sessionID);
          const messages = await client.session.context({ sessionID });
          const answer = messages.findLast((m) => m.type === "assistant");
          const report =
            answer?.type === "assistant"
              ? answer.content
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("\n")
              : "";
          return { sessionID, outcome: child.outcome, report };
        }),
      );
      await client.session.synthetic({
        sessionID: id,
        resume: true,
        delivery: "queue",
        description: "Completed Shipping reviewers",
        text:
          "These reviewers have finished. Incorporate their terminal evidence and report the Shipping outcome.\n" +
          JSON.stringify(results),
      });
      missing.forEach((child) => forwarded.add(child));
      continue;
    }
    if (requestedSummary)
      throw new Error("Shipping outcome unconfirmed; inspect the Shipping session and PR.");
    requestedSummary = true;
    await client.session.synthetic({
      sessionID: id,
      resume: true,
      delivery: "queue",
      description: "Finalize Shipping verdict",
      text: "Finish this PR's handoff after reading all reviewer results. Start the final reply with SHIPPING_RESULT: MERGED, REWORK, BLOCKED, STALE or PENDING on its own line. PENDING is for a confirmed forge queue only. Include the evidence and action for the caller.",
    });
  }
}

export async function installShipping(ctx: Context) {
  const system = readFileSync(new URL("../../pr-review.md", import.meta.url), "utf8");
  await ctx.agent.transform((editor) =>
    editor.update("shipping", (agent) => {
      agent.system = system;
    }),
  );
  // Validate the actual merge target at the native shell permission boundary.
  await ctx.permission.hook("evaluate", async (event) => {
    if (event.agent !== "shipping" || event.action !== "shell" || event.effect === "deny") return;
    const merges = event.resources.filter((command) => /^gh pr merge(?: |$)/.test(command));
    if (!merges.length) return;
    try {
      const reviewed = await shippingHandoff(ctx, event.sessionID);
      const current = await readPR(ctx.location.directory, reviewed.repo, reviewed.pr);
      if (
        current.state !== "OPEN" ||
        current.baseRefName !== reviewed.base ||
        current.baseRefOid !== reviewed.baseOid ||
        current.headRefOid !== reviewed.head ||
        prTaskPath(current.body) !== reviewed.path
      )
        throw Error(
          `SHIPPING_STALE: reviewed ${reviewed.base}@${reviewed.baseOid} + ${reviewed.head}, current ${current.baseRefName}@${current.baseRefOid} + ${current.headRefOid}. Resubmit to assess the changed inputs.`,
        );
      const allowed = `gh pr merge ${current.url} --squash --match-head-commit ${reviewed.head}`;
      if (merges.length !== 1 || merges[0] !== allowed)
        throw Error("Use the reviewed merge command: " + allowed);
    } catch (error) {
      event.effect = "deny";
      event.message = String(error);
    }
  });
  const busy = new Set<string>();
  await ctx.tool.transform((editor) =>
    editor.add({
      name: "pstack_ship",
      options: { codemode: false },
      description:
        "Hand one authorized PR to the independent Shipping primary. If required CI has already started for this candidate, wait for that run to pass before calling and include its result in notes. Return its review or confirmed merge result to this working session; resubmit the new head after rework.",
      input: {
        type: "object",
        properties: {
          repo: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" },
          pr: { type: "integer", minimum: 1 },
          head: { type: "string", pattern: "^[a-f0-9]{40}$" },
          notes: {
            type: "string",
            description:
              "Reproduction, evidence and review comment links. Criteria are supplied by the runtime.",
          },
          resumeInstruction: {
            type: "string",
            minLength: 1,
            description:
              "Only after AWAITING_USER: quote the latest new user instruction explicitly directing further work on this PR. A status question or scheduled wake is not authorization.",
          },
        },
        required: ["repo", "pr", "head"],
        additionalProperties: false,
      },
      output: { type: "object" },
      async execute(input, context) {
        const key = `shipping/${context.sessionID}/${input.repo}/${input.pr}`;
        const repo = input.repo.toLowerCase();
        const cycleKey = `shipping-rework/${repo}/${input.pr}`;
        if (busy.has(cycleKey)) return { output: { status: "IN_PROGRESS" } };
        busy.add(cycleKey);
        try {
          const client = await localClient();
          let id = (await ctx.storage.get(key)) as string | undefined;
          let cycle: ReworkCycle = ((await ctx.storage.get(cycleKey)) as ReworkCycle | undefined) ?? {
            version: 2,
            since: 0,
            heads: [],
          };
          const history = id ? await client.session.context({ sessionID: id }) : [];
          if (cycle.version !== 2 && cycle.heads.length > 1) {
            const histories = [history];
            let after: string | undefined;
            do {
              const page = await ctx.storage.scan({ prefix: "shipping/", after });
              for (const entry of page.entries) {
                if (
                  entry.value !== id &&
                  typeof entry.value === "string" &&
                  entry.key.toLowerCase().endsWith(`/${repo}/${input.pr}`)
                )
                  histories.push(await client.session.context({ sessionID: entry.value }));
              }
              after = page.next;
            } while (after);
            cycle = rebuildLegacyCycle(cycle, histories, repo, input.pr);
          }
          cycle.version = 2;
          reconcile(cycle, history, repo, input.pr);
          if (cycle.pause) {
            await ctx.storage.set(cycleKey, cycle);
            const caller = await ctx.session.get({ sessionID: context.sessionID });
            const user =
              typeof input.resumeInstruction === "string" && !caller.parentID
                ? (await client.session.context({ sessionID: context.sessionID })).findLast(
                    (m) => m.type === "user",
                  )
                : undefined;
            if (
              user?.type !== "user" ||
              user.time.created <= cycle.pause.at ||
              user.text.trim() !== input.resumeInstruction.trim()
            )
              return { output: pausedResult(cycle) };
            cycle = { version: 2, since: user.time.created, heads: [cycle.heads[cycle.heads.length - 1]] };
          }
          await ctx.storage.set(cycleKey, cycle);
          const cwd = ctx.location.directory;
          const prState = await readPR(cwd, repo, input.pr);
          const path = prTaskPath(prState.body);
          const linked = await taskPath(cwd);
          if (prState.headRefOid !== input.head || !prState.baseRefName || (linked && linked !== path))
            throw Error("PR head or task document differs from the submitted worktree.");
          if (prState.state === "MERGED") {
            if (!prState.mergeCommit?.oid) throw Error("Merge commit unconfirmed; task link retained.");
            const handoff = history.findLast((m) => m.type === "user" && m.metadata?.shippingRequest);
            const previous = handoff?.type === "user" ? JSON.parse(handoff.text) : undefined;
            let released = false;
            let worktreeCleanup;
            if (
              id &&
              previous?.path === path &&
              previous.head === input.head &&
              previous.base === prState.baseRefName
            ) {
              released = await releaseMerged(cwd, path, input.head, previous.base, prState);
              // A caller may reconnect after gh merged but before reviewers have stopped.
              await waitForSession(client, id, context.signal);
              for (const child of (await client.session.list({ parentID: id })).data) {
                if (!child.outcome) await waitForSession(client, child.id, context.signal);
              }
              worktreeCleanup = await cleanReviewWorktrees(cwd, id);
            }
            return {
              output: { status: "MERGED", commit: prState.mergeCommit!.oid, path, released, worktreeCleanup },
            };
          }
          if (prState.state !== "OPEN" || !linked)
            throw Error("Shipping requires an open PR and its matching worktree task document.");
          if (!/^[a-f0-9]{40}$/.test(prState.baseRefOid ?? "")) throw Error("PR base commit unavailable.");
          await taskDocument(cwd, path, input.head);
          const finish = async (
            head: string,
            verdict: Awaited<ReturnType<typeof waitForVerdict>>,
            doc: string,
            base: string,
            baseOid: string,
          ) => {
            recordFailure(cycle, head, verdict.status, verdict.result, Date.now());
            await ctx.storage.set(cycleKey, cycle);
            if (verdict.status === "MERGED") {
              const remote = await readPR(cwd, repo, input.pr);
              const released = await releaseMerged(cwd, doc, head, base, remote);
              return {
                output: {
                  ...verdict,
                  head,
                  baseOid,
                  path: doc,
                  commit: remote.mergeCommit!.oid,
                  released,
                  worktreeCleanup: await cleanReviewWorktrees(cwd, id!),
                },
              };
            }
            return { output: { ...(cycle.pause ? pausedResult(cycle) : verdict), head, baseOid, path: doc } };
          };
          if (!id) {
            const root = await client.session.create({
              agent: "shipping",
              location: { directory: ctx.location.directory },
              title: `Shipping ${input.repo}#${input.pr}`,
            });
            id = root.id;
            await ctx.storage.set(key, id);
          }
          const shipping = await client.session.get({ sessionID: id });
          if (shipping.parentID || shipping.agent !== "shipping") throw new Error("Invalid Shipping session");
          const prior = history.findLast((m) => m.type === "user");
          if (prior?.type === "user") {
            const children = (await client.session.list({ parentID: id })).data;
            if (children.some((child) => !child.outcome)) {
              const result = await waitForVerdict(client, id, prior.id, context.signal);
              const priorInput = JSON.parse(prior.text);
              const settled = await finish(
                priorInput.head,
                result,
                priorInput.path,
                priorInput.base,
                priorInput.baseOid,
              );
              if (
                (priorInput.head === input.head &&
                  priorInput.path === path &&
                  priorInput.base === prState.baseRefName &&
                  priorInput.baseOid === prState.baseRefOid) ||
                cycle.pause
              )
                return settled;
            }
          }
          const request = crypto.randomUUID();
          await client.session.prompt({
            sessionID: id,
            text: JSON.stringify({
              ...input,
              path,
              base: prState.baseRefName,
              baseOid: prState.baseRefOid,
              url: prState.url,
              reviewDirectory: await reviewDirectory(cwd, id),
              read: "git show " + input.head + ":" + path,
            }),
            metadata: { shippingRequest: request },
          });
          return await finish(
            input.head,
            await waitForVerdict(client, id, request, context.signal),
            path,
            prState.baseRefName,
            prState.baseRefOid,
          );
        } finally {
          busy.delete(cycleKey);
        }
      },
    }),
  );
}
