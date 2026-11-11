import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { ROLE_DEFINITIONS } from "../plugins/pstack/roles"

// Deterministic loopback provider exercises the real model→tool→subagent path.
// No credentials, hosted inference, repository modifications, or PRs are used.
const root = resolve(import.meta.dir, "../../..")
const box = mkdtempSync(join(tmpdir(), "pstack-model-routing-"))
for (const path of ["profile", "project", "state", "data", "config", "cache"]) mkdirSync(join(box, path))
const profile = join(box, "profile")
const requests: any[] = []
const roles = ["arena-runners", "how-explorer", "how-explainer", "arena-cross-judge-pool"]
const calls = new Map<string, any>()
let step = 0
const mock = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  if (!req.url.endsWith("/chat/completions")) return new Response("unknown fixture endpoint", { status: 404 })
  const body = await req.json() as any
  requests.push({ model: body.model, effort: body.reasoning_effort, messages: body.messages })
  let message: any = { role: "assistant", content: "CHILD_DONE" }
  if (body.model === "parent" && !body.messages.some((m: any) => m.role === "user" && JSON.stringify(m.content).includes("Return CHILD_DONE only"))) {
    if (step++ === 0) {
      message = { role: "assistant", content: null, tool_calls: roles.map((role, index) => {
        const id = `resolve_${index}`; calls.set(id, role)
        return { id, type: "function", function: { name: "pstack_models", arguments: JSON.stringify({ action: "resolve", role }) } }
      }) }
    } else if (step === 2) {
      const plans = body.messages.filter((m: any) => m.role === "tool" && calls.has(m.tool_call_id)).map((m: any) => JSON.parse(m.content))
      assert.equal(plans.length, roles.length, "all role plans must reach the model")
      assert(plans.every((p:any)=>Array.isArray(p.calls)), "role tool errors: " + JSON.stringify(plans))
      const nativeCalls = plans.flatMap((plan: any) => plan.calls.map((call: any) => ({
        id: `child_${plan.role.replace(/-/g, "_")}_${call.seat}`, type: "function",
        function: { name: "subagent", arguments: JSON.stringify({ agent: call.agent,
          description: call.descriptionPrefix + " fixture proof", prompt: "Return CHILD_DONE only. This is a disposable local routing test.",
          background: false, model: "fixture/wrong-model-to-be-overridden" }) },
      })))
      assert.equal(nativeCalls.length, 7)
      message = { role: "assistant", content: null, tool_calls: nativeCalls }
    } else message = { role: "assistant", content: "PSTACK_ROUTING_DONE" }
  }
  const finish_reason = message.tool_calls ? "tool_calls" : "stop"
  if (!body.stream) return Response.json({ id: "fixture", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  const delta = message.tool_calls ? { role: "assistant", tool_calls: message.tool_calls.map((c: any, index: number) => ({ index, ...c })) } : { role: "assistant", content: message.content }
  const chunk = (delta: any, reason: any = null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`
  return new Response(chunk(delta) + chunk({}, finish_reason) + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } })
} })
const provider = join(profile, "plugins/fixture")
mkdirSync(provider, { recursive: true })
writeFileSync(join(provider, "index.ts"), `
import { Plugin, Provider, Model } from "@opencode/plugin"
import { appendFileSync } from "node:fs"
export default Plugin.define({ id: "pstack.fixture", async setup(ctx) {
 const models = ["parent", "code", "judge"].map(id => ({ ...Model.Info.default("fixture", id), family: id === "parent" ? "gpt" : id === "code" ? "grok" : "claude",
  variants: (id === "code" ? ["low","medium","high","xhigh"] : ["low","medium","high","xhigh","max"]).map(id => ({id,settings:{reasoningEffort:id}})) }))
 await ctx.provider.transform(editor => editor.add({ info: { ...Provider.Info.empty("fixture"), activation:"enabled", package:"@opencode/ai/providers/openai-compatible", settings:{baseURL:${JSON.stringify(mock.url.href + "v1")},apiKey:"fixture-not-a-secret"} }, models }))
 await ctx.session.hook("context", event => { appendFileSync(${JSON.stringify(join(box, "contexts.jsonl"))}, JSON.stringify({sessionID:event.sessionID,agent:event.agent,model:event.model,options:event.options})+"\\n") })
 await ctx.session.hook("title", event => { event.result = "Fixture" })
}})
`)
writeFileSync(join(profile, "opencode.jsonc"), JSON.stringify({ default_agent: "pstack", model: "fixture/parent", plugins: [join(root, "profiles/pstack/plugins/pstack"), provider], experimental: { subagent_depth: 3 }, permissions: [{ action: "*", resource: "*", effect: "allow" }] }))
symlinkSync(join(root, "profiles/pstack/agents"), join(profile, "agents"))
const config = { version: 1, budget: "unlimited", roles: Object.fromEntries(ROLE_DEFINITIONS.map(([id,,,kind]) => [id, kind === "single" ? "inherit-parent" : ["inherit-parent"]])) }
Object.assign(config.roles, { "arena-runners": ["fixture/code", "fixture/judge", "fixture/code", "auto"], "how-explorer": "fixture/code", "how-explainer": "fixture/judge", "arena-cross-judge-pool": ["auto", "fixture/parent", "fixture/judge", "fixture/code"] })
writeFileSync(join(profile, "pstack-models.json"), JSON.stringify(config))
const env = Object.fromEntries(["HOME", "PATH", "TMPDIR", "LANG", "SHELL"].filter(k => process.env[k]).map(k => [k, process.env[k]]))
Object.assign(env, { OPENCODE_CONFIG_DIR: profile, OPENCODE_O_PROFILE: "pstack", OPENCODE_DB: ":memory:", XDG_STATE_HOME: join(box,"state"), XDG_DATA_HOME: join(box,"data"), XDG_CONFIG_HOME: join(box,"config"), XDG_CACHE_HOME: join(box,"cache") })
const proc = Bun.spawn(["opencode", "serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"], { cwd: join(box,"project"), env, stdout:"pipe", stderr:"pipe" })
let log = "", errors = ""
void (async () => {for await (const c of proc.stdout) log += new TextDecoder().decode(c)})()
void (async () => {for await (const c of proc.stderr) errors += new TextDecoder().decode(c)})()
try {
  const start = Date.now()
  while (!log.includes("server password ") && Date.now()-start < 15000) await Bun.sleep(100)
  const url = log.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
  const password = log.match(/server password (\S+)/)?.[1]
  assert(url && password, "private server startup")
  const headers = { Authorization: "Basic "+btoa("opencode:"+password), "Content-Type":"application/json" }
  async function api(path: string, body?: unknown) {
    const r = await fetch(url + path, {headers, method:body===undefined?"GET":"POST",body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
    assert(r.ok, `${path} HTTP ${r.status}`);return r.status===204 ? null : r.json() as any
  }
  for (let i=0;i<80;i++) { const p=await api("/api/plugin");if(p.data.some((x:any)=>x.id==="pstack.fixture"&&x.state?.status==="active")) break;await Bun.sleep(100) }
  const plugins=await api("/api/plugin")
  if (plugins.data.some((x:any)=>x.state?.status==="failed")) console.log(errors.split("\n").filter(line=>!/password|authorization|token/i.test(line)).slice(-20).join("\n"))
  assert(!plugins.data.some((x:any)=>x.state?.status==="failed"), JSON.stringify(plugins.data.filter((x:any)=>x.state?.status==="failed")))
  assert(plugins.data.some((p:any)=>p.id==="pstack.fixture"&&p.state?.status==="active"), "fixture provider plugin must activate: " + JSON.stringify(plugins.data.filter((p:any)=>p.source?.type!=="builtin")))
  const session=(await api("/api/session",{agent:"pstack",model:{providerID:"fixture",id:"parent",variant:"high"}})).data
  await api(`/api/session/${session.id}/prompt`,{text:"Run the deterministic routing fixture.",resume:true})
  let history:any
  for(let i=0;i<300;i++) {
    history=await api(`/api/session/${session.id}/message`)
    const state=(await api(`/api/session/${session.id}`)).data
    if(state.outcome==="succeeded" && JSON.stringify(history).includes("PSTACK_ROUTING_DONE")) break
    if(state.outcome==="failed") throw new Error("Fixture parent failed: "+JSON.stringify(history).slice(-1800))
    await Bun.sleep(100)
  }
  assert(JSON.stringify(history).includes("PSTACK_ROUTING_DONE"), "parent must collect real child results")
  const children=(await api(`/api/session?parentID=${session.id}`)).data
  assert.equal(children.length,7)
  const actual=children.map((c:any)=>`${c.model.providerID}/${c.model.id}#${c.model.variant}`).sort()
  assert.deepEqual(actual,["fixture/code#xhigh","fixture/code#xhigh","fixture/code#xhigh","fixture/judge#max","fixture/judge#max","fixture/judge#max","fixture/parent#high"].sort())
  assert(!requests.some(r=>r.model.includes("wrong-model")))
  const contexts = readFileSync(join(box, "contexts.jsonl"), "utf8").trim().split("\n").map(line=>JSON.parse(line))
  for (const child of children) {
    const context = contexts.find(c=>c.sessionID===child.id)
    assert(context, "each child must reach a real model request")
    assert.equal(context.model.variant, child.model.variant)
    assert(requests.filter(r=>r.model===child.model.id).every(r=>r.effort===child.model.variant), "native variant must reach the provider reasoning_effort field")
  }
  console.log("PASS real OpenCode subagent calls create 7 children with ordered panel seats, duplicate seats, exact parent alias, distinct role models, budget variants and cross-family judge")
  console.log("PASS wrong model arguments are replaced before native execution and selected reasoning effort reaches provider requests; only loopback fixture inference used")
} finally {
  proc.kill();await proc.exited;mock.stop(true)
  rmSync(box,{recursive:true,force:true})
}
