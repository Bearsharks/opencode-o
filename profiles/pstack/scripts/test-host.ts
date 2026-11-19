import { OpenCode } from "@opencode/client";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** Disposable native host. All callers must await close() in a finally block. */
export async function testHost(config: object, options: { directory?: string; preserve?: boolean; skillSource?: string; apiProxy?: string } = {}) {
  const directory = options.directory ?? mkdtempSync(resolve(tmpdir(), "pstack-native-test-"));
  if (!directory.startsWith(resolve(tmpdir(), "pstack-native-test-"))) throw new Error("Test host must use its disposable directory");
  const project = resolve(directory, "project");
  const profile = resolve(directory, "profile");
  mkdirSync(project, { recursive: true }); mkdirSync(profile, { recursive: true });
  if (options.skillSource && !existsSync(resolve(profile, "skills"))) symlinkSync(options.skillSource, resolve(profile, "skills"), "dir");
  if (options.skillSource && !existsSync(resolve(profile, "bundled-skills"))) symlinkSync(options.skillSource, resolve(profile, "bundled-skills"), "dir");
  writeFileSync(resolve(profile, "opencode.json"), JSON.stringify(config));
  const portFile = resolve(directory, "api-port");
  let port: number;
  if (existsSync(portFile)) port = Number(readFileSync(portFile, "utf8"));
  else { const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }); port = reservation.port!; await reservation.stop(true); writeFileSync(portFile, String(port)); }
  const password = crypto.randomUUID();
  const env = { ...process.env, OPENCODE_O_PROFILE: "pstack", OPENCODE_CONFIG_DIR: profile,
    OPENCODE_CONFIG: resolve(profile, "opencode.json"), OPENCODE_CONFIG_CONTENT: "{}",
    XDG_CONFIG_HOME: resolve(directory, "config"), XDG_DATA_HOME: resolve(directory, "data"),
    XDG_STATE_HOME: resolve(directory, "state"), XDG_CACHE_HOME: resolve(directory, "cache"),
    OPENCODE_DB: "pstack-native-test.db", OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password, PSTACK_API_URL: options.apiProxy ?? `http://127.0.0.1:${port}` };
  const processHandle = Bun.spawn(["opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs"], { cwd: project, env, stdout: "pipe", stderr: "pipe" });
  let log = "";
  const read = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) log += new TextDecoder().decode(chunk); };
  const readers = [read(processHandle.stdout), read(processHandle.stderr)];
  const close = async () => { processHandle.kill(); await processHandle.exited; await Promise.all(readers); if (!options.preserve) rmSync(directory, { recursive: true, force: true }); };
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) return { directory, project, profile, close, log: () => log,
        run: (command: string[], extraEnv: Record<string, string> = {}) => Bun.spawn(command, { cwd: project, env: { ...env, ...extraEnv }, stdout: "pipe", stderr: "pipe" }),
        client: OpenCode.make({ baseUrl: url, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` } }) };
      if (processHandle.exitCode !== null) throw new Error(`Native host exited: ${log}`);
      await Bun.sleep(100);
    }
    throw new Error(`Native host readiness timed out: ${log}`);
  } catch (error) { await close(); throw error; }
}

export async function ready(host: Awaited<ReturnType<typeof testHost>>, id: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const plugins = (await host.client.plugin.list({ location: { directory: host.project } })).data;
    const entry = plugins.find(p => p.id === id);
    if (entry?.state.status === "active") return;
    if (entry?.state.status === "failed") throw new Error(JSON.stringify(entry));
    await Bun.sleep(100);
  }
  throw new Error(`Plugin ${id} did not activate: ${host.log()}`);
}
