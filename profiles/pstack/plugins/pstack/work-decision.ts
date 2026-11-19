import type { Criteria } from "./criteria";

export type Decision = { onPass: string; onFail: string; outcome?: string };
const actions = ["proceed", "repair", "verify", "ask", "stop"] as const;
export const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["onPass", "onFail"],
  description:
    "For verification, bug-fix or hardest tasks say which decision changes. Acceptance criteria are inherited automatically. Optionally select an exact outcome from the worktree task document.",
  properties: { outcome: { type: "string" }, onPass: { enum: actions }, onFail: { enum: actions } },
};
export function withDecision<
  I extends { agent?: string; role?: string; verification?: boolean; decision?: Decision; prompt?: string },
  C,
  R,
>(
  execute: (input: Omit<I, "decision">, context: C, criteria?: Criteria) => Promise<R>,
  lookup: (context: C) => Promise<Criteria | undefined>,
) {
  return async (input: I, context: C) => {
    const { decision, ...task } = input;
    if (task.verification || task.role === "bug-fix" || task.role === "hardest tasks" || decision) {
      if (
        !decision ||
        !actions.some((a) => a === decision.onPass) ||
        !actions.some((a) => a === decision.onFail)
      )
        throw Error("Specify the next actions in decision.onPass and onFail.");
      if (decision.onPass === decision.onFail)
        throw Error("Skip this delegation: either result leads to the same next action.");
    }
    const criteria = await lookup(context);
    if (
      !criteria &&
      (task.role === "feature, refactoring" ||
        task.role === "bug-fix" ||
        task.agent === "shipping-structure" ||
        task.agent === "shipping-behavior" ||
        decision?.outcome)
    )
      throw Error(
        "Use acceptance-criteria and connect the worktree task document before implementation or PR review.",
      );
    if (criteria) {
      const normalize = (s: string) => s.normalize().replace(/\s+/gu, " ").trim();
      if (
        decision?.outcome !== undefined &&
        (!decision.outcome.trim() ||
          !normalize(criteria.text.split(/^#{1,6}\s+변경\s*이력(?:\s|$)/mu)[0]).includes(
            normalize(decision.outcome),
          ))
      )
        throw Error(
          "Proposed condition is absent from the current task document. Return unresolved expectations to the criteria owner.",
        );
      task.prompt = `작업 기준: ${criteria.path} — ${criteria.head ? "PR head " + criteria.head + "에서" : "현재 워크트리에서"} 완료조건과 변경이력을 읽을 것.\n\nAssigned work:\n${task.prompt ?? ""}`;
    }
    return execute(task, context, criteria);
  };
}
