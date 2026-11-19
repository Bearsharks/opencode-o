import type { SessionMessageInfo } from "@opencode/client";

const limit = 3;
export type ReworkCycle = {
  since: number;
  heads: string[];
  pause?: { at: number; result: string };
};

export function recordFailure(cycle: ReworkCycle, head: string, status: string, result: string, at: number) {
  if (cycle.pause || at <= cycle.since || cycle.heads.includes(head)) return;
  if (status !== "REWORK" && !(status === "BLOCKED" && cycle.heads.length)) return;
  cycle.heads.push(head);
  // The first REWORK starts the repair cycle. Each subsequent failed candidate is a repair.
  if (cycle.heads.length === limit + 1) cycle.pause = { at, result };
}

// A Shipping session can finish while its caller is offline. Recover its terminal
// verdicts, including reviews recorded before the work-session counter existed.
export function reconcile(cycle: ReworkCycle, history: SessionMessageInfo[], repo: string, pr: number) {
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
    if (status) recordFailure(cycle, head, status, text, m.time.completed ?? m.time.created);
  }
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
