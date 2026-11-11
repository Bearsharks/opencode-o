import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { parseConfig, roles, type Config } from "./models";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export async function setupState(path: string) {
  let text: string;
  try { text = await readFile(path, "utf8"); } catch (e: any) { if (e.code === "ENOENT") return { config: { version: 1 } as Config, dropped: [], revision: null }; throw e; }
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || (value.roles !== undefined && (!value.roles || Array.isArray(value.roles) || typeof value.roles !== "object"))) throw new Error("Invalid model configuration object");
  const dropped = Object.entries(value.roles ?? {}).filter(([role]) => !Object.hasOwn(roles, role)).map(([role, model]) => ({ role, model }));
  const config = parseConfig({ ...value, roles: Object.fromEntries(Object.entries(value.roles ?? {}).filter(([role]) => Object.hasOwn(roles, role))) });
  return { config, dropped, revision: hash(text) };
}
const queueKey = Symbol.for("opencode-o.pstack.model-config-writes");
const writes: Map<string, Promise<unknown>> = (globalThis as any)[queueKey] ??= new Map();
export function saveConfig(path: string, config: Config, expectedRevision: string | null) {
  const task = (writes.get(path) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const state = await setupState(path);
    if (state.revision !== expectedRevision) throw new Error("Model settings changed since review; reload and reconcile before saving");
    const text = JSON.stringify(config, null, 2) + "\n";
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try { await writeFile(temporary, text, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
    return { path, revision: hash(text), config };
  });
  writes.set(path, task);
  return task.finally(() => { if (writes.get(path) === task) writes.delete(path); });
}
