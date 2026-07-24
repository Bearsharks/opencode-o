import advisorStateV4 from "../_advisor-state-v4/advisor-state"

const mutatingTools = new Set(["edit", "write", "apply_patch"])

export default async (...args: Parameters<typeof advisorStateV4>) => {
  const hooks = await advisorStateV4(...args)
  const before = hooks["tool.execute.before"]

  return {
    ...hooks,
    "tool.execute.before": async (input: Parameters<NonNullable<typeof before>>[0], result: Parameters<NonNullable<typeof before>>[1]) => {
      if (input.agent === "driver" && mutatingTools.has(input.tool)) return
      return before?.(input, result)
    },
  }
}
