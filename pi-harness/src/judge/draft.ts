import { finalizeContract } from "../contract/build.ts";
import type { Contract, EffortLevel, JudgeDraft, Material } from "../contract/schema.ts";
import type { JudgeInput } from "./input.ts";

export type DraftCheck = { ok: true; contract: Contract } | { ok: false; errors: string[] };

export function sourceErrors(draft: JudgeDraft, materials: Material[]): string[] {
  const errors: string[] = [];
  const ids = new Set(materials.map((m) => m.id));
  draft.prohibitions.forEach((p, i) => {
    const where = `prohibitions[${i}]`;
    const ref = p.source.ref?.trim() ?? "";
    if (ref === "") {
      errors.push(`${where}.source.ref must cite where the prohibition comes from (a quote, a file path and rule, a material id, or your reason).`);
      return;
    }
    if (p.source.kind === "material") {
      const cited = ref.match(/\bM\d+\b/g) ?? [];
      if (!cited.some((id) => ids.has(id))) {
        errors.push(`${where}.source.ref must name a material id (known: ${[...ids].join(", ") || "none"}).`);
      }
    }
  });
  return errors;
}

export function checkDraft(
  draft: JudgeDraft,
  input: JudgeInput,
  materials: Material[],
  effort: { level: EffortLevel; decidedBy: Contract["effort"]["decidedBy"] } = { level: "medium", decidedBy: "classifier" },
  now?: Date,
): DraftCheck {
  const errors = sourceErrors(draft, materials);
  if (errors.length > 0) return { ok: false, errors };
  try {
    const contract = finalizeContract(draft, {
      original: input.original,
      repo: input.repo,
      paths: input.paths,
      model: input.model,
      materials,
      effort,
      source: "judge",
      ...(now !== undefined ? { now } : {}),
    });
    return { ok: true, contract };
  } catch (e) {
    const message = (e as Error).message;
    const lines = message.startsWith("Contract is invalid:")
      ? message.split("\n").slice(1).map((l) => l.replace(/^- /, ""))
      : [message];
    return { ok: false, errors: lines };
  }
}
