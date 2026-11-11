import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

export const canonical = (path: string) => realpath(path).catch(() => resolve(path));
export async function worktrees(directory: string): Promise<string[]> {
  const { stdout } = await promisify(execFile)("git", ["-C", directory, "worktree", "list", "--porcelain", "-z"], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.split("\0").filter(part => part.startsWith("worktree ")).map(part => part.slice(9));
}
