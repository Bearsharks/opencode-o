import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function fixtureGit(directory: string, ...args: string[]) {
  return execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-c", "commit.gpgsign=false", ...args],
    { cwd: directory, stdio: "pipe", encoding: "utf8" },
  ).trim();
}
export function connectFixture(
  directory: string,
  text = "Verify the requested behavior.",
  path = "docs/tasks/fixture.md",
) {
  const git = (...args: string[]) => fixtureGit(directory, ...args);
  if (!existsSync(join(directory, ".git"))) git("init", "-q");
  git("config", "--local", "extensions.worktreeConfig", "true");
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(
    join(directory, path),
    "# 현재 완료조건\n" + text + "\n\n## 변경이력\n- 사용자 결정: 시험용 기획 확정.\n",
  );
  git("add", path);
  git("commit", "--allow-empty", "-qm", "Task document");
  git("config", "--worktree", "pstack.taskDoc", path);
  return { path, head: git("rev-parse", "HEAD") };
}
