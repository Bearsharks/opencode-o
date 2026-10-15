import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  buildFixedContract, finalizeContract, newContractId, type FinalizeContext,
} from "../src/contract/build.ts";
import { EFFORT_TABLE, runtimeFor } from "../src/contract/effort.ts";
import { renderAgentSection, renderUserSummary } from "../src/contract/render.ts";
import { type Contract, type JudgeDraft, JudgeDraftSchema, type Material } from "../src/contract/schema.ts";
import { Settings } from "typebox/system";
import { schemaErrors, validateContract } from "../src/contract/validate.ts";
import type { RepoConfig } from "../src/config/repo-config.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-contract-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.join(tmp, "repo");
fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
const outside = path.join(tmp, "outside");
fs.mkdirSync(outside);
const materialFile = path.join(tmp, "design.png");
fs.writeFileSync(materialFile, "x");

const ORIGINAL = "  Fix the login bug.\n\tKeep \"quotes\" — and 한국어 `ticks` <<< >>> \n";
const repo = { root, headSha: "abc123", branch: "main", repoKey: "repo" };
const paths = { runDir: "/run/secret-run-dir", materialsDir: path.join(tmp, "mat-x") };
const now = new Date("2026-10-15T00:00:00.000Z");

const capturedMaterials: Material[] = [
  { id: "M1", path: materialFile, mediaType: "image/png", describe: "login screen design", origin: { kind: "figma", ref: "node 1:2" } },
  { id: "M2", path: materialFile, mediaType: "image/png", describe: "unused", origin: { kind: "user-file" } },
];

function ctx(over: Partial<FinalizeContext> = {}): FinalizeContext {
  return {
    original: ORIGINAL, repo, paths, model: "test-model", materials: capturedMaterials,
    effort: { level: "high", decidedBy: "classifier" }, now, contractId: "id-1", ...over,
  };
}

function draft(over: Partial<JudgeDraft> = {}): JudgeDraft {
  return {
    refinedGoal: "Fix the login bug so valid users can sign in.",
    doneConditions: [
      { statement: "Unit tests pass", basis: "SECRET-BASIS", verify: { kind: "command", command: "npm test" } },
      { statement: "Login works in the browser", verify: { kind: "reported", how: "Sign in manually" } },
      {
        statement: "Package build passes",
        verify: { kind: "command", command: "npm run build", cwd: "pkg", equivalents: ["pnpm build"], allowExtraArgs: true, timeoutSec: 60 },
      },
    ],
    prohibitions: [
      { text: "Do not change the public API.", source: { kind: "user-message", ref: "first message" } },
      { text: "Do not edit generated files.", source: { kind: "repo-rules" } },
    ],
    materialIds: ["M1"],
    ...over,
  };
}

function valid(): Contract {
  return finalizeContract(draft(), ctx());
}

function errorsOf(c: unknown, checkFs = true): string[] {
  const r = validateContract(c, { checkFs });
  assert.equal(r.ok, r.errors.length === 0);
  return r.errors;
}

function expectError(c: unknown, pattern: RegExp, checkFs = true): void {
  const errors = errorsOf(c, checkFs);
  assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
}

describe("runtimeFor", () => {
  test("matches the effort table for all four levels", () => {
    assert.deepEqual(runtimeFor("low", "m"), { model: "m", thinkingLevel: "medium", workerCap: 0, workerThinkingLevel: "medium" });
    assert.deepEqual(runtimeFor("medium", "m"), { model: "m", thinkingLevel: "high", workerCap: 2, workerThinkingLevel: "high" });
    assert.deepEqual(runtimeFor("high", "m"), { model: "m", thinkingLevel: "xhigh", workerCap: 4, workerThinkingLevel: "xhigh" });
    assert.deepEqual(runtimeFor("extreme", "m"), { model: "m", thinkingLevel: "max", workerCap: 20, workerThinkingLevel: "xhigh" });
    assert.deepEqual(Object.keys(EFFORT_TABLE), ["low", "medium", "high", "extreme"]);
  });
});

