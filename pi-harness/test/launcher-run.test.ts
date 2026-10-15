import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  contractBuilderFor, createRunDir, defaultRunDir, HARNESS_ROOT, judgeOptionsFor, listMaterials, mediaTypeFor, newRunId, parseRunArgs, prepareRun,
  type RunOptions, reposDirFor, resolveTargetRepo,
} from "../src/launcher/run.ts";
import { CliError } from "../src/launcher/work.ts";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-harness-run-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();

let counter = 0;
function dir(name: string): string {
  const d = path.join(tmp, `${++counter}-${name}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function gitRepo(name: string, opts: { commit?: boolean; remote?: string } = {}): string {
  const repo = dir(name);
  git(repo, "init", "-q", "-b", "main", ".");
  fs.writeFileSync(path.join(repo, "check.js"), "process.exit(0);\n");
  if (opts.commit ?? true) {
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");
  }
  if (opts.remote !== undefined) git(repo, "remote", "add", "origin", opts.remote);
  return repo;
}

const rejects = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (e: unknown) => e instanceof CliError && pattern.test(e.message));

describe("parseRunArgs", () => {
  const cwd = tmp;

  test("defaults: repo is cwd, mode fixed, passthrough kept", () => {
    const o = parseRunArgs(["--model", "p/m", "--message", "do it", "--", "--mode", "json"], {}, cwd);
    assert.deepEqual(o, { repo: cwd, model: "p/m", mode: "fixed", message: "do it", passthrough: ["--mode", "json"] });
  });

  test("resolves paths against cwd and reads the message file verbatim", () => {
    const msg = path.join(tmp, "msg.txt");
    const text = "  first line -- with @file\n둘째 줄 \"quoted\"\n\n";
    fs.writeFileSync(msg, text);
    const o = parseRunArgs([
      "--repo", "r", "--model=p/m", "--contract-mode", "fixed", "--run-dir", "out", "--materials-dir", "mats",
      "--message-file", "msg.txt",
    ], {}, cwd);
    assert.equal(o.message, text);
    assert.equal(o.repo, path.join(cwd, "r"));
    assert.equal(o.runDir, path.join(cwd, "out"));
    assert.equal(o.materialsDir, path.join(cwd, "mats"));
    rejects(() => parseRunArgs(["--model", "p/m", "--message", "x", "--skip-baseline"], {}, cwd), /Unknown argument "--skip-baseline"/);
    rejects(() => parseRunArgs(["--model", "p/m", "--message", "x", "--no-baseline-cache"], {}, cwd), /Unknown argument "--no-baseline-cache"/);
  });

  test("model comes from PI_HARNESS_MODEL when the flag is missing; the flag wins", () => {
    assert.equal(parseRunArgs(["--message", "x"], { PI_HARNESS_MODEL: "env/m" }, cwd).model, "env/m");
    assert.equal(parseRunArgs(["--model", "flag/m", "--message", "x"], { PI_HARNESS_MODEL: "env/m" }, cwd).model, "flag/m");
    rejects(() => parseRunArgs(["--message", "x"], {}, cwd), /needs --model/);
    rejects(() => parseRunArgs(["--message", "x"], { PI_HARNESS_MODEL: " " }, cwd), /needs --model/);
  });

  test("exactly one of --message-file and --message is required", () => {
    rejects(() => parseRunArgs(["--model", "p/m"], {}, cwd), /--message-file <file> or --message <text>/);
    rejects(() => parseRunArgs(["--model", "p/m", "--message", "a", "--message-file", "f"], {}, cwd), /not both/);
    rejects(() => parseRunArgs(["--model", "p/m", "--message-file", "missing.txt"], {}, cwd), /Cannot read message file/);
    fs.writeFileSync(path.join(tmp, "blank.txt"), " \n\t\n");
    rejects(() => parseRunArgs(["--model", "p/m", "--message-file", "blank.txt"], {}, cwd), /message is empty/);
  });

  test("rejects unknown contract modes and unknown flags", () => {
    rejects(() => parseRunArgs(["--model", "p/m", "--message", "x", "--contract-mode", "file"], {}, cwd), /must be one of fixed, judge/);
    rejects(() => parseRunArgs(["--model", "p/m", "--message", "x", "--bogus"], {}, cwd), /Unknown argument "--bogus"/);
    rejects(() => parseRunArgs(["--model"], {}, cwd), /--model needs a value/);
  });

  test("judge mode parses with its flags; both modes have a builder", () => {
    const base = ["--model", "p/m", "--message", "x", "--contract-mode", "judge"];
    const plain = parseRunArgs(base, {}, cwd);
    assert.equal(plain.mode, "judge");
    assert.equal(plain.effort, undefined);
    assert.equal(plain.judgeThinking, undefined);
    assert.equal(plain.judgeTimeoutSec, undefined);
    assert.equal(plain.judgeMcp, undefined);
    const o = parseRunArgs([...base, "--effort", "extreme", "--judge-thinking=xhigh", "--judge-timeout", "600", "--judge-mcp"], {}, cwd);
    assert.equal(o.effort, "extreme");
    assert.equal(o.judgeThinking, "xhigh");
    assert.equal(o.judgeTimeoutSec, 600);
    assert.equal(o.judgeMcp, true);
    assert.equal(typeof contractBuilderFor("judge"), "function");
    assert.equal(typeof contractBuilderFor("fixed"), "function");
  });

  test("judge flags need judge mode and valid values", () => {
    const base = ["--model", "p/m", "--message", "x"];
    rejects(() => parseRunArgs([...base, "--effort", "low"], {}, cwd), /--effort only apply to --contract-mode judge/);
    rejects(() => parseRunArgs([...base, "--contract-mode", "fixed", "--judge-mcp", "--judge-timeout", "5"], {}, cwd), /--judge-timeout, --judge-mcp only apply/);
    const judge = [...base, "--contract-mode", "judge"];
    rejects(() => parseRunArgs([...judge, "--effort", "huge"], {}, cwd), /--effort must be one of low, medium, high, extreme/);
    rejects(() => parseRunArgs([...judge, "--judge-thinking", "ultra"], {}, cwd), /--judge-thinking must be one of off, minimal/);
    for (const bad of ["0", "-3", "1.5", "abc"]) {
      rejects(() => parseRunArgs([...judge, `--judge-timeout=${bad}`], {}, cwd), /--judge-timeout must be a positive whole number/);
    }
  });

  test("judge options: default thinking high, no timeout, MCP off, child args and isolated env from the context", () => {
    const o = parseRunArgs(["--model", "p/m", "--message", "x", "--contract-mode", "judge"], {}, cwd);
    const say = () => {};
    const defaults = judgeOptionsFor(o, say, {});
    assert.equal(defaults.thinking, "high");
    assert.equal(defaults.timeoutSec, undefined);
    assert.equal(defaults.mcp, false);
    assert.equal(defaults.effort, undefined);
    assert.deepEqual(defaults.childExtraArgs, []);
    const env = { PI_HARNESS_CHILD_EXTRA_ARGS: JSON.stringify(["-e", "/x/fixture.ts"]), PI_CODING_AGENT_DIR: "/tmp/agent-dir" };
    const withEnv = judgeOptionsFor({ ...o, effort: "low", judgeTimeoutSec: 9, judgeMcp: true }, say, env);
    assert.deepEqual(withEnv.childExtraArgs, ["-e", "/x/fixture.ts"]);
    assert.equal(withEnv.env, env);
    assert.equal(withEnv.agentDir, "/tmp/agent-dir");
    assert.equal(withEnv.effort, "low");
    assert.equal(withEnv.timeoutSec, 9);
    assert.equal(withEnv.mcp, true);
    rejects(() => judgeOptionsFor(o, say, { PI_HARNESS_CHILD_EXTRA_ARGS: "-e x" }), /must be a JSON array of strings/);
    rejects(() => judgeOptionsFor(o, say, { PI_HARNESS_CHILD_EXTRA_ARGS: "[\"--\"]" }), /must not contain "--"/);
  });
});

describe("resolveTargetRepo", () => {
  test("finds the top level from a subdirectory with head, branch and remote", () => {
    const repo = gitRepo("remote", { remote: "git@bitbucket.org:team/my-repo.git" });
    const sub = path.join(repo, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    const t = resolveTargetRepo(sub);
    assert.equal(t.root, fs.realpathSync(repo));
    assert.equal(t.headSha, git(repo, "rev-parse", "HEAD"));
    assert.equal(t.branch, "main");
    assert.equal(t.remoteUrl, "git@bitbucket.org:team/my-repo.git");
    assert.equal(t.repoKey, "my-repo");
  });

  test("detached head and no remote leave branch and remote absent; repoKey is the folder name", () => {
    const repo = gitRepo("detached-repo");
    git(repo, "checkout", "-q", "--detach");
    const t = resolveTargetRepo(repo);
    assert.equal("branch" in t, false);
    assert.equal("remoteUrl" in t, false);
    assert.equal(t.repoKey, path.basename(repo));
  });

  test("fails clearly outside git, for missing dirs and for repos without commits", () => {
    const plain = dir("plain");
    rejects(() => resolveTargetRepo(plain), /not inside a git repository/);
    rejects(() => resolveTargetRepo(path.join(plain, "nope")), /does not exist/);
    rejects(() => resolveTargetRepo(gitRepo("empty", { commit: false })), /has no commits yet/);
  });
});

describe("run directory", () => {
  test("runId is a UTC timestamp plus a short random suffix", () => {
    assert.equal(newRunId(new Date("2026-10-15T02:03:04.567Z"), "abc123"), "20261015T020304Z-abc123");
    assert.match(newRunId(), /^\d{8}T\d{6}Z-[0-9a-f]{6}$/);
    assert.notEqual(newRunId(), newRunId());
  });

  test("default run dir lives under ~/.pi-harness/runs", () => {
    assert.equal(defaultRunDir("/home/u", "rid"), path.join("/home/u", ".pi-harness", "runs", "rid"));
  });

  test("createRunDir makes the run and materials directories", () => {
    const runDir = path.join(dir("rd"), "deep", "run");
    const paths = createRunDir(runDir);
    assert.deepEqual(paths, { runDir, materialsDir: path.join(runDir, "materials") });
    for (const p of Object.values(paths)) assert.ok(fs.statSync(p).isDirectory());
  });

  test("repos dir defaults to <harness>/repos and can be overridden", () => {
    assert.equal(reposDirFor({}), path.join(os.homedir(), ".pi-harness", "repos"));
    assert.equal(reposDirFor({ PI_HARNESS_REPOS_DIR: "/x/repos" }), "/x/repos");
  });
});

describe("listMaterials", () => {
  test("lists regular files directly in the dir in sorted order", () => {
    const m = dir("mats");
    for (const f of ["b.PNG", "a.md", "c.bin", "z.pdf"]) fs.writeFileSync(path.join(m, f), "x");
    fs.mkdirSync(path.join(m, "sub"));
    fs.writeFileSync(path.join(m, "sub", "nested.txt"), "x");
    assert.deepEqual(listMaterials(m), [
      { id: "M1", path: path.join(m, "a.md"), mediaType: "text/markdown", describe: "a.md", origin: { kind: "case" } },
      { id: "M2", path: path.join(m, "b.PNG"), mediaType: "image/png", describe: "b.PNG", origin: { kind: "case" } },
      { id: "M3", path: path.join(m, "c.bin"), mediaType: "application/octet-stream", describe: "c.bin", origin: { kind: "case" } },
      { id: "M4", path: path.join(m, "z.pdf"), mediaType: "application/pdf", describe: "z.pdf", origin: { kind: "case" } },
    ]);
  });

  test("an empty dir gives no materials; a missing dir fails", () => {
    assert.deepEqual(listMaterials(dir("empty-mats")), []);
    rejects(() => listMaterials(path.join(tmp, "no-such-mats")), /Materials directory .* does not exist/);
  });

  test("mediaTypeFor falls back to octet-stream", () => {
    assert.equal(mediaTypeFor("x.JPEG"), "image/jpeg");
    assert.equal(mediaTypeFor("README"), "application/octet-stream");
  });
});

describe("prepareRun", () => {
  function setup(name: string, config?: object) {
    const repo = gitRepo(name);
    const reposDir = dir(`${name}-repos`);
    if (config !== undefined) fs.writeFileSync(path.join(reposDir, `${path.basename(repo)}.json`), JSON.stringify(config));
    const home = dir(`${name}-home`);
    const lines: string[] = [];
    const opts: RunOptions = { repo, model: "p/m", mode: "fixed", message: "Fix it\n", passthrough: [] };
    return { repo, reposDir, home, lines, opts, ctx: { reposDir, home, say: (l: string) => lines.push(l) } };
  }

  test("builds and writes a fixed contract from the repo config into a new default run dir", async () => {
    const s = setup("cfg", {
      repoKey: "ignored-by-direct-lookup",
      completionSteps: [{ title: "Check", command: "node check.js", timeoutSec: 30 }],
    });
    const mats = dir("cfg-mats");
    fs.writeFileSync(path.join(mats, "spec.md"), "# spec");
    const p = await prepareRun({ ...s.opts, materialsDir: mats }, s.ctx);
    assert.equal(path.dirname(p.runDir), path.join(s.home, ".pi-harness", "runs"));
    const written = JSON.parse(fs.readFileSync(p.contractFile, "utf8"));
    assert.deepEqual(written, p.contract);
    assert.equal(written.source, "fixed");
    assert.equal(written.goal.original, "Fix it\n");
    assert.equal(written.repo.root, fs.realpathSync(s.repo));
    assert.equal(written.repo.branch, "main");
    assert.equal(written.repo.repoKey, path.basename(s.repo));
    assert.deepEqual(written.doneConditions.map((d: any) => [d.id, d.verify.command, d.verify.timeoutSec]), [["D1", "node check.js", 30]]);
    assert.deepEqual(written.materials.map((m: any) => m.path), [path.join(mats, "spec.md")]);
    assert.equal(written.runtime.model, "p/m");
    assert.deepEqual(written.paths, { runDir: p.runDir, materialsDir: path.join(p.runDir, "materials") });
    assert.ok(!s.lines.some((l) => l.startsWith("경고")));
  });

  test("a missing repo config warns in Korean and yields no done conditions", async () => {
    const s = setup("nocfg");
    const runDir = path.join(dir("nocfg-out"), "run");
    const p = await prepareRun({ ...s.opts, runDir }, s.ctx);
    assert.equal(p.runDir, runDir);
    assert.deepEqual(p.contract.doneConditions, []);
    assert.ok(s.lines.some((l) => l.startsWith("경고") && l.includes("설정 파일이")), s.lines.join("\n"));
  });

  test("refuses a run dir that already has a contract and an invalid repo config", async () => {
    const s = setup("reuse");
    const runDir = path.join(dir("reuse-out"), "run");
    await prepareRun({ ...s.opts, runDir }, s.ctx);
    await assert.rejects(prepareRun({ ...s.opts, runDir }, s.ctx), /already has a contract.json/);
    fs.writeFileSync(path.join(s.reposDir, `${path.basename(s.repo)}.json`), "{ not json");
    await assert.rejects(prepareRun(s.opts, s.ctx), (e: unknown) => e instanceof CliError && /not valid JSON/.test(e.message));
  });

  test("judge mode with a missing repo fails before creating a run dir", async () => {
    const s = setup("judge");
    await assert.rejects(prepareRun({ ...s.opts, mode: "judge", repo: path.join(tmp, "nowhere") }, s.ctx), /does not exist/);
    assert.equal(fs.existsSync(path.join(s.home, ".pi-harness")), false);
  });

  test("judge mode falls back to the repo config contract when the judge process fails", async () => {
    const s = setup("judge-fail", { repoKey: "x", completionSteps: [{ title: "Check", command: "node check.js", timeoutSec: 30 }] });
    const agent = dir("judge-fail-agent");
    const env: NodeJS.ProcessEnv = {
      ...process.env, HOME: s.home, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_HARNESS_CHILD_EXTRA_ARGS: "",
    };
    const runDir = path.join(dir("judge-fail-out"), "run");
    const p = await prepareRun({ ...s.opts, mode: "judge", runDir }, { ...s.ctx, env });
    assert.equal(p.contract.source, "fallback");
    assert.deepEqual(p.contract.effort, { level: "medium", decidedBy: "fallback" });
    assert.deepEqual(p.contract.doneConditions.map((d) => d.verify.kind === "command" ? d.verify.command : ""), ["node check.js"]);
    const judge = JSON.parse(fs.readFileSync(path.join(runDir, "judge.json"), "utf8"));
    assert.equal(judge.status, "failed");
    assert.equal(judge.fallback, true);
    assert.ok(typeof judge.error === "string" && judge.error.length > 0);
    assert.ok(fs.existsSync(path.join(runDir, "judge-input.json")));
    assert.ok(fs.existsSync(path.join(runDir, "judge.stderr.log")));
    assert.equal(fs.existsSync(path.join(runDir, "effort.json")), false);
    assert.ok(s.lines.some((l) => l.startsWith("판정 단계가 실패해 대체 계약을 사용합니다.")), s.lines.join("\n"));
  });
});
