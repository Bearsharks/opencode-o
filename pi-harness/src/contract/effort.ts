import type { EffortLevel, RuntimeKnobs, ThinkingLevel } from "./schema.ts";

export const EFFORT_TABLE: Readonly<Record<EffortLevel, {
  thinkingLevel: ThinkingLevel; workerCap: number; workerThinkingLevel: ThinkingLevel;
}>> = {
  low: { thinkingLevel: "medium", workerCap: 0, workerThinkingLevel: "medium" },
  medium: { thinkingLevel: "high", workerCap: 2, workerThinkingLevel: "high" },
  high: { thinkingLevel: "xhigh", workerCap: 4, workerThinkingLevel: "xhigh" },
  extreme: { thinkingLevel: "max", workerCap: 20, workerThinkingLevel: "xhigh" },
};

export function runtimeFor(level: EffortLevel, model: string): RuntimeKnobs {
  const row = EFFORT_TABLE[level];
  return {
    model,
    thinkingLevel: row.thinkingLevel,
    workerCap: row.workerCap,
    workerThinkingLevel: row.workerThinkingLevel,
  };
}