describe("JudgeDraftSchema", () => {
  test("accepts a draft and rejects an unknown source kind", () => {
    assert.deepEqual(schemaErrors(JudgeDraftSchema, draft(), "draft"), []);
    const bad = draft({
      // @ts-expect-error not a source kind
      prohibitions: [{ text: "x", source: { kind: "nope" } }],
    });
    assert.ok(schemaErrors(JudgeDraftSchema, bad, "draft").some((e) => e.startsWith("draft.prohibitions[0].source.kind must be one of")));
    const badVerify = { ...draft(), doneConditions: [{ statement: "s", verify: { kind: "reported" } }] };
    assert.deepEqual(schemaErrors(JudgeDraftSchema, badVerify, "draft"), ["draft.doneConditions[0].verify must have required properties how."]);
  });
});

describe("finalizeContract", () => {
  test("assigns ids in draft order and applies defaults", () => {
    const c = valid();
    assert.equal(c.schemaVersion, 1);
    assert.equal(c.contractId, "id-1");
    assert.equal(c.createdAt, "2026-10-15T00:00:00.000Z");
    assert.equal(c.source, "judge");
    assert.equal(c.goal.original, ORIGINAL);
    assert.equal(c.goal.refined, "Fix the login bug so valid users can sign in.");
    assert.deepEqual(c.doneConditions.map((d) => d.id), ["D1", "D2", "D3"]);
    assert.deepEqual(c.doneConditions[0], {
      id: "D1", statement: "Unit tests pass", basis: "SECRET-BASIS",
      verify: { kind: "command", command: "npm test", cwd: ".", equivalents: [], allowExtraArgs: false, timeoutSec: 900 },
    });
    assert.deepEqual(c.doneConditions[1]!.verify, { kind: "reported", how: "Sign in manually", checks: [] });
    assert.deepEqual(c.doneConditions[2]!.verify, {
      kind: "command", command: "npm run build", cwd: "pkg", equivalents: ["pnpm build"], allowExtraArgs: true, timeoutSec: 60,
    });
    assert.deepEqual(c.prohibitions.map((p) => p.id), ["P1", "P2"]);
    assert.deepEqual(c.prohibitions[0]!.source, { kind: "user-message", ref: "first message" });
    assert.deepEqual(c.runtime, runtimeFor("high", "test-model"));
    assert.deepEqual(c.effort, { level: "high", decidedBy: "classifier" });
    assert.deepEqual(c.materials, [capturedMaterials[0]]);
    assert.ok(validateContract(c).ok);
  });

  test("keeps materials in draft order", () => {
    const c = finalizeContract(draft({ materialIds: ["M2", "M1"] }), ctx());
    assert.deepEqual(c.materials.map((m) => m.id), ["M2", "M1"]);
  });

  test("throws on an unknown material id", () => {
    assert.throws(() => finalizeContract(draft({ materialIds: ["M1", "M9"] }), ctx()), /M9/);
  });

  test("throws listing validation errors", () => {
    assert.throws(
      () => finalizeContract(draft({ refinedGoal: "  " }), ctx()),
      /Contract is invalid:[\s\S]*goal\.refined must not be empty/,
    );
  });

  test("honours source and generates ids by default", () => {
    const c = finalizeContract(draft(), ctx({ source: "file", contractId: undefined, now: undefined }));
    assert.equal(c.source, "file");
    assert.match(c.contractId, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(c.createdAt)));
    assert.notEqual(newContractId(), newContractId());
  });
});

