// Check a consequential delegation before model selection or child creation.
// The caller chooses the relevant agreement; the adapter verifies the quoted outcome.
export type Decision = { source: string; outcome: string; onPass: string; onFail: string };
const actions = ["proceed", "repair", "verify", "ask", "stop"] as const;
export const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "outcome", "onPass", "onFail"],
  description:
    "For verification, bug-fix or hardest tasks, cite the user outcome or safety boundary driving this work. What next action changes? Use request (latest user message in this working chat), msg:<workingSessionID>/<userMessageID>[#spec.md] for an explicit decision or its cited spec, or AGENTS.md for project policy. Put proposed techniques in prompt.",
  properties: {
    source: { type: "string" },
    outcome: { type: "string", description: "Exact relevant quote from that source." },
    onPass: { enum: actions },
    onFail: { enum: actions },
  },
};
export async function checkDecision(d: Decision | undefined, read: (source: string) => Promise<string>) {
  if (!d?.source?.trim() || !d.outcome?.trim())
    throw Error("Cite the agreed outcome or safety boundary in decision; keep diagnostics in the brief.");
  if (!actions.some((a) => a === d.onPass) || !actions.some((a) => a === d.onFail))
    throw Error("Use a supported next action for both results.");
  if (d.onPass === d.onFail) throw Error("Skip this delegation: either result leads to the same next action.");
  const normalize = (s: string) => s.normalize().replace(/\s+/gu, " ").trim();
  if (!normalize(await read(d.source)).includes(normalize(d.outcome)))
    throw Error(
      "Proposed condition is absent from the cited source. Use its actual outcome, or keep this as a diagnostic.",
    );
}

export function withDecision<
  I extends { role?: string; verification?: boolean; decision?: Decision; prompt?: string },
  C,
  R,
>(
  execute: (input: Omit<I, "decision">, context: C) => Promise<R>,
  read: (source: string, context: C) => Promise<string>,
) {
  return async (input: I, context: C) => {
    const { decision, ...task } = input;
    if (task.verification || task.role === "bug-fix" || task.role === "hardest tasks" || decision) {
      await checkDecision(decision, (source) => read(source, context));
      task.prompt = `Agreed outcome (${decision!.source}): ${decision!.outcome}\nNext action if confirmed: ${decision!.onPass}; otherwise: ${decision!.onFail}.\n\nAgent brief (proposed implementation or diagnostic):\n${task.prompt ?? ""}`;
    }
    return execute(task, context);
  };
}
