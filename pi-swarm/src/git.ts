import { execFileSync } from "node:child_process";
import fs from "node:fs";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

export type RepoInfo = { repoRoot: string; baseBranch: string };

export function ensureRepo(cwd: string): RepoInfo {
  if (tryGit(cwd, ["rev-parse", "--show-toplevel"]) === undefined) git(cwd, ["init", "-b", "main"]);
  const repoRoot = fs.realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
  if (tryGit(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]) === undefined) {
    git(repoRoot, ["commit", "--allow-empty", "-m", "init"]);
  }
  const baseBranch = tryGit(repoRoot, ["symbolic-ref", "--short", "HEAD"]);
  if (baseBranch === undefined) throw new Error(`${repoRoot}에 체크아웃된 브랜치가 없습니다(detached HEAD).`);
  return { repoRoot, baseBranch };
}

export function addWorktree(repoRoot: string, worktree: string, branch: string, base: string): void {
  git(repoRoot, ["worktree", "add", "-b", branch, worktree, base]);
}
