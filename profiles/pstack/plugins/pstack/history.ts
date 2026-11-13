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
    description: "Scoped full conversation history, including before compaction. Current identifies this chat; list sorts candidates by real updated times, search without sessionID searches every session in the selected scope; with sessionID it searches only that conversation. read/export require sessionID; search requires query. Search limit caps matches, and bounded scan pages can be empty with a continuation cursor. Search returns matches containing sessionID, title and the native message (message.id), plus scope/source, cursor and complete. Only the current service/database is read; other profile databases are not searched. export writes a private JSONL for reviewers. Follow pagination for list/read/search. Only use another workspace or repository-wide scope when the user's stated scope authorizes it.", options: { codemode: false },
    input: { type: "object", properties: { action: { enum: ["current", "list", "read", "search", "export"] }, sessionID: { type: "string", description: "Required for read/export. Optional for search: omit for all sessions in scope, supply to search one conversation." }, workspace: { type: "string", description: "Only set for a workspace explicitly requested by the user." }, repositoryHistory: { type: "boolean", description: "Search/list across this Git repository, including retired worktrees, within the current service only. Does not select other profile databases." }, relatedWorktrees: { type: "boolean", description: "Include only currently registered worktrees of this Git repository." }, query: { type: "string", description: "Literal case-insensitive substring search across full native message records, including tool content and metadata." }, cursor: { type: "string", description: "Continue the same action, scope and query using its returned cursor. Search cursors expire after one hour." }, limit: { type: "integer", minimum: 1, maximum: 100, description: "For search, maximum matching messages per response; other actions use native page size." }, since: { type: "string", description: "ISO timestamp; retain sessions updated since this point." } }, required: ["action"], allOf: [{ if: { properties: { action: { enum: ["read", "export"] } } }, then: { required: ["sessionID"] } }, { if: { properties: { action: { const: "search" } } }, then: { required: ["query"] } }], additionalProperties: false },
    output: { type: "object", properties: {
      matches: { type: "array", items: { type: "object", properties: { sessionID: { type: "string" }, title: { type: "string" }, message: { type: "object" } }, required: ["sessionID", "message"] } },
      scope: { type: "object" }, source: { type: "object" }, cursor: { type: ["string", "null"] }, complete: { type: "boolean" },
    } }, async execute(input: any, context) {
      if (input.action === "current") return { output: JSON.parse(JSON.stringify({ session: await ctx.session.get({ sessionID: context.sessionID }), now: new Date().toISOString() })) };
      const requestedDirectory = input.workspace ?? ctx.location.directory;
      const directory = await canonical(requestedDirectory);
      let projectID: string | undefined;
      if (input.repositoryHistory) {
        await worktrees(requestedDirectory);
        projectID = (await (await localClient()).location.get({ directory: requestedDirectory })).project.id;
        if (projectID === "global") throw new Error("Repository history requires a native Git project identity");
      }
      if (input.action === "search") {
        if (!input.query?.trim()) throw new Error("search requires a nonempty query; sessionID is optional (omit it to search all sessions in scope)");
        const since = input.since === undefined ? 0 : Date.parse(input.since);
        if (!Number.isFinite(since)) throw new Error("since must be an ISO timestamp");
        const api = await localClient();
        const scope = { directory, projectID: projectID ?? null, relatedWorktrees: !!input.relatedWorktrees,
          sessionID: input.sessionID ?? null, since, query: input.query.toLowerCase() };
        const binding = JSON.stringify(scope);
        const prefix = "history-search/";
        type Position = { sessionCursor?: string; sessionID?: string; messageCursor?: string; offset: number; endSessions: boolean };
        let position: Position = { sessionID: input.sessionID, offset: 0, endSessions: !!input.sessionID };
        if (input.cursor) {
          if (!/^hs_[a-f0-9-]+$/.test(input.cursor)) throw new Error("Use the search cursor returned by this tool, with the same scope and query");
          const saved: any = await ctx.storage.get(prefix + input.cursor);
          if (!saved || saved.expires < Date.now() || saved.binding !== binding) throw new Error("Search cursor expired or belongs to a different scope/query; start a new search");
          position = { ...saved.position };
        } else {
          // Bound cleanup work; expired positions contain no transcript bodies.
          const old = await ctx.storage.scan({ prefix, limit: 100 });
          for (const entry of old.entries) if ((entry.value as any).expires < Date.now()) await ctx.storage.remove(entry.key);
        }
        const limit = input.limit ?? 30;
        const matches: any[] = [];
        let pages = 0, scannedMessages = 0;
        const scannedSessions = new Set<string>();
        while (matches.length < limit && pages < 20) {
          if (!position.sessionID) {
            if (position.endSessions) break;
            const query: any = { limit: 1, cursor: position.sessionCursor, order: position.sessionCursor ? undefined : "desc" };
            if (projectID || input.relatedWorktrees) {
              const location = await api.location.get({ directory: requestedDirectory });
              if (location.project.id === "global") throw new Error("Repository history requires a native Git project identity");
              query.project = location.project.id;
            } else query.directory = requestedDirectory;
            const page = await ctx.session.list(query); pages++;
            position.sessionCursor = page.cursor.next ?? undefined;
            position.endSessions = !position.sessionCursor;
            const candidate = page.data[0];
            if (!candidate || candidate.time.updated < since || !await inScope(candidate, directory, input.relatedWorktrees, projectID)) continue;
            position.sessionID = candidate.id; position.messageCursor = undefined; position.offset = 0;
          }
          if (pages >= 20) break;
          const session: any = await ctx.session.get({ sessionID: position.sessionID as any });
          if (!await inScope(session, directory, input.relatedWorktrees, projectID)) throw new Error("The requested session is outside the active workspace scope");
          const remote = await api.session.get({ sessionID: session.id });
          if (remote.projectID !== session.projectID || !await inScope(remote, directory, input.relatedWorktrees, projectID)) throw new Error("History endpoint does not match this workspace");
          scannedSessions.add(session.id);
          if (session.time.updated < since) { position.sessionID = undefined; continue; }
          const page = await api.message.list({ sessionID: session.id, order: position.messageCursor ? undefined : "asc", cursor: position.messageCursor, limit: 100 }); pages++;
          while (position.offset < page.data.length && matches.length < limit) {
            const message = page.data[position.offset++]; scannedMessages++;
            if (JSON.stringify(message).toLowerCase().includes(scope.query)) matches.push({ sessionID: session.id, title: session.title, message });
          }
          if (position.offset >= page.data.length) {
            position.offset = 0; position.messageCursor = page.cursor.next ?? undefined;
            if (!position.messageCursor) position.sessionID = undefined;
          }
        }
        let cursor: string | null = null;
        if (position.sessionID || !position.endSessions) {
          cursor = "hs_" + crypto.randomUUID();
          await ctx.storage.set(prefix + cursor, JSON.parse(JSON.stringify({ binding, position, expires: Date.now() + 3600000 })));
        }
        const server = await api.server.info();
        return { output: JSON.parse(JSON.stringify({ scope, source: { service: "current OpenCode service", serverPID: server.pid, version: server.version, profile: process.env.OPENCODE_O_PROFILE ?? null, configuredDatabase: process.env.OPENCODE_DB ?? null, otherDatabasesSearched: false },
          matches, ...(input.sessionID ? { sessionID: input.sessionID } : {}),
          scannedSessions: scannedSessions.size, scannedMessages, cursor, complete: cursor === null,
          notice: "Only this service's history was searched. Follow cursor even after an empty page; other profile databases are not searched." })) };
      }
      if (["read", "export"].includes(input.action)) {
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
        const messages = page.data;
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
