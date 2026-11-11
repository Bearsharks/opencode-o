import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Context } from "@opencode/plugin/promise/plugin";
import { localClient } from "./api";
import { canonical, worktrees } from "./workspaces";

export async function installHistory(ctx: Context) {
  const inScope = async (session: any, directory: string, related = false, projectID?: string) => {
    if (projectID) return session.projectID === projectID;
    if (!session.location?.directory) return false;
    const target = await canonical(session.location.directory);
    if (target === directory) return true;
    return related && (await Promise.all((await worktrees(directory)).map(canonical))).includes(target);
  };
  await ctx.tool.transform(editor => editor.add({ name: "pstack_history",
    description: "Scoped full conversation history, including before compaction. Current identifies this chat; list sorts candidates by real updated times, search returns only matching messages, export writes a private JSONL for reviewers. Follow pagination for list/read/search. Only use another workspace or repository-wide scope when the user's stated scope authorizes it.", options: { codemode: false },
    input: { type: "object", properties: { action: { enum: ["current", "list", "read", "search", "export"] }, sessionID: { type: "string" }, workspace: { type: "string", description: "Only set for a workspace explicitly requested by the user." }, repositoryHistory: { type: "boolean", description: "Use the native repository project ID, including retired worktrees, only for repository-wide requests." }, relatedWorktrees: { type: "boolean", description: "Include only currently registered worktrees of this Git repository." }, query: { type: "string", description: "Literal case-insensitive message search." }, cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }, since: { type: "string", description: "ISO timestamp; retain sessions updated since this point." } }, required: ["action"], additionalProperties: false },
    output: { type: "object" }, async execute(input: any, context) {
      if (input.action === "current") return { output: JSON.parse(JSON.stringify({ session: await ctx.session.get({ sessionID: context.sessionID }), now: new Date().toISOString() })) };
      const requestedDirectory = input.workspace ?? ctx.location.directory;
      const directory = await canonical(requestedDirectory);
      let projectID: string | undefined;
      if (input.repositoryHistory) {
        await worktrees(requestedDirectory);
        projectID = (await (await localClient()).location.get({ directory: requestedDirectory })).project.id;
        if (projectID === "global") throw new Error("Repository history requires a native Git project identity");
      }
      if (["read", "search", "export"].includes(input.action)) {
        if (!input.sessionID) throw new Error("sessionID is required");
        const session = await ctx.session.get({ sessionID: input.sessionID });
        if (!await inScope(session, directory, input.relatedWorktrees, projectID)) throw new Error("The requested session is outside the active workspace scope");
        const api = await localClient();
        const remote = await api.session.get({ sessionID: session.id });
        if (remote.projectID !== session.projectID || !await inScope(remote, directory, input.relatedWorktrees, projectID)) throw new Error("History endpoint does not match this workspace");
        if (input.action === "export") {
          const messages = []; let cursor: string | undefined;
          do { const page = await api.message.list({ sessionID: session.id, order: cursor ? undefined : "asc", cursor, limit: 100 }); messages.push(...page.data); cursor = page.cursor.next ?? undefined; } while (cursor);
          const folder = await mkdtemp(resolve(tmpdir(), "pstack-history-"));
          const path = resolve(folder, `${session.id}.jsonl`);
          await writeFile(path, messages.map(message => JSON.stringify(message)).join("\n") + "\n", { mode: 0o600 });
          return { output: { directory, sessionID: session.id, path, messages: messages.length } };
        }
        const page = await api.message.list({ sessionID: session.id, order: input.cursor ? undefined : "asc", cursor: input.cursor, limit: input.limit ?? 100 });
        if (input.action === "search" && !input.query?.trim()) throw new Error("A literal topic query is required");
        const messages = input.action === "search" ? page.data.filter(message => JSON.stringify(message).toLowerCase().includes(input.query.toLowerCase())) : page.data;
        return { output: { directory, sessionID: session.id, messages: JSON.parse(JSON.stringify(messages)), cursor: page.cursor.next ?? null } };
      }
      const since = input.since === undefined ? 0 : Date.parse(input.since);
      if (!Number.isFinite(since)) throw new Error("since must be an ISO timestamp");
      const query: any = { directory: requestedDirectory, limit: input.limit ?? 30, cursor: input.cursor, order: input.cursor ? undefined : "desc" };
      if (input.relatedWorktrees || projectID) {
        await worktrees(requestedDirectory);
        const location = await (await localClient()).location.get({ directory: requestedDirectory });
        if (location.project.id === "global") throw new Error("Related-worktree reads require a repository-scoped project");
        delete query.directory; query.project = location.project.id;
      }
      const page = await ctx.session.list(query);
      const sessions = [];
      for (const session of page.data) if (await inScope(session, directory, input.relatedWorktrees, projectID) && session.time.updated >= since) sessions.push({ id: session.id, title: session.title, time: session.time, parentID: session.parentID });
      sessions.sort((a, b) => b.time.updated - a.time.updated);
      return { output: { directory, projectID: projectID ?? null, currentSessionID: context.sessionID, sessions: JSON.parse(JSON.stringify(sessions)), cursor: page.cursor.next ?? null } };
    },
  }));
}
