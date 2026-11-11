import { createHash } from "node:crypto";
import type { Context } from "@opencode/plugin/promise/plugin";
import { canonical } from "./workspaces";

/** Host storage is plugin-global. Programs/routines need an explicit workspace scope. */
export async function workspaceContext(ctx: Context): Promise<Context> {
  const prefix = `workspace/${createHash("sha256").update(await canonical(ctx.location.directory)).digest("hex")}/`;
  const storage = ctx.storage;
  return { ...ctx, storage: {
    get: key => storage.get(prefix + key),
    set: (key, value) => storage.set(prefix + key, value),
    remove: key => storage.remove(prefix + key),
    async scan(options) {
      const page = await storage.scan({ ...options, prefix: prefix + options.prefix });
      return { ...page, entries: page.entries.map(entry => ({ ...entry, key: entry.key.slice(prefix.length) })) };
    },
  } };
}
