import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { loadRepoConfig, repoKeyFor } from "../src/config/repo-config.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-repocfg-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function reposDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(tmp, "repos-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

describe("repoKeyFor", () => {
  test("scp-style remote", () => {
    assert.equal(repoKeyFor("/x/local", "git@github.com:org/ats-retention.git"), "ats-retention");
    assert.equal(repoKeyFor("/x/local", "git@host:name"), "name");
  });

  test("https remote", () => {
    assert.equal(repoKeyFor("/x/local", "https://github.com/org/mrs-api.git"), "mrs-api");
    assert.equal(repoKeyFor("/x/local", "https://github.com/org/mrs-api/"), "mrs-api");
    assert.equal(repoKeyFor("/x/local", "ssh://git@host:22/org/my-app.git"), "my-app");
  });

  test("no remote uses the directory name", () => {
    assert.equal(repoKeyFor("/x/my-repo"), "my-repo");
    assert.equal(repoKeyFor("/x/my-repo/", ""), "my-repo");
  });
});

describe("loadRepoConfig", () => {
  const config = { repoKey: "alpha", completionSteps: [{ title: "Tests", command: "npm test" }] };

  test("reads the direct file", () => {
    const dir = reposDir({ "alpha.json": config });
    assert.deepEqual(loadRepoConfig(dir, "alpha"), config);
  });

  test("scans match.remotes and match.dirNames", () => {
    const byRemote = { repoKey: "beta", match: { remotes: ["git@github.com:org/beta.git"] }, completionSteps: [] };
    const byDir = { repoKey: "gamma", match: { dirNames: ["gamma-checkout"] }, completionSteps: [], rules: "free text" };
    const dir = reposDir({ "a.json": config, "b.json": byRemote, "c.json": byDir });
    assert.deepEqual(loadRepoConfig(dir, "other", "git@github.com:org/beta.git", "/w/x"), byRemote);
    assert.deepEqual(loadRepoConfig(dir, "other", "git@github.com:org/beta", "/w/x"), byRemote);
    assert.deepEqual(loadRepoConfig(dir, "other", undefined, "/w/gamma-checkout"), byDir);
  });

  test("returns null when nothing matches", () => {
    const dir = reposDir({ "alpha.json": config });
    assert.equal(loadRepoConfig(dir, "zeta", "https://h/org/zeta.git", "/w/zeta"), null);
    assert.equal(loadRepoConfig(path.join(tmp, "no-such-dir"), "zeta"), null);
  });

  test("throws on invalid JSON or schema", () => {
    const badJson = reposDir({ "alpha.json": "{ not json" });
    assert.throws(() => loadRepoConfig(badJson, "alpha"), /alpha\.json is not valid JSON/);
    const badSchema = reposDir({ "alpha.json": { repoKey: "alpha", completionSteps: [{ title: "T" }] } });
    assert.throws(() => loadRepoConfig(badSchema, "alpha"), /alpha\.json is invalid:[\s\S]*config\.completionSteps\[0\] must have required properties command/);
    const badInScan = reposDir({ "x.json": { repoKey: "x", completionSteps: [], extra: 1 } });
    assert.throws(() => loadRepoConfig(badInScan, "alpha", undefined, "/w/alpha"), /x\.json is invalid[\s\S]*unknown properties: extra/);
  });
});
