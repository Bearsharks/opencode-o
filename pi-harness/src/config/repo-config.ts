import fs from "node:fs";
import path from "node:path";
import { type Static, Type } from "typebox";
import { schemaErrors } from "../contract/validate.ts";

const strict = { additionalProperties: false } as const;

export const RepoConfigSchema = Type.Object({
  repoKey: Type.String({ minLength: 1 }),
  match: Type.Optional(Type.Object({
    remotes: Type.Optional(Type.Array(Type.String())),
    dirNames: Type.Optional(Type.Array(Type.String())),
  }, strict)),
  completionSteps: Type.Array(Type.Object({
    title: Type.String({ minLength: 1 }),
    statement: Type.Optional(Type.String()),
    command: Type.String({ minLength: 1 }),
    cwd: Type.Optional(Type.String()),
    timeoutSec: Type.Optional(Type.Integer({ minimum: 1 })),
    equivalents: Type.Optional(Type.Array(Type.String())),
  }, strict)),
  rules: Type.Optional(Type.String()),
}, strict);
export type RepoConfig = Static<typeof RepoConfigSchema>;

function normalizeRemote(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
}

export function repoKeyFor(root: string, remoteUrl?: string): string {
  if (remoteUrl !== undefined && remoteUrl.trim() !== "") {
    const segments = normalizeRemote(remoteUrl).split(/[/:]/);
    const last = segments[segments.length - 1];
    if (last !== undefined && last !== "") return last;
  }
  return path.basename(path.resolve(root));
}

function readRepoConfig(file: string): RepoConfig {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Repo config ${file} is not valid JSON: ${(e as Error).message}`);
  }
  const errors = schemaErrors(RepoConfigSchema, data, "config");
  if (errors.length > 0) throw new Error(`Repo config ${file} is invalid:\n- ${errors.join("\n- ")}`);
  return data as RepoConfig;
}

export function loadRepoConfig(reposDir: string, repoKey: string, remoteUrl?: string, root?: string): RepoConfig | null {
  const direct = path.join(reposDir, `${repoKey}.json`);
  if (fs.existsSync(direct)) return readRepoConfig(direct);
  if (!fs.existsSync(reposDir)) return null;
  const remote = remoteUrl !== undefined && remoteUrl.trim() !== "" ? normalizeRemote(remoteUrl) : undefined;
  const dirName = root !== undefined ? path.basename(path.resolve(root)) : undefined;
  const files = fs.readdirSync(reposDir).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const config = readRepoConfig(path.join(reposDir, f));
    const remotes = config.match?.remotes ?? [];
    const dirNames = config.match?.dirNames ?? [];
    if (remote !== undefined && remotes.some((r) => normalizeRemote(r) === remote)) return config;
    if (dirName !== undefined && dirNames.includes(dirName)) return config;
  }
  return null;
}
