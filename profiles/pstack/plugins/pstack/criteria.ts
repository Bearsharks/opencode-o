import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Context } from "@opencode/plugin/promise/plugin";

const exec = promisify(execFile);
export const configKey = "pstack.taskDoc";
export type Criteria = {
  path: string;
  text: string;
  head?: string;
  baseOid?: string;
  reviewDirectory?: string;
};
const git = async (cwd: string, ...args: string[]) =>
  (await exec("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 })).stdout.trimEnd();
function checkPath(path: string) {
  if (
    !path ||
    !/\.md$/i.test(path) ||
    /[:\x00-\x1f`\\]/.test(path) ||
    path !== path.trim() ||
    path.split("/").some((x) => !x || x === "." || x === "..")
  )
    throw Error("Invalid repository-relative task document: " + path);
  return path;
}
export async function taskPath(cwd: string) {
  // With the extension off Git silently treats --worktree as --local. Never inherit the shared key.
  let entry: string;
  try {
    entry = await git(cwd, "config", "--show-origin", "--get", configKey);
  } catch (e: any) {
    if (e.code === 1 || (e.code === 128 && /not a git repository/i.test(e.stderr))) return undefined;
    throw e;
  }
  const [origin, path] = entry.split("\t");
  if (!origin?.endsWith("/config.worktree") || !path)
    throw Error("Set pstack.taskDoc with git config --worktree after enabling extensions.worktreeConfig.");
  return checkPath(path);
}
export async function taskDocument(cwd: string, path: string, revision = "HEAD"): Promise<Criteria> {
  checkPath(path);
  if (revision !== "HEAD" && !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid PR head");
  const text = await git(cwd, "show", revision + ":" + path);
  if (!text.trim()) throw Error("Empty task document: " + path);
  return revision === "HEAD" ? { path, text } : { path, text, head: revision };
}
export async function criteriaFor(cwd: string) {
  const path = await taskPath(cwd);
  return path ? taskDocument(cwd, path) : undefined;
}
export async function shippingHandoff(
  ctx: Context,
  sessionID: Parameters<Context["session"]["context"]>[0]["sessionID"],
) {
  const message = (await ctx.session.context({ sessionID })).findLast(
    (m) => m.type === "user" && m.metadata?.shippingRequest,
  );
  if (message?.type !== "user") throw Error("No PR handoff in this Shipping session.");
  const handoff = JSON.parse(message.text);
  if (!/^[a-f0-9]{40}$/.test(handoff.baseOid ?? ""))
    throw Error("SHIPPING_STALE: Resubmit this PR to pin the reviewed base commit.");
  return handoff as {
    repo: string;
    pr: number;
    base: string;
    baseOid: string;
    head: string;
    path: string;
    reviewDirectory?: string;
  };
}
export async function delegationCriteria(ctx: Context, context: { agent: string; sessionID: any }) {
  if (context.agent === "shipping") {
    const { head, path, baseOid, reviewDirectory } = await shippingHandoff(ctx, context.sessionID);
    return { ...(await taskDocument(ctx.location.directory, path, head)), baseOid, reviewDirectory };
  }
  return criteriaFor(ctx.location.directory);
}
export function taskLine(path: string) {
  return "작업 기준: " + checkPath(path) + " — 현재 완료조건과 변경이력을 읽을 것.";
}
export async function installCriteria(ctx: Context) {
  await ctx.session.hook("context", async (event) => {
    if (event.agent === "shipping") return; // Its PR handoff identifies the reviewed revision.
    const path = await taskPath(ctx.location.directory);
    if (path && !(await ctx.session.get({ sessionID: event.sessionID })).parentID)
      event.system.push({ type: "text", text: taskLine(path) });
  });
}
export function prTaskPath(body: string) {
  const lines = body.split(/\r?\n/).filter((line) => /^Task-Doc:/i.test(line));
  if (lines.length !== 1)
    throw Error("The PR body must contain exactly one Task-Doc: <repository-relative path> line.");
  return checkPath(lines[0].slice("Task-Doc:".length).trim());
}
export type PrState = {
  body: string;
  state: string;
  url: string;
  baseRefName: string;
  baseRefOid: string;
  headRefOid: string;
  mergeCommit: { oid: string } | null;
};
export async function readPR(cwd: string, repo: string, pr: number): Promise<PrState> {
  const { stdout } = await exec(
    "gh",
    [
      "pr",
      "view",
      String(pr),
      "--repo",
      repo,
      "--json",
      "url,body,state,baseRefName,baseRefOid,headRefOid,mergeCommit",
    ],
    { cwd, timeout: 60_000 },
  );
  return JSON.parse(stdout);
}
export async function releaseMerged(cwd: string, path: string, head: string, base: string, pr: PrState) {
  if (
    pr.state !== "MERGED" ||
    pr.headRefOid !== head ||
    pr.baseRefName !== base ||
    !pr.mergeCommit?.oid ||
    prTaskPath(pr.body) !== path
  )
    throw Error("Merge unconfirmed for the submitted document, base and head; task link retained.");
  if ((await taskPath(cwd)) !== path || (await git(cwd, "rev-parse", "HEAD")) !== head) return false;
  try {
    await git(cwd, "config", "--worktree", "--fixed-value", "--unset", configKey, path);
    return true;
  } catch (e: any) {
    if (e.code === 5) return false;
    throw e;
  }
}