describe("buildFixedContract", () => {
  const repoConfig: RepoConfig = {
    repoKey: "repo",
    completionSteps: [
      { title: "Unit tests", command: "npm test" },
      { title: "Build", statement: "The package builds", command: "npm run build", cwd: "pkg", timeoutSec: 120, equivalents: ["pnpm build"] },
    ],
  };

  test("creates one command condition per completion step", () => {
    const c = buildFixedContract({ original: ORIGINAL, repo, paths, model: "m", repoConfig, source: "fixed", now, contractId: "x" });
    assert.equal(c.goal.refined, ORIGINAL);
    assert.deepEqual(c.doneConditions, [
      { id: "D1", statement: "Unit tests passes", basis: "repo-config:repo", verify: { kind: "command", command: "npm test", cwd: ".", equivalents: [], allowExtraArgs: false, timeoutSec: 900 } },
      { id: "D2", statement: "The package builds", basis: "repo-config:repo", verify: { kind: "command", command: "npm run build", cwd: "pkg", equivalents: ["pnpm build"], allowExtraArgs: false, timeoutSec: 120 } },
    ]);
    assert.deepEqual(c.prohibitions, []);
    assert.deepEqual(c.materials, []);
    assert.deepEqual(c.effort, { level: "medium", decidedBy: "fixed" });
    assert.deepEqual(c.runtime, runtimeFor("medium", "m"));
    assert.deepEqual(validateContract(c).errors, []);
  });

  test("has no done conditions without a repo config", () => {
    const c = buildFixedContract({ original: ORIGINAL, repo, paths, model: "m", repoConfig: null, materials: [capturedMaterials[0]!], source: "fallback" });
    assert.deepEqual(c.doneConditions, []);
    assert.deepEqual(c.materials, [capturedMaterials[0]]);
    assert.ok(validateContract(c).ok);
  });

  test("fixed and fallback differ only in source and decidedBy", () => {
    const base = { original: ORIGINAL, repo, paths, model: "m", repoConfig, now, contractId: "same" };
    const fixed = buildFixedContract({ ...base, source: "fixed" });
    const fallback = buildFixedContract({ ...base, source: "fallback" });
    assert.equal(fixed.source, "fixed");
    assert.equal(fallback.source, "fallback");
    assert.equal(fallback.effort.decidedBy, "fallback");
    const strip = (c: Contract) => ({ ...c, source: null, effort: { ...c.effort, decidedBy: null } });
    assert.deepEqual(strip(fixed), strip(fallback));
  });
});

