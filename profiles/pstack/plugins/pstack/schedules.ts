import type { Context } from "@opencode/plugin/promise/plugin";
import { canonical } from "./workspaces";

type Job = { id: string; sessionID: string; directory: string; prompt: string; nextAt?: number; intervalMs?: number; event?: { type: string; sessionID?: string; match?: Record<string, string | number | boolean> }; status: "active" | "completed" | "cancelled"; fires: number; lastError?: string };
const clean = (value: unknown) => JSON.parse(JSON.stringify(value));
async function createScheduler(ctx: Context) {
  const jobs = new Map<string, Job>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const operations = new Map<string, Promise<unknown>>();
  const eventTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const controller = new AbortController();
  const key = (id: string) => `schedules/${id}`;
  let closed = false;
  let after: string | undefined;
  do { const page = await ctx.storage.scan({ prefix: "schedules/", after, limit: 100 }); for (const item of page.entries) { const job = item.value as unknown as Job; jobs.set(job.id, job); } after = page.next; } while (after);

  function serial<T>(id: string, task: () => Promise<T>): Promise<T> {
    const next = (operations.get(id) ?? Promise.resolve()).catch(() => {}).then(task);
    operations.set(id, next);
    void next.finally(() => { if (operations.get(id) === next) operations.delete(id); }).catch(() => {});
    return next;
  }
  async function save(job: Job) { await ctx.storage.set(key(job.id), clean(job)); jobs.set(job.id, job); }
  function disarm(id: string) { const timer = timers.get(id); if (timer) clearTimeout(timer); timers.delete(id); }
  function arm(job: Job) {
    disarm(job.id);
    if (closed || job.status !== "active" || job.nextAt === undefined) return;
    const delay = Math.min(2 ** 31 - 1, Math.max(0, job.nextAt - Date.now()));
    timers.set(job.id, setTimeout(() => { void fire(job.id, "timer").catch(() => {}); }, delay));
  }
  function fire(id: string, cause: string) {
    return serial(id, async () => {
      const job = jobs.get(id);
      if (closed || !job || job.status !== "active") return;
      if (cause === "timer" && eventTimers.has(id)) return;
      if (cause === "timer" && job.nextAt !== undefined && Date.now() < job.nextAt) { arm(job); return; }
      disarm(id);
      const at = Date.now();
      const text = `[pstack schedule ${job.id}; ${cause}]\n${job.prompt}\n\nRecheck the actual finish condition and retain the user's existing constraints. If the work is complete or the user stopped it, cancel this schedule with pstack_schedule. If this was a one-shot wake and work remains, choose the next useful time or event and schedule it before ending the turn. This wake adds no permission for unrelated actions.`;
      try {
        await ctx.session.synthetic({ sessionID: job.sessionID as any, text, resume: true, description: "Scheduled wake", delivery: "queue", metadata: { "pstack.schedule": id } });
        const next: Job = { ...job, fires: job.fires + 1, nextAt: job.intervalMs ? at + job.intervalMs : undefined, status: job.intervalMs || job.event ? "active" : "completed" };
        delete next.lastError;
        await save(next); arm(next);
      } catch {
        // Keep a failed delivery visible and retry on a later heartbeat, never spin.
        const next = { ...job, lastError: "Wake could not be queued", nextAt: at + Math.max(1000, job.intervalMs ?? 60000) };
        await save(next); arm(next);
      }
    });
  }
  async function create(input: any, sessionID: string, directory: string) {
    if (!input.prompt?.trim()) throw new Error("A wake prompt with an observable finish condition is required");
    for (const field of ["delayMs", "intervalMs"]) if (input[field] !== undefined && (!Number.isSafeInteger(input[field]) || input[field] < (field === "intervalMs" ? 1000 : 0))) throw new Error(`Invalid ${field}`);
    if (input.delayMs === undefined && input.intervalMs === undefined && !input.event) throw new Error("Choose a delay, interval or event");
    if (input.event?.sessionID) {
      const target: any = await ctx.session.get({ sessionID: input.event.sessionID });
      if (await canonical(target.location.directory) !== await canonical(directory) && target.parentID !== sessionID) throw new Error("Event target must be in this workspace or a direct child owned by this session");
    }
    const job: Job = { id: crypto.randomUUID(), sessionID, directory: await canonical(directory), prompt: input.prompt, intervalMs: input.intervalMs, event: input.event,
      nextAt: input.delayMs !== undefined || input.intervalMs !== undefined ? Date.now() + (input.delayMs ?? input.intervalMs) : undefined, status: "active", fires: 0 };
    await save(job); arm(job); return clean(job);
  }
  async function cancel(id: string, sessionID: string) {
    return serial(id, async () => {
      const job = jobs.get(id);
      if (!job || job.sessionID !== sessionID) throw new Error("Schedule does not belong to this session");
      disarm(id); const next = { ...job, status: "cancelled" as const }; await save(next); return clean(next);
    });
  }
  for (const job of jobs.values()) arm(job);
  const events = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (closed) break;
        for (const job of jobs.values()) {
          if (job.status !== "active" || job.event?.type !== event.type) continue;
          if (job.event.sessionID ? (event as any).data?.sessionID !== job.event.sessionID : !(event as any).location?.directory || await canonical((event as any).location.directory) !== await canonical(job.directory)) continue;
          if (job.event.match && Object.entries(job.event.match).some(([key, value]) => (event as any).data?.[key] !== value)) continue;
          if (eventTimers.has(job.id)) continue;
          // Coalesce bursts before entering the timer/cancellation mutation lane.
          eventTimers.set(job.id, setTimeout(() => {
            void fire(job.id, `event ${event.type}`).finally(() => { eventTimers.delete(job.id); }).catch(() => {});
          }, 250));
        }
      }
    } catch { if (!closed) for (const job of jobs.values()) if (job.event) { job.lastError = "Native event stream ended; heartbeat remains available"; } }
  })();
  const dispose = async () => { closed = true; controller.abort(); for (const id of timers.keys()) disarm(id); for (const timer of eventTimers.values()) clearTimeout(timer); eventTimers.clear(); await Promise.allSettled([...operations.values()]); await events; };
  return { jobs, create, cancel, dispose };
}

