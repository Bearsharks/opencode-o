import { execFile } from "node:child_process";
import { realpath, rmdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { worktrees } from "./workspaces";

const exec = promisify(execFile);
export async function reviewDirectory(cwd: string, sessionID: string) {
  if (!/^[\w-]+$/.test(sessionID)) throw Error("Invalid Shipping session ID");
  const { stdout } = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  return join(await realpath(stdout.trimEnd()), "pstack-review-" + sessionID);
}

export async function cleanReviewWorktrees(cwd: string, sessionID: string) {
  const removed: string[] = [];
  const retained: { path: string; reason: string }[] = [];
  let root = cwd;
  try {
    root = await reviewDirectory(cwd, sessionID);
    const [, ...linked] = await worktrees(cwd);
    const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
    const caller = await realpath(stdout.trimEnd());
    for (const path of linked.filter((path) => dirname(path) === root && path !== caller)) {
      try {
        const head = /^([a-f0-9]{40})-/.exec(basename(path))?.[1];
        const { stdout: status } = await exec(
          "git",
          [
            "status",
            "--porcelain=v2",
            "--branch",
            "--no-show-stash",
            "--untracked-files=all",
            "--ignored=matching",
            "--ignore-submodules=none",
          ],
          { cwd: path },
        );
        if (!head || status.trimEnd() !== `# branch.oid ${head}\n# branch.head (detached)`)
          throw Error("Checkout or files have changed since creation.");
        await exec("git", ["worktree", "remove", "--", path], { cwd });
        removed.push(path);
      } catch (error) {
        retained.push({ path, reason: String(error) });
      }
    }
    try {
      await rmdir(root); // Only remove an empty session directory.
    } catch (error: any) {
      if (error.code === "ENOTEMPTY" || error.code === "EEXIST") {
        if (!retained.length) retained.push({ path: root, reason: "Review directory still contains files." });
      } else if (error.code !== "ENOENT") throw error;
    }
  } catch (error) {
    retained.push({ path: root, reason: String(error) });
  }
  return { removed, retained };
}
