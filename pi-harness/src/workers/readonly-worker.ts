import fs from "node:fs";
import path from "node:path";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, defineTool, getAgentDir, type ModelRegistry, ModelRuntime, SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Contract } from "../contract/schema.ts";

export const WORKER_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "submit_result"];
export const WORKER_MARKER = "<worker_task>";

export type WorkerTask = { title: string; prompt: string; paths?: string[] };
export type WorkerResult = { summary: string; findings?: string; evidence?: string[] };
export type WorkerStatus = "done" | "failed" | "aborted";
export type WorkerOutcome = {
  title: string;
  status: WorkerStatus;
  result?: WorkerResult;
  error?: string;
  sessionPath?: string;
  usage: Usage;
};

export type ParentModelAccess = {
  model: Model<Api> | undefined;
  modelRegistry: ModelRegistry;
  isProjectTrusted(): boolean;
};

export type RunWorkerOptions = {
  task: WorkerTask;
  contract: Contract;
  runDir: string;
  parent: ParentModelAccess;
  signal?: AbortSignal;
  agentDir?: string;
};

export const emptyUsage = (): Usage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export function addUsage(a: Usage, b: Usage | undefined): Usage {
  if (b === undefined) return a;
  const out: Usage = {
    input: a.input + (b.input ?? 0),
    output: a.output + (b.output ?? 0),
    cacheRead: a.cacheRead + (b.cacheRead ?? 0),
    cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
    totalTokens: a.totalTokens + (b.totalTokens ?? 0),
    cost: {
      input: a.cost.input + (b.cost?.input ?? 0),
      output: a.cost.output + (b.cost?.output ?? 0),
      cacheRead: a.cost.cacheRead + (b.cost?.cacheRead ?? 0),
      cacheWrite: a.cost.cacheWrite + (b.cost?.cacheWrite ?? 0),
      total: a.cost.total + (b.cost?.total ?? 0),
    },
  };
  if (a.reasoning !== undefined || b.reasoning !== undefined) out.reasoning = (a.reasoning ?? 0) + (b.reasoning ?? 0);
  if (a.cacheWrite1h !== undefined || b.cacheWrite1h !== undefined) out.cacheWrite1h = (a.cacheWrite1h ?? 0) + (b.cacheWrite1h ?? 0);
  return out;
}

export function workerSystemPrompt(contract: Contract, task: WorkerTask): string {
  const prohibitions = contract.prohibitions.length > 0
    ? contract.prohibitions.map((p) => `- ${p.id}: ${p.text}`).join("\n")
    : "- none";
  const paths = task.paths !== undefined && task.paths.length > 0 ? `\nStart with these paths: ${task.paths.join(", ")}` : "";
  return [
    WORKER_MARKER,
    "You are a read-only worker started by the main agent of this session. You can only read the repository with read, grep, find and ls. You cannot change files or run commands.",
    "Do only your task. When you are done, call submit_result once, alone, with a short summary, optional detailed findings, and the file paths that support them. If you cannot finish, say so in the summary.",
    "",
    "Goal of the session, verbatim from the user:",
    "<goal>",
    contract.goal.original,
    "</goal>",
    `Refined goal: ${contract.goal.refined}`,
    "",
    "Prohibitions of the session (never break them; if the task would need it, report that instead):",
    prohibitions,
    "",
    `Your task: ${task.title}`,
    `${task.prompt}${paths}`,
    "</worker_task>",
  ].join("\n");
}

function workerMessage(task: WorkerTask): string {
  const paths = task.paths !== undefined && task.paths.length > 0 ? `\nStart with these paths: ${task.paths.join(", ")}` : "";
  return `Task: ${task.title}\n${task.prompt}${paths}`;
}

export async function workerModelRuntime(parent: ParentModelAccess, model: Model<Api>, agentDir: string, signal?: AbortSignal): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    ...(signal !== undefined ? { signal } : {}),
  });
  const registry = parent.modelRegistry;
  for (const id of registry.getRegisteredProviderIds()) {
    const native = registry.getRegisteredNativeProvider(id);
    if (native !== undefined) {
      runtime.registerNativeProvider(native);
      continue;
    }
    const config = registry.getRegisteredProviderConfig(id);
    if (config !== undefined) runtime.registerProvider(id, config);
  }
  if (registry.getProviderAuthStatus(model.provider).source === "runtime") {
    const key = await registry.getApiKeyForProvider(model.provider);
    if (key !== undefined) await runtime.setRuntimeApiKey(model.provider, key);
  }
  return runtime;
}