async function registerSchedules(ctx: Context, runtime: Awaited<ReturnType<typeof createScheduler>>) {
  const { jobs, create, cancel } = runtime;
  await ctx.tool.transform(editor => editor.add({ name: "pstack_schedule", options: { codemode: false },
    description: "Persist a one-shot delay, recurring heartbeat, or native event wake for the current session. Keeps running while the OpenCode service is alive, without polling or sleeping in the model turn. Combine an event and interval for an event watcher with heartbeat fallback. Cancel after the verified finish condition or a user stop.",
    input: { type: "object", properties: { action: { enum: ["create", "list", "cancel"] }, id: { type: "string" }, prompt: { type: "string" }, delayMs: { type: "integer", minimum: 0 }, intervalMs: { type: "integer", minimum: 1000 }, event: { type: "object", properties: { type: { type: "string", minLength: 1 }, sessionID: { type: "string" }, match: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } } }, required: ["type"], additionalProperties: false } }, required: ["action"], additionalProperties: false }, output: { type: "object" },
    async execute(input: any, context) {
      if (input.action === "create") return { output: { job: await create(input, context.sessionID, ctx.location.directory) } };
      if (input.action === "cancel") return { output: { job: await cancel(input.id, context.sessionID) } };
      return { output: { jobs: clean([...jobs.values()].filter(job => job.sessionID === context.sessionID)) } };
    },
  }));
  await ctx.command.transform(editor => editor.add({ name: "loop", description: "Repeat until the goal is verified: /loop [5m] <prompt>. Without an interval the agent selects a time or event. /loop stop cancels this session's wakes.",
    async execute(input) {
      const text = input.prompt.text.trim();
      if (/^(stop|cancel)$/i.test(text)) {
        for (const job of jobs.values()) if (job.sessionID === input.sessionID && job.status === "active") await cancel(job.id, input.sessionID);
        await ctx.session.prompt({ sessionID: input.sessionID, text: "The user stopped /loop. This session's scheduled wakes are cancelled. Confirm briefly; do not resume the task.", delivery: input.delivery });
        return;
      }
      const interval = /^(\d+)(ms|s|m|h)\s+([\s\S]+)$/.exec(text);
      let note: string;
      if (interval) {
        const milliseconds = Number(interval[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[interval[2]]!);
        const job = await create({ prompt: interval[3], intervalMs: milliseconds }, input.sessionID, ctx.location.directory);
        note = `Recurring wake ${job.id} is registered every ${interval[1]}${interval[2]}. Start now. Cancel it with pstack_schedule when the observable finish condition is verified or the user stops.`;
      } else note = "Choose when or what event should wake this work. Use a watcher for an external event and pstack_schedule for a heartbeat fallback, or a suitable one-shot/recurring delay when no event applies. Register the next wake before ending. Do not invent a fixed cadence when an event is better.";
      await ctx.session.prompt({ sessionID: input.sessionID, ...input.prompt, text: `${text}\n\n/loop: ${note} Preserve the user's goal and constraints; test the real finish condition. The OpenCode background service must remain running for wakes.`, delivery: input.delivery });
    },
  }));
}

// A server loads the plugin for many workspaces; only one dispatcher may own timers.
const registryKey = Symbol.for(`opencode-o.pstack.scheduler:${import.meta.url}`);
type Registry = { contexts: Set<Context>; ready: ReturnType<typeof createScheduler> };
export async function installSchedules(ctx: Context) {
  const globals = globalThis as any;
  let registry: Registry = globals[registryKey];
  if (!registry) {
    const contexts = new Set<Context>([ctx]);
    const liveContext = new Proxy({} as Context, { get: (_target, key) => (Array.from(contexts).at(-1) as any)?.[key] });
    registry = { contexts, ready: createScheduler(liveContext) };
    globals[registryKey] = registry;
  } else registry.contexts.add(ctx);
  const release = async () => {
    registry.contexts.delete(ctx);
    if (registry.contexts.size === 0) {
      if (globals[registryKey] === registry) delete globals[registryKey];
      await (await registry.ready).dispose();
    }
  };
  try { await registerSchedules(ctx, await registry.ready); }
  catch (error) { await release(); throw error; }
  return release;
}
