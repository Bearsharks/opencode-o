import { localClient } from "../plugins/pstack/api";
import { canonical, worktrees } from "../plugins/pstack/workspaces";
import { relative, resolve } from "node:path";

export function touches(value: unknown, path: string): boolean {
  if (typeof value === "string") {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`${escaped}(?=$|[\\s/'"\\\\])`).test(value);
  }
  return !!value && typeof value === "object" && Object.values(value).some(v => touches(v, path));
}
export async function collectUsage(repo: string) {
  const paths = await worktrees(repo);
  const allowed = new Map(await Promise.all(paths.map(async path => [await canonical(path), path] as const)));
  const api = await localClient();
  const location = await api.location.get({ directory: repo });
  if (location.project.id === "global") throw new Error("No repository-scoped session identity; cannot establish worktree usage");
  const active = await api.session.active();
  const usage = Object.fromEntries(paths.map(path => [path, { lastTs: 0, lastSession: "", active: false, pinned: false, sessions: [] as string[] }]));
  let cursor: string | undefined;
  do {
    const page = await api.session.list({ project: location.project.id, limit: 100, cursor });
    for (const session of page.data) {
      const ownPath = allowed.get(await canonical(session.location.directory));
      if (!ownPath) continue;
      const spellings = await Promise.all(paths.map(async path => {
        const alias = resolve(session.location.directory, relative(ownPath, path));
        return { path, variants: await canonical(alias) === await canonical(path) ? [path, alias] : [path] };
      }));
      const matched = new Set<string>([ownPath]);
      let messageCursor: string | undefined;
      do {
        const messages = await api.message.list({ sessionID: session.id, limit: 100, order: messageCursor ? undefined : "asc", cursor: messageCursor });
        for (const { path, variants } of spellings) if (variants.some(spelling => touches(messages.data, spelling))) matched.add(path);
        messageCursor = messages.cursor.next ?? undefined;
      } while (messageCursor);
      for (const path of matched) {
        const item = usage[path];
        item.sessions.push(session.id);
        item.active ||= !!active[session.id];
        item.pinned ||= session.metadata?.pinned === true;
        if (session.time.updated / 1000 >= item.lastTs) { item.lastTs = Math.floor(session.time.updated / 1000); item.lastSession = session.id; }
      }
    }
    cursor = page.cursor.next ?? undefined;
  } while (cursor);
  return { complete: true, worktrees: usage, pinnedNote: "Only explicit metadata pins are available through the API. Cross-check the user's pinned/sidebar set before deletion." };
}
if (import.meta.main) {
  try { console.log(JSON.stringify(await collectUsage(process.argv[2] ?? process.cwd()))); }
  catch (error: any) { console.error(`Worktree session audit unavailable: ${error.message}`); console.log(JSON.stringify({ complete: false, worktrees: {} })); process.exitCode = 1; }
}
