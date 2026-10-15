import type { Usage } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Contract } from "../contract/schema.ts";
import {
  addUsage, emptyUsage, type ParentModelAccess, runWorker, type RunWorkerOptions, type WorkerOutcome, type WorkerStatus, type WorkerTask,
} from "./readonly-worker.ts";

export type RunWorkerFn = (opts: RunWorkerOptions) => Promise<WorkerOutcome>;

export type WorkerTaskSummary = { title: string; status: WorkerStatus; sessionPath?: string; error?: string };
export type RunWorkersDetails = {
  cap: number;
  workers: Array<WorkerTaskSummary & Pick<WorkerOutcome, "result" | "usage">>;
  usage: Usage;
};

export type RunWorkersDeps = {
  contract: () => Contract;
  runDir: string;
  runWorker?: RunWorkerFn;
  agentDir?: string;
};

export async function runPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}

function formatOutcome(o: WorkerOutcome, i: number): string {
  const lines = [`## Worker ${i + 1}: ${o.title} (${o.status})`];
  if (o.result !== undefined) {
    lines.push(`Summary: ${o.result.summary}`);
    if (o.result.findings !== undefined && o.result.findings !== "") lines.push(`Findings:\n${o.result.findings}`);
    if (o.result.evidence !== undefined && o.result.evidence.length > 0) lines.push(`Evidence: ${o.result.evidence.join(", ")}`);
  }
  if (o.error !== undefined) lines.push(`Error: ${o.error}`);
  if (o.sessionPath !== undefined) lines.push(`Session: ${o.sessionPath}`);
  return lines.join("\n");
}

export function runWorkersTool(deps: RunWorkersDeps) {
  const run = deps.runWorker ?? runWorker;
  const capNow = deps.contract().runtime.workerCap;
  return defineTool({
    name: "run_workers",
    label: "Run workers",
    description: `Start read-only worker agents that run at the same time and report back. Each worker gets the session goal, the prohibitions and its own task; it can only read the repository (read, grep, find, ls) and cannot change files or run commands. Good for wide reading, independent investigations and reviewing your work from a fresh view. The worker cap of this session is ${capNow}: it is the number of tasks per call, and a call with more tasks is rejected. Returns each worker's summary, findings, evidence and session file.`,
    promptSnippet: "Start read-only worker agents in parallel for reading, investigation or review",
    promptGuidelines: [
      "run_workers starts read-only workers: they can read the repository but cannot edit files or run commands, so do changes and checks yourself.",
      "Use run_workers for wide reading, independent investigations, or a review of your changes; give each task a clear, self-contained prompt and the paths to start from.",
      `The worker cap (${capNow}) is the number of tasks per run_workers call; split larger work into several calls.`,
    ],
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        title: Type.String({ description: "Short name of the task." }),
        prompt: Type.String({ description: "Self-contained instructions for the worker." }),
        paths: Type.Optional(Type.Array(Type.String(), { description: "Files or directories to start from, relative to the repo root." })),
      }), { description: "Tasks to run, one worker each." }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const contract = deps.contract();
      const cap = contract.runtime.workerCap;
      const tasks: WorkerTask[] = params.tasks;
      if (cap <= 0) throw new Error("run_workers is not available in this session: the contract allows no workers.");
      if (tasks.length === 0) throw new Error("run_workers needs at least one task.");
      if (tasks.length > cap) {
        throw new Error(`run_workers accepts at most ${cap} tasks per call (the worker cap of this session), but got ${tasks.length}. Send at most ${cap} tasks, or merge or split them across calls.`);
      }
      const parent: ParentModelAccess = {
        model: ctx.model,
        modelRegistry: ctx.modelRegistry,
        isProjectTrusted: () => ctx.isProjectTrusted(),
      };
      const outcomes = await runPool(tasks, cap, async (task) => {
        if (signal?.aborted) return { title: task.title, status: "aborted" as const, error: "aborted before the worker started", usage: emptyUsage() };
        try {
          return await run({
            task, contract, runDir: deps.runDir, parent,
            ...(signal !== undefined ? { signal } : {}),
            ...(deps.agentDir !== undefined ? { agentDir: deps.agentDir } : {}),
          });
        } catch (e) {
          return { title: task.title, status: signal?.aborted ? "aborted" as const : "failed" as const, error: (e as Error).message, usage: emptyUsage() };
        }
      });
      const usage = outcomes.reduce((u, o) => addUsage(u, o.usage), emptyUsage());
      const details: RunWorkersDetails = {
        cap,
        workers: outcomes.map((o) => ({
          title: o.title, status: o.status, usage: o.usage,
          ...(o.sessionPath !== undefined ? { sessionPath: o.sessionPath } : {}),
          ...(o.error !== undefined ? { error: o.error } : {}),
          ...(o.result !== undefined ? { result: o.result } : {}),
        })),
        usage,
      };
      const counts = (s: WorkerStatus) => outcomes.filter((o) => o.status === s).length;
      const head = `${outcomes.length} worker(s) finished: ${counts("done")} done, ${counts("failed")} failed, ${counts("aborted")} aborted.`;
      return {
        content: [{ type: "text", text: [head, ...outcomes.map(formatOutcome)].join("\n\n") }],
        details,
        usage,
      };
    },
  });
}
