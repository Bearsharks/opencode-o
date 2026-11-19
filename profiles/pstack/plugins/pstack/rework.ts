import type { SessionMessageInfo } from "@opencode/client";

const limit = 3;
export type ReworkCycle = {
  version?: 2;
  since: number;
  heads: string[];
  pause?: { at: number; result: string };
};

export function recordFailure(cycle: ReworkCycle, head: string, status: string, result: string, at: number) {
  if (cycle.pause || at <= cycle.since || cycle.heads.includes(head)) return;
  if (status !== "REWORK") return;
  cycle.heads.push(head);
  // The first REWORK starts the repair cycle. Each subsequent failed candidate is a repair.
  if (cycle.heads.length === limit + 1) cycle.pause = { at, result };
}

// A Shipping session can finish while its caller is offline. Recover its terminal
// verdicts, including reviews recorded before the work-session counter existed.
function* verdicts(history: SessionMessageInfo[], repo: string, pr: number) {
  let head: string | undefined;
  for (const m of history) {
    if (m.type === "user") {
      head = undefined;
      try {
        const handoff = JSON.parse(m.text);
        if (handoff.repo?.toLowerCase() === repo && handoff.pr === pr && /^[a-f0-9]{40}$/.test(handoff.head))
          head = handoff.head;
      } catch {
        /* a manually entered message is not a PR handoff */
      }
    }
    if (!head || m.type !== "assistant" || m.finish !== "stop" || m.error) continue;
    const text = m.content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    const status = /^SHIPPING_RESULT: (REWORK|BLOCKED)(?:\r?\n|$)/.exec(text)?.[1];
    if (status) yield { head, status, text, at: m.time.completed ?? m.time.created };
  }
}

export function reconcile(cycle: ReworkCycle, history: SessionMessageInfo[], repo: string, pr: number) {
  for (const f of verdicts(history, repo, pr)) recordFailure(cycle, f.head, f.status, f.text, f.at);
}

// Old counters stored only SHAs, so they cannot distinguish a failed repair from a blocked one.
// The first SHA is the initial REWORK (or the baseline explicitly resumed by the user).
export function rebuildLegacyCycle(
  old: ReworkCycle,
  histories: SessionMessageInfo[][],
  repo: string,
  pr: number,
) {
  const evidence = histories
    .flatMap((history) => [...verdicts(history, repo, pr)])
    .filter((f) => f.at > old.since)
    .sort((a, b) => a.at - b.at);
  // Preserve entries whose source session has been compacted. Only remove a counted
  // head when its history shows BLOCKED and no actual REWORK on the same head.
  const blocked = new Set(evidence.filter((f) => f.status === "BLOCKED").map((f) => f.head));
  if (old.pause?.result.startsWith("SHIPPING_RESULT: BLOCKED")) blocked.add(old.heads.at(-1)!);
  for (const f of evidence) if (f.status === "REWORK") blocked.delete(f.head);
  const heads = old.heads.filter((head, i) => i === 0 || !blocked.has(head));
  const cycle: ReworkCycle = { version: 2, since: old.since, heads };
  if (heads.length === old.heads.length && old.pause) cycle.pause = old.pause;
  for (const f of evidence) recordFailure(cycle, f.head, f.status, f.text, f.at);
  return cycle;
}

export function pausedResult(cycle: ReworkCycle) {
  return {
    status: "AWAITING_USER",
    failedReworks: limit,
    heads: [...cycle.heads],
    lastVerdict: cycle.pause!.result,
    result: "재작업 3회 실패. 이 PR의 수정·재위임·재제출·자동 재개를 중단하고 사용자 지시를 기다리세요.",
  };
}
