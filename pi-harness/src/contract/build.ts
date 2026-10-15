import { randomUUID } from "node:crypto";
import type { RepoConfig } from "../config/repo-config.ts";
import { runtimeFor } from "./effort.ts";
import type {
  Contract, DoneCondition, EffortLevel, JudgeDraft, Material, Prohibition,
} from "./schema.ts";
import { validateContract } from "./validate.ts";

export const DEFAULT_CWD = ".";
export const DEFAULT_TIMEOUT_SEC = 900;

export type FinalizeContext = {
  original: string;
  repo: Contract["repo"];
  paths: Contract["paths"];
  model: string;
  materials: Material[];
  effort: { level: EffortLevel; decidedBy: Contract["effort"]["decidedBy"] };
  source?: "judge" | "file";
  now?: Date;
  contractId?: string;
};

export type FixedContractInput = {
  original: string;
  repo: Contract["repo"];
  paths: Contract["paths"];
  model: string;
  repoConfig: RepoConfig | null;
  materials?: Material[];
  source: "fixed" | "fallback";
  now?: Date;
  contractId?: string;
};

function copyMaterial(m: Material): Material {
  return { ...m, origin: { ...m.origin } };
}

export function newContractId(): string {
  return randomUUID();
}

export function finalizeContract(draft: JudgeDraft, ctx: FinalizeContext): Contract {
  const doneConditions: DoneCondition[] = draft.doneConditions.map((d, i) => {
    const v = d.verify;
    const condition: DoneCondition = {
      id: `D${i + 1}`,
      statement: d.statement,
      verify: v.kind === "command"
        ? {
          kind: "command",
          command: v.command,
          cwd: v.cwd ?? DEFAULT_CWD,
          equivalents: v.equivalents ?? [],
          allowExtraArgs: v.allowExtraArgs ?? false,
          timeoutSec: v.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
        }
        : { kind: "reported", how: v.how, checks: [] },
    };
    if (d.basis !== undefined) condition.basis = d.basis;
    return condition;
  });

  const prohibitions: Prohibition[] = draft.prohibitions.map((p, i) => {
    const source: Prohibition["source"] = { kind: p.source.kind };
    if (p.source.ref !== undefined) source.ref = p.source.ref;
    return { id: `P${i + 1}`, text: p.text, source };
  });

  const byId = new Map(ctx.materials.map((m) => [m.id, m]));
  const materials = draft.materialIds.map((id) => {
    const m = byId.get(id);
    if (m === undefined) {
      const known = ctx.materials.map((x) => x.id).join(", ") || "none";
      throw new Error(`Unknown material id "${id}" in draft.materialIds (captured materials: ${known}).`);
    }
    return copyMaterial(m);
  });

  const contract: Contract = {
    schemaVersion: 1,
    contractId: ctx.contractId ?? newContractId(),
    createdAt: (ctx.now ?? new Date()).toISOString(),
    source: ctx.source ?? "judge",
    repo: { ...ctx.repo },
    goal: { original: ctx.original, refined: draft.refinedGoal },
    doneConditions,
    prohibitions,
    materials,
    effort: { level: ctx.effort.level, decidedBy: ctx.effort.decidedBy },
    runtime: runtimeFor(ctx.effort.level, ctx.model),
    paths: { ...ctx.paths },
  };

  const result = validateContract(contract);
  if (!result.ok) throw new Error(`Contract is invalid:\n- ${result.errors.join("\n- ")}`);
  return contract;
}

export function buildFixedContract(input: FixedContractInput): Contract {
  const steps = input.repoConfig?.completionSteps ?? [];
  const doneConditions: DoneCondition[] = steps.map((step, i) => ({
    id: `D${i + 1}`,
    statement: step.statement ?? `${step.title} passes`,
    basis: `repo-config:${input.repo.repoKey}`,
    verify: {
      kind: "command",
      command: step.command,
      cwd: step.cwd ?? DEFAULT_CWD,
      equivalents: step.equivalents ?? [],
      allowExtraArgs: false,
      timeoutSec: step.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
    },
  }));
  return {
    schemaVersion: 1,
    contractId: input.contractId ?? newContractId(),
    createdAt: (input.now ?? new Date()).toISOString(),
    source: input.source,
    repo: { ...input.repo },
    goal: { original: input.original, refined: input.original },
    doneConditions,
    prohibitions: [],
    materials: (input.materials ?? []).map(copyMaterial),
    effort: { level: "medium", decidedBy: input.source },
    runtime: runtimeFor("medium", input.model),
    paths: { ...input.paths },
  };
}
