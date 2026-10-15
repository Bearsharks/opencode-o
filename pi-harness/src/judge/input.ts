import fs from "node:fs";
import path from "node:path";
import { getAgentDir, loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import type { RepoConfig } from "../config/repo-config.ts";
import type { Contract, Material } from "../contract/schema.ts";

export const MAX_INVALID_SUBMISSIONS = 3;

export type RuleFile = { path: string; scope: "repo" | "ancestor" };

export type JudgeInput = {
  schemaVersion: 1;
  original: string;
  repo: Contract["repo"];
  repoConfig: RepoConfig | null;
  userRulesPath: string | null;
  ruleFiles: RuleFile[];
  materials: Material[];
  paths: Contract["paths"];
  model: string;
  mcp: boolean;
  maxInvalidSubmissions: number;
  attachedImages?: number;
};

export type BuildJudgeInputOptions = {
  original: string;
  repo: Contract["repo"];
  repoConfig: RepoConfig | null;
  materials: Material[];
  paths: Contract["paths"];
  model: string;
  mcp: boolean;
  agentDir?: string;
  attachedImages?: number;
};

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function discoverRuleFiles(root: string, agentDir: string): { userRulesPath: string | null; ruleFiles: RuleFile[] } {
  const realAgentDir = realpathOr(agentDir);
  const realRoot = realpathOr(root);
  let userRulesPath: string | null = null;
  const ruleFiles: RuleFile[] = [];
  for (const file of loadProjectContextFiles({ cwd: root, agentDir })) {
    const real = realpathOr(file.path);
    if (userRulesPath === null && path.dirname(real) === realAgentDir) {
      userRulesPath = file.path;
      continue;
    }
    ruleFiles.push({ path: file.path, scope: inside(realRoot, real) ? "repo" : "ancestor" });
  }
  return { userRulesPath, ruleFiles };
}

export function buildJudgeInput(opts: BuildJudgeInputOptions): JudgeInput {
  const { userRulesPath, ruleFiles } = discoverRuleFiles(opts.repo.root, opts.agentDir ?? getAgentDir());
  return {
    schemaVersion: 1,
    original: opts.original,
    repo: { ...opts.repo },
    repoConfig: opts.repoConfig,
    userRulesPath,
    ruleFiles,
    materials: opts.materials.map((m) => ({ ...m, origin: { ...m.origin } })),
    paths: { ...opts.paths },
    model: opts.model,
    mcp: opts.mcp,
    maxInvalidSubmissions: MAX_INVALID_SUBMISSIONS,
    ...(opts.attachedImages !== undefined && opts.attachedImages > 0 ? { attachedImages: opts.attachedImages } : {}),
  };
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
