import type { Usage } from "@earendil-works/pi-ai";

export type ToolLogEntry = { tool: string; args: string; isError: boolean; durationMs?: number };

export const ARGS_LOG_LIMIT = 300;

export const zeroUsage = (): Usage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export function sumUsage(a: Usage, b: Partial<Usage> | undefined): Usage {
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
  return out;
}

export function argsSummary(args: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(args) ?? "";
  } catch {
    text = String(args);
  }
  return text.length > ARGS_LOG_LIMIT ? `${text.slice(0, ARGS_LOG_LIMIT)}...` : text;
}

export function resultText(result: unknown): string {
  const content = (result as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content.map((c: { type?: string; text?: string }) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
}

export type SessionTracker = {
  usage: Usage;
  toolLog: ToolLogEntry[];
  stopReason?: string;
  errorMessage?: string;
  lastText?: string;
};

type MinimalPi = {
  on(event: string, handler: (event: any, ctx: any) => unknown): unknown;
};

export function trackSession(pi: MinimalPi): SessionTracker {
  const tracker: SessionTracker = { usage: zeroUsage(), toolLog: [] };
  const started = new Map<string, { tool: string; args: string }>();
  pi.on("message_end", (event: { message: { role: string; usage?: Usage; stopReason?: string; errorMessage?: string; content?: unknown } }) => {
    const m = event.message;
    if (m.role !== "assistant") return;
    tracker.usage = sumUsage(tracker.usage, m.usage);
    if (m.stopReason !== undefined) tracker.stopReason = m.stopReason;
    if (m.errorMessage !== undefined) tracker.errorMessage = m.errorMessage;
    const text = resultText(m).trim();
    if (text !== "") tracker.lastText = text.slice(0, 2000);
  });
  pi.on("tool_execution_start", (event: { toolCallId: string; toolName: string; args: unknown }) => {
    started.set(event.toolCallId, { tool: event.toolName, args: argsSummary(event.args) });
  });
  pi.on("tool_execution_end", (event: { toolCallId: string; toolName: string; isError: boolean; durationMs?: number }) => {
    const s = started.get(event.toolCallId);
    started.delete(event.toolCallId);
    const entry: ToolLogEntry = { tool: event.toolName, args: s?.args ?? "", isError: event.isError };
    if (event.durationMs !== undefined) entry.durationMs = event.durationMs;
    tracker.toolLog.push(entry);
  });
  return tracker;
}

export function stopDescription(t: SessionTracker, what: string): string {
  const base = t.stopReason === "error"
    ? `model error: ${t.errorMessage ?? "unknown"}`
    : t.stopReason === "aborted"
      ? "the run was aborted"
      : `the model stopped without calling ${what}`;
  return t.lastText !== undefined && t.stopReason !== "error" ? `${base}. Last message: ${t.lastText.slice(0, 500)}` : base;
}
