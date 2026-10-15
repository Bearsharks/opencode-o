import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { TSchema } from "typebox";
import { Settings } from "typebox/system";
import { Value } from "typebox/value";
import { runtimeFor } from "./effort.ts";
import { type Contract, ContractSchema } from "./schema.ts";

export type ValidationResult = { ok: boolean; errors: string[] };

export function formatPointer(pointer: string, root: string): string {
  if (pointer === "") return root;
  let out = root;
  for (const raw of pointer.split("/").slice(1)) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    out += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
  }
  return out;
}

function resolvePointer(target: unknown, pointer: string): unknown {
  let node = target;
  for (const raw of pointer.split("/").slice(1)) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[raw.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return node;
}

const SCHEMA_MAX_ERRORS = 200;

type Branch = { const?: unknown; properties?: { kind?: { const?: unknown } } };

export function schemaErrors(schema: TSchema, value: unknown, root: string): string[] {
  const previous = Settings.Get().maxErrors;
  Settings.Set({ maxErrors: SCHEMA_MAX_ERRORS });
  let raw: ReturnType<typeof Value.Errors>;
  try {
    raw = Value.Errors(schema, value);
  } finally {
    Settings.Set({ maxErrors: previous });
  }
  const anyOfDetail = new Map<string, string>();
  const dropped: Array<{ instancePath: string; schemaPrefix: string }> = [];
  for (const e of raw) {
    if (e.keyword !== "anyOf") continue;
    const key = `${e.instancePath}#${e.schemaPath}`;
    const drop = (schemaPrefix: string) => dropped.push({ instancePath: e.instancePath, schemaPrefix });
    const branches = (resolvePointer(schema, e.schemaPath.replace(/^#/, "")) as { anyOf?: Branch[] }).anyOf ?? [];
    if (branches.length > 0 && branches.every((b) => "const" in b)) {
      anyOfDetail.set(key, `must be one of ${branches.map((b) => JSON.stringify(b.const)).join(", ")}`);
      drop(`${e.schemaPath}/anyOf/`);
      continue;
    }
    const kind = (resolvePointer(value, e.instancePath) as { kind?: unknown } | undefined)?.kind;
    const kinds = branches.map((b) => b.properties?.kind?.const);
    const match = kinds.indexOf(kind);
    if (kind !== undefined && match >= 0) {
      anyOfDetail.set(key, "");
      branches.forEach((_, i) => { if (i !== match) drop(`${e.schemaPath}/anyOf/${i}/`); });
    } else if (kinds.every((k) => k !== undefined)) {
      anyOfDetail.set(key, `.kind must be one of ${kinds.map((k) => JSON.stringify(k)).join(", ")}`);
      drop(`${e.schemaPath}/anyOf/`);
    }
  }
  const isDropped = (instancePath: string, schemaPath: string) => dropped.some((d) =>
    (instancePath === d.instancePath || instancePath.startsWith(`${d.instancePath}/`))
    && `${schemaPath}/`.startsWith(d.schemaPrefix));

  const out: string[] = [];
  for (const e of raw) {
    if (e.keyword === "boolean" && e.schemaPath.endsWith("/additionalProperties")) continue;
    if (isDropped(e.instancePath, e.schemaPath)) continue;
    const where = formatPointer(e.instancePath, root);
    let detail = e.message;
    if (e.keyword === "const") detail = `must be ${JSON.stringify(e.params.allowedValue)}`;
    else if (e.keyword === "additionalProperties") detail = `has unknown properties: ${e.params.additionalProperties.join(", ")}`;
    else if (e.keyword === "anyOf") {
      const custom = anyOfDetail.get(`${e.instancePath}#${e.schemaPath}`);
      if (custom === "") continue;
      detail = custom ?? "does not match any allowed shape";
    }
    const line = detail.startsWith(".") ? `${where}${detail}.` : `${where} ${detail}.`;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function checkIds(items: Array<{ id: string }>, prefix: string, label: string, errors: string[]): void {
  const pattern = new RegExp(`^${prefix}\\d+$`);
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (!pattern.test(item.id)) {
      errors.push(`${label}[${i}].id "${item.id}" must look like ${prefix}1, ${prefix}2, ...`);
    }
    if (seen.has(item.id)) errors.push(`${label}[${i}].id "${item.id}" is used more than once; ids must be unique.`);
    seen.add(item.id);
  });
}

export function validateContract(contract: unknown, opts: { checkFs?: boolean } = {}): ValidationResult {
  const checkFs = opts.checkFs ?? true;
  const schemaProblems = schemaErrors(ContractSchema, contract, "contract");
  if (schemaProblems.length > 0) return { ok: false, errors: schemaProblems };
  const c = contract as Contract;
  const errors: string[] = [];

  if (c.goal.original.trim() === "") errors.push("contract.goal.original must not be empty.");
  if (c.goal.refined.trim() === "") errors.push("contract.goal.refined must not be empty.");

  checkIds(c.doneConditions, "D", "contract.doneConditions", errors);
  checkIds(c.prohibitions, "P", "contract.prohibitions", errors);
  checkIds(c.materials, "M", "contract.materials", errors);

  let realRoot: string | null = null;
  if (checkFs && c.doneConditions.some((d) => d.verify.kind === "command")) {
    try {
      realRoot = fs.realpathSync(c.repo.root);
    } catch {
      errors.push(`contract.repo.root "${c.repo.root}" does not exist.`);
    }
  }

  c.doneConditions.forEach((d, i) => {
    const where = `contract.doneConditions[${i}] (${d.id})`;
    const v = d.verify;
    if (v.kind === "command") {
      if (v.command.trim() === "") errors.push(`${where}.verify.command must not be empty.`);
      if (!Number.isInteger(v.timeoutSec) || v.timeoutSec <= 0) {
        errors.push(`${where}.verify.timeoutSec must be a positive integer number of seconds (got ${v.timeoutSec}).`);
      }
      if (realRoot !== null) {
        let realCwd: string | null = null;
        try {
          realCwd = fs.realpathSync(path.resolve(c.repo.root, v.cwd));
        } catch {
          errors.push(`${where}.verify.cwd "${v.cwd}" does not exist under the repo root.`);
        }
        if (realCwd !== null && !isInside(realRoot, realCwd)) {
          errors.push(`${where}.verify.cwd "${v.cwd}" resolves outside the repo root; use a directory inside the repo.`);
        }
      }
    } else if (v.how.trim() === "") {
      errors.push(`${where}.verify.how must not be empty; say how the agent should check this condition.`);
    }
  });

  if (checkFs) {
    c.materials.forEach((m, i) => {
      const where = `contract.materials[${i}] (${m.id}).path "${m.path}"`;
      if (!path.isAbsolute(m.path)) errors.push(`${where} must be an absolute path.`);
      else if (!fs.existsSync(m.path)) errors.push(`${where} does not exist.`);
    });
  }

  const expected = runtimeFor(c.effort.level, c.runtime.model);
  if (!isDeepStrictEqual(c.runtime, expected)) {
    errors.push(`contract.runtime must match the effort table for level "${c.effort.level}": expected ${JSON.stringify(expected)}.`);
  }

  if (c.source === "fixed" || c.source === "fallback") {
    if (c.prohibitions.length > 0) errors.push(`contract.prohibitions must be empty when source is "${c.source}".`);
    if (c.effort.level !== "medium") errors.push(`contract.effort.level must be "medium" when source is "${c.source}".`);
  }

  return { ok: errors.length === 0, errors };
}