const textOf = (m: AssistantMessage | undefined): string =>
  m === undefined ? "" : m.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n").trim();

export async function runWorker(opts: RunWorkerOptions): Promise<WorkerOutcome> {
  const { task, contract, signal } = opts;
  let usage = emptyUsage();
  const outcome = (status: WorkerStatus, extra: Partial<WorkerOutcome> = {}): WorkerOutcome =>
    ({ title: task.title, status, usage, ...extra });
  if (signal?.aborted) return outcome("aborted", { error: "aborted before the worker started" });
  const parentModel = opts.parent.model;
  if (parentModel === undefined) return outcome("failed", { error: "the main session has no model" });

  const agentDir = opts.agentDir ?? getAgentDir();
  const cwd = contract.repo.root;
  const workersDir = path.join(path.resolve(opts.runDir), "workers");
  fs.mkdirSync(workersDir, { recursive: true });

  let submitted: WorkerResult | undefined;
  const submitResult = defineTool({
    name: "submit_result",
    label: "Submit result",
    description: "Submit the result of your task and finish. Call it once, alone, as your last action.",
    promptSnippet: "Submit your task result and finish (call it alone, last)",
    parameters: Type.Object({
      summary: Type.String({ description: "Short answer to the task." }),
      findings: Type.Optional(Type.String({ description: "Detailed findings, if any." })),
      evidence: Type.Optional(Type.Array(Type.String(), { description: "File paths (optionally with line numbers) that support the result." })),
    }),
    async execute(_toolCallId, params) {
      submitted = {
        summary: params.summary,
        ...(params.findings !== undefined ? { findings: params.findings } : {}),
        ...(params.evidence !== undefined ? { evidence: params.evidence } : {}),
      };
      return { content: [{ type: "text", text: "Result submitted." }], details: undefined, terminate: true };
    },
  });

  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let sessionPath: string | undefined;
  let error: string | undefined;
  const onAbort = () => {
    void session?.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const modelRuntime = await workerModelRuntime(opts.parent, parentModel, agentDir, signal);
    const model = modelRuntime.getModel(parentModel.provider, parentModel.id) ?? parentModel;
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: opts.parent.isProjectTrusted() });
    const resourceLoader = new DefaultResourceLoader({
      cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      appendSystemPrompt: [workerSystemPrompt(contract, task)],
    });
    await resourceLoader.reload();
    const created = await createAgentSession({
      cwd, agentDir, modelRuntime, model,
      thinkingLevel: contract.runtime.workerThinkingLevel,
      tools: [...WORKER_TOOLS],
      customTools: [submitResult],
      resourceLoader,
      sessionManager: SessionManager.create(cwd, workersDir),
      settingsManager,
    });
    session = created.session;
    sessionPath = session.sessionFile;
    const extra = session.getActiveToolNames().filter((n) => !WORKER_TOOLS.includes(n));
    if (extra.length > 0) throw new Error(`worker session has tools outside the read-only set: ${extra.join(", ")}`);
    if (!session.getActiveToolNames().includes("submit_result")) throw new Error("worker session is missing submit_result");
    if (!signal?.aborted) await session.prompt(workerMessage(task));
  } catch (e) {
    error = (e as Error).message;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  let last: AssistantMessage | undefined;
  for (const m of session?.messages ?? []) {
    const msg = m as { role: string; usage?: Usage };
    if (msg.role === "assistant") last = m as AssistantMessage;
    if (msg.role === "assistant" || msg.role === "toolResult") usage = addUsage(usage, msg.usage);
  }
  sessionPath = session?.sessionFile ?? sessionPath;
  session?.dispose();
  const where = sessionPath !== undefined ? { sessionPath } : {};
  if (submitted !== undefined) return outcome("done", { ...where, result: submitted });
  if (signal?.aborted || last?.stopReason === "aborted") return outcome("aborted", { ...where, error: error ?? "aborted" });
  const reason = error
    ?? (last?.stopReason === "error" ? `model error: ${last.errorMessage ?? "unknown"}` : "the worker stopped without calling submit_result");
  const lastText = textOf(last);
  return outcome("failed", { ...where, error: lastText !== "" ? `${reason}. Last message: ${lastText.slice(0, 2000)}` : reason });
}