describe("validateContract", () => {
  test("accepts a valid contract and an empty condition list", () => {
    assert.deepEqual(errorsOf(valid()), []);
    const c = valid();
    c.doneConditions = [];
    assert.deepEqual(errorsOf(c), []);
  });

  test("rule 1: schema errors with readable paths", () => {
    const c = valid() as unknown as Record<string, unknown>;
    (c.doneConditions as Array<Record<string, unknown>>)[0]!.verify = { kind: "command", command: "x" };
    c.extra = true;
    const errors = errorsOf(c);
    assert.ok(errors.some((e) => e.startsWith("contract.doneConditions[0].verify")), JSON.stringify(errors));
    assert.ok(errors.some((e) => /has unknown properties: extra/.test(e)), JSON.stringify(errors));
    expectError({ ...valid(), schemaVersion: 2 }, /contract\.schemaVersion must be 1/);
    expectError(null, /^contract /);
  });

  test("rule 1: union errors are reduced to the matching shape and all errors are kept", () => {
    const c = valid() as unknown as { effort: { level: string }; doneConditions: Array<{ verify: unknown }>; prohibitions: Array<{ source: { kind: string } }> };
    c.effort.level = "huge";
    c.doneConditions[0]!.verify = { kind: "command", command: "x" };
    c.doneConditions[1]!.verify = { kind: "weird" };
    c.prohibitions[0]!.source.kind = "nope";
    const before = Settings.Get().maxErrors;
    const errors = errorsOf(c);
    assert.equal(Settings.Get().maxErrors, before);
    assert.ok(errors.includes('contract.effort.level must be one of "low", "medium", "high", "extreme".'), JSON.stringify(errors));
    assert.ok(errors.includes("contract.doneConditions[0].verify must have required properties cwd, equivalents, allowExtraArgs, timeoutSec."), JSON.stringify(errors));
    assert.ok(!errors.some((e) => e.startsWith("contract.doneConditions[0]") && /how|reported/.test(e)), JSON.stringify(errors));
    assert.ok(errors.includes('contract.doneConditions[1].verify.kind must be one of "command", "reported".'));
    assert.ok(errors.some((e) => e.startsWith("contract.prohibitions[0].source.kind must be one of")));
  });

  test("rule 2: goal texts must be non-empty", () => {
    const a = valid();
    a.goal.original = "";
    expectError(a, /goal\.original must not be empty/);
    const b = valid();
    b.goal.refined = " \n";
    expectError(b, /goal\.refined must not be empty/);
  });

  test("rule 3: ids must match their pattern and be unique", () => {
    const a = valid();
    a.doneConditions[0]!.id = "X1";
    expectError(a, /doneConditions\[0\]\.id "X1" must look like D1/);
    const b = valid();
    b.doneConditions[1]!.id = "D1";
    expectError(b, /"D1" is used more than once/);
    const c = valid();
    c.prohibitions[0]!.id = "p1";
    expectError(c, /prohibitions\[0\]\.id "p1" must look like P1/);
    const e = valid();
    e.materials[0]!.id = "M";
    expectError(e, /materials\[0\]\.id "M" must look like M1/);
  });

  test("rule 4: command verify fields and cwd containment", () => {
    const withVerify = (patch: Record<string, unknown>) => {
      const c = valid();
      Object.assign(c.doneConditions[0]!.verify, patch);
      return c;
    };
    expectError(withVerify({ command: " " }), /verify\.command must not be empty/);
    expectError(withVerify({ timeoutSec: 0 }), /timeoutSec must be a positive integer/);
    expectError(withVerify({ timeoutSec: 1.5 }), /timeoutSec must be a positive integer/);
    expectError(withVerify({ cwd: "missing" }), /cwd "missing" does not exist/);
    expectError(withVerify({ cwd: "../outside" }), /resolves outside the repo root/);
    fs.symlinkSync(outside, path.join(root, "link-out"));
    expectError(withVerify({ cwd: "link-out" }), /resolves outside the repo root/);
    assert.deepEqual(errorsOf(withVerify({ cwd: "missing" }), false), []);
    const c = valid();
    c.repo.root = path.join(tmp, "no-such-root");
    expectError(c, /repo\.root ".*no-such-root" does not exist/);
    assert.deepEqual(errorsOf(c, false), []);
  });

  test("rule 5: reported verify needs how", () => {
    const c = valid();
    const v = c.doneConditions[1]!.verify;
    assert.equal(v.kind, "reported");
    if (v.kind === "reported") v.how = "";
    expectError(c, /doneConditions\[1\] \(D2\)\.verify\.how must not be empty/);
  });

  test("rule 7: material paths absolute and existing when checkFs", () => {
    const a = valid();
    a.materials[0]!.path = "relative/design.png";
    expectError(a, /must be an absolute path/);
    const b = valid();
    b.materials[0]!.path = path.join(tmp, "missing.png");
    expectError(b, /missing\.png" does not exist/);
    assert.deepEqual(errorsOf(b, false), []);
  });

  test("rule 8: runtime must match the effort table", () => {
    const a = valid();
    a.runtime.workerCap = 3;
    expectError(a, /runtime must match the effort table for level "high"/);
    const b = valid();
    b.effort.level = "low";
    expectError(b, /level "low"/);
  });

  test("rule 9: fixed and fallback restrictions", () => {
    const c = valid();
    c.source = "fixed";
    const errors = errorsOf(c);
    assert.ok(errors.some((e) => /prohibitions must be empty when source is "fixed"/.test(e)));
    assert.ok(errors.some((e) => /effort\.level must be "medium" when source is "fixed"/.test(e)));
    const f = buildFixedContract({ original: "x", repo, paths, model: "m", repoConfig: null, source: "fallback" });
    f.effort.level = "low";
    f.runtime = runtimeFor("low", "m");
    expectError(f, /effort\.level must be "medium" when source is "fallback"/);
  });

  test("collects several errors at once", () => {
    const c = valid();
    c.goal.original = "";
    c.doneConditions[0]!.id = "bad";
    c.runtime.workerCap = 99;
    assert.ok(errorsOf(c).length >= 3);
  });
});

describe("renderAgentSection", () => {
  test("renders the full section with the original byte-identical", () => {
    const c = valid();
    const text = renderAgentSection(c);
    assert.ok(text.startsWith("GOAL\nOriginal request (authoritative; it wins on any conflict):\n<<<\n"));
    assert.ok(text.includes(`<<<\n${ORIGINAL}\n>>>\n`));
    assert.ok(text.includes("Refined goal (clarification only; it adds no decisions): Fix the login bug so valid users can sign in."));
    assert.ok(text.includes(`Reference materials:\n- M1 ${materialFile} — login screen design`));
    assert.ok(text.includes("\n\nDONE CONDITIONS\n"));
    assert.ok(text.includes("- D1 Unit tests pass. Verify by running `npm test` in `.`.\n"));
    assert.ok(text.includes("- D2 Login works in the browser. Verify: Sign in manually.\n"));
    assert.ok(text.includes("- D3 Package build passes. Verify by running `npm run build` in `pkg`.\n"));
    assert.ok(text.includes("If a prohibition prevents you from verifying a condition, do not break the prohibition; report that you could not verify that condition."));
    assert.ok(text.endsWith("\n\nPROHIBITIONS\n- P1 Do not change the public API. (source: user-message first message)\n- P2 Do not edit generated files. (source: repo-rules)"));
    for (const removed of ["run_check", "record_evidence", "the harness", "ask_user", "ANSWERED BY THE USER"]) assert.ok(!text.includes(removed), removed);
  });

  test("never leaks effort, runtime, basis, id or run paths", () => {
    const text = renderAgentSection(valid());
    for (const banned of ["SECRET-BASIS", "id-1", "test-model", "xhigh", "workerCap", "effort", "secret-run-dir", "mat-x", "classifier", "abc123"]) {
      assert.ok(!text.includes(banned), `leaked ${banned}`);
    }
  });

  test("renders none cases", () => {
    const c = buildFixedContract({ original: "do it", repo, paths, model: "m", repoConfig: null, source: "fixed" });
    const text = renderAgentSection(c);
    assert.ok(!text.includes("Reference materials:"));
    assert.ok(text.includes("DONE CONDITIONS\nNone.\n\nPROHIBITIONS\nNone."));
    assert.ok(!text.includes("If a prohibition prevents"));
    assert.ok(text.endsWith("PROHIBITIONS\nNone."));
  });
});

describe("renderUserSummary", () => {
  test("contains the source label, conditions, prohibitions, materials and effort", () => {
    const text = renderUserSummary(valid());
    assert.ok(text.startsWith("이번 작업의 계약입니다."));
    assert.ok(text.includes("판정 에이전트가 작성"));
    assert.ok(text.includes("Fix the login bug so valid users can sign in."));
    assert.ok(text.includes("- D1 Unit tests pass. 명령 `npm test`를 `.`에서 실행해 확인합니다."));
    assert.ok(text.includes("- D2 Login works in the browser. 에이전트가 확인 결과를 보고합니다.\n"));
    assert.ok(text.includes("- D3 Package build passes. 명령 `npm run build`를 `pkg`에서 실행해 확인합니다."));
    assert.ok(text.includes("- P1 Do not change the public API. 출처는 사용자 메시지 (first message)입니다."));
    assert.ok(!text.includes("하네스"));
    assert.ok(text.includes(`- M1 ${materialFile}: login screen design`));
    assert.ok(text.includes("노력 수준은 높음입니다. 사고 수준은 xhigh이고, 작업자는 최대 4개까지 동시에 쓸 수 있습니다."));
  });

  test("uses the right label for each source", () => {
    const base = { original: "do it", repo, paths, model: "m", repoConfig: null };
    assert.ok(renderUserSummary(buildFixedContract({ ...base, source: "fixed" })).includes("고정 계약"));
    const fallback = renderUserSummary(buildFixedContract({ ...base, source: "fallback" }));
    assert.ok(fallback.includes("대체 계약"));
    assert.ok(fallback.includes("완료 조건은 없습니다."));
    assert.ok(fallback.includes("금지 사항은 없습니다."));
    assert.ok(fallback.includes("노력 수준은 보통입니다."));
    const file = finalizeContract(draft(), ctx({ source: "file", effort: { level: "low", decidedBy: "override" } }));
    const fileText = renderUserSummary(file);
    assert.ok(fileText.includes("파일에서 불러왔습니다"));
    assert.ok(fileText.includes("노력 수준은 낮음입니다. 사고 수준은 medium이고, 작업자는 쓰지 않습니다."));
    const extreme = finalizeContract(draft(), ctx({ effort: { level: "extreme", decidedBy: "classifier" } }));
    assert.ok(renderUserSummary(extreme).includes("노력 수준은 극한입니다."));
  });
});
