import type { Contract } from "../contract/schema.ts";

export const ENTRY_CONTRACT = "harness-contract";

export const INITIAL_GOAL_SENTINEL = "[pi-harness: deliver the contract goal]";

export type ContractEntryData = { contract: Contract; runDir: string };

export type SessionEntryLike = { type: string; customType?: string; data?: unknown };

export function findContractEntry(entries: readonly SessionEntryLike[]): ContractEntryData | undefined {
  let found: ContractEntryData | undefined;
  for (const e of entries) {
    if (e.type === "custom" && e.customType === ENTRY_CONTRACT && e.data !== undefined && e.data !== null) {
      found = e.data as ContractEntryData;
    }
  }
  return found;
}
