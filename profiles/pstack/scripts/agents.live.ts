import { connectFixture } from "./criteria-fixture";
import { resolve } from "node:path";
import { existsSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { testHost, ready } from "./test-host";

const root = resolve(import.meta.dir, "..");
const expectedPath = resolve(root, "skills/poteto-mode/SKILL.md");
const requests: { stage: string; body: any }[] = [];
const calls = new Map<string, number>();
let stage = "initial";
const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: any = await request.json();
  requests.push({ stage, body });
  const count = calls.get(stage) ?? 0;
  calls.set(stage, count + 1);
  const system = body.messages.filter((message: any) => message.role === "system").map((message: any) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
  const path = system.match(/installed profile file at `([^`]+)`/)?.[1];
  const delta = count === 0
    ? { role: "assistant", tool_calls: [{ index: 0, id: `call_read_${stage}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path }) } }] }
    : { role: "assistant", content: "MODE_READ_COMPLETE" };
  const chunk = (value: any, finish: string | null) => ({ id: `agent-path-${stage}-${count}`, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason: finish }] });
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, count === 0 ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const installed = JSON.parse(readFileSync(resolve(root, "opencode.jsonc"), "utf8"));
const config = { ...installed, model: "pstack-test/gpt-parent#high", plugins: [resolve(root, "plugins/pstack"), resolve(import.meta.dir, "fixtures/probe"), { package: resolve(import.meta.dir, "fixtures/models"), options: { url: `http://127.0.0.1:${endpoint.port}/v1`, compactionText: "Continue the delegated fixture. No skill path is retained." } }] };
let host = await testHost(config, { preserve: true, skillSource: resolve(root, "skills") });
const directory = host.directory;
try {
  // Mirror native agent discovery, including the old layout if it is reintroduced.
  for (const name of ["agent", "agents", "mode", "modes", "agent-templates", "model-routing.md"]) {
    if (existsSync(resolve(root, name))) symlinkSync(resolve(root, name), resolve(host.profile, name));
  }
  async function activate() { for (const id of ["pstack", "pstack-test-models", "pstack-test-probe", "opencode.config.agent"]) await ready(host, id); }
  async function assertAgents() {
    const agents = (await host.client.agent.list({ location: { directory: host.project } })).data;
    const poteto = agents.filter(agent => agent.id === "poteto-agent");
    if (poteto.length !== 1 || !poteto[0].system?.includes(expectedPath) || poteto[0].system.includes("@PSTACK_MODE_FILE@")) throw new Error("Effective poteto-agent lost its bound skill path under native profile discovery");
    const source = readFileSync(resolve(root, "agent-templates/comment-sicko.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    if (agents.filter(agent => agent.id === "comment-sicko").length !== 1 || agents.find(agent => agent.id === "comment-sicko")?.system?.trim() !== source) throw new Error("Comment Sicko registration changed");
  }
  await activate(); await assertAgents();
  const parent = await host.client.session.create({ location: { directory: host.project }, agent: "pstack" });
  connectFixture(host.project);
  const delegated: any = await host.client.rpc.call({ rpcID: "pstack-test-probe", method: "call", location: { directory: host.project }, input: { tool: "subagent", sessionID: parent.id, args: { agent: "poteto-agent", role: "feature, refactoring", model: "pstack-test/gpt-parent#high", background: false, description: "Read mode without a parent path", prompt: "PSTACK_INITIAL. Read your required mode file, then return MODE_READ_COMPLETE." } } });
  if (delegated.output.toolError) throw new Error(delegated.output.toolError);
  const children = (await host.client.session.list({ parentID: parent.id, limit: 10 })).data;
  if (children.length !== 1) throw new Error("Expected one native poteto child");
  const child = children[0];
  const wait = () => host.client.session.wait({ sessionID: child.id }, { signal: AbortSignal.timeout(15000) });
  async function assertRead() {
    const context = await host.client.session.context({ sessionID: child.id });
    const reads = context.flatMap((message: any) => message.type === "assistant" ? message.content.filter((part: any) => part.type === "tool" && part.name === "read") : []);
    const read = reads.at(-1);
    if (read?.state.status !== "completed" || realpathSync(read.state.input.path) !== realpathSync(expectedPath)) throw new Error(`${stage}: native read did not open the installed mode: ${JSON.stringify(read?.state)}`);
    const wire = requests.filter(request => request.stage === stage);
    if (wire.length !== 2 || !JSON.stringify(wire[1].body.messages).includes("# Poteto mode")) throw new Error(`${stage}: the real read result did not reach the deterministic provider`);
  }
  await wait(); await assertRead();
  stage = "compaction";
  await host.client.session.compact({ sessionID: child.id }); await wait();
  if (!calls.has(stage)) { await host.client.session.prompt({ sessionID: child.id, text: "Continue the mode read." }); await wait(); }
  const compacted = JSON.stringify(await host.client.session.context({ sessionID: child.id }));
  if (compacted.includes("PSTACK_INITIAL") || !compacted.includes("No skill path is retained.")) throw new Error("Compaction fixture retained the initial prompt or missed the summary");
  await assertRead();
  await host.client.rpc.call({ rpcID: "pstack-test-probe", method: "reloadAgents", location: { directory: host.project }, input: {} });
  await assertAgents(); stage = "reload";
  await host.client.session.prompt({ sessionID: child.id, text: "Read the required mode again." }); await wait(); await assertRead();
  await host.close();
  host = await testHost(config, { directory, preserve: true, skillSource: resolve(root, "skills") });
  await activate(); await assertAgents(); stage = "restart";
  await host.client.session.prompt({ sessionID: child.id, text: "Read the required mode after restart." }); await wait(); await assertRead();
  writeFileSync(resolve(root, "provenance/agents-live.json"), JSON.stringify({ checkedAt: new Date().toISOString(), server: await host.client.server.info(), nativeProfileDiscovery: true, singleAgentRegistration: true, nativeChildReadWithoutParentPath: true, readAfterCompaction: true, readAfterAgentReload: true, readAfterServiceRestart: true, userPromptRemovedByCompaction: true, stages: [...calls.keys()], limits: "Isolated native service and database with a deterministic loopback provider. Verifies effective system paths and native read execution, not autonomous model judgment or automatic filesystem watching. The user's running service is not restarted." }, null, 2) + "\n");
  console.log("PASS profile agent discovery, native child read, compaction, agent reload and service restart");
} finally { await host.close(); endpoint.stop(true); rmSync(directory, { recursive: true, force: true }); }
