import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { renderRole } from "./role.ts";
import { findAgent, inboxDir, readDirOf, readState } from "./state.ts";
import type { InboxMessage } from "./tools.ts";

export const MCP_SERVER_PATH = fileURLToPath(new URL("./mcp-main.ts", import.meta.url));

const AFTER_SEND_HOLD_MS = 5_000;
const INITIAL_MESSAGE_HOLD_MS = 60_000;

export function formatIncoming(msg: InboxMessage): string {
  return `[${msg.from}에게서 온 메시지]\n${msg.text}`;
}

type Hold = { since: number; ms: number };

export type InboxDeliveryOptions = {
  inbox: string;
  readDir: string;
  pi: Pick<ExtensionAPI, "sendUserMessage">;
  ctx: Pick<ExtensionContext, "isIdle">;
  intervalMs: number;
  holdInitially: boolean;
};

export class InboxDelivery {
  private readonly delivered = new Set<string>();
  private watcher: fs.FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private scanning = false;
  private hold: Hold | undefined;
  private compacting = false;

  private readonly o: InboxDeliveryOptions;

  constructor(o: InboxDeliveryOptions) {
    this.o = o;
    if (o.holdInitially) this.hold = { since: Date.now(), ms: INITIAL_MESSAGE_HOLD_MS };
  }

  start(): void {
    try {
      this.watcher = fs.watch(this.o.inbox, () => this.kick());
      this.watcher.on("error", () => {});
    } catch {}
    this.timer = setInterval(() => this.scan(), this.o.intervalMs);
    this.timer.unref();
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = undefined;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  kick(): void {
    if (!this.stopped) setImmediate(() => this.scan());
  }

  setCompacting(value: boolean): void {
    this.compacting = value;
    if (!value) this.kick();
  }

  agentStarted(): void {
    this.hold = undefined;
  }

  scan(): void {
    if (this.stopped || this.scanning) return;
    this.scanning = true;
    try {
      this.deliverPending();
    } catch {
    } finally {
      this.scanning = false;
    }
  }

  private deliverPending(): void {
    const { ctx, pi, inbox, readDir } = this.o;
    if (this.compacting) {
      if (!ctx.isIdle()) return;
      this.compacting = false;
    }
    if (this.hold !== undefined) {
      if (ctx.isIdle() && Date.now() - this.hold.since < this.hold.ms) return;
      this.hold = undefined;
    }
    const files = fs.readdirSync(inbox).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) {
      const src = path.join(inbox, f);
      if (this.delivered.has(f)) {
        this.moveToRead(src, f);
        continue;
      }
      if (this.compacting || this.stopped) return;
      let msg: InboxMessage;
      try {
        msg = JSON.parse(fs.readFileSync(src, "utf8")) as InboxMessage;
      } catch {
        continue;
      }
      const text = formatIncoming(msg);
      const idle = ctx.isIdle();
      if (idle) pi.sendUserMessage(text);
      else pi.sendUserMessage(text, { deliverAs: "steer" });
      this.delivered.add(f);
      this.moveToRead(src, f);
      if (idle) {
        this.hold = { since: Date.now(), ms: AFTER_SEND_HOLD_MS };
        return;
      }
    }
  }

  private moveToRead(src: string, f: string): void {
    try {
      fs.renameSync(src, path.join(this.o.readDir, f));
      this.delivered.delete(f);
    } catch {}
  }
}

export type SwarmExtensionOptions = {
  dir: string;
  name: string;
  hasInitialMessage?: boolean;
  intervalMs?: number;
};

export function swarmExtension(opts: SwarmExtensionOptions): ExtensionFactory {
  const { dir, name } = opts;
  return (pi) => {
    pi.registerMcpServer("swarm", {
      command: process.execPath,
      args: [MCP_SERVER_PATH],
      env: { PI_SWARM_DIR: dir, PI_SWARM_AGENT: name },
      exposure: "direct",
      description: "Talk to the other agents of this leaderless swarm and create feature owners.",
    });

    pi.on("before_agent_start", (event) => {
      try {
        const state = readState(dir);
        const row = findAgent(state, name);
        if (row !== undefined) event.systemPromptOptions.sections.swarm = renderRole(state, row);
      } catch {}
    });

    let inbox: InboxDelivery | undefined;
    let firstSession = true;

    pi.on("session_start", (_event, ctx) => {
      inbox?.stop();
      inbox = new InboxDelivery({
        inbox: inboxDir(dir, name),
        readDir: readDirOf(dir, name),
        pi,
        ctx,
        intervalMs: opts.intervalMs ?? 2_000,
        holdInitially: firstSession && opts.hasInitialMessage === true,
      });
      firstSession = false;
      inbox.start();
    });

    pi.on("agent_start", () => inbox?.agentStarted());
    pi.on("session_before_compact", () => { inbox?.setCompacting(true); });
    pi.on("session_compact", () => inbox?.setCompacting(false));
    pi.on("session_compact_failed", () => inbox?.setCompacting(false));

    pi.on("session_shutdown", () => {
      inbox?.stop();
      inbox = undefined;
    });
  };
}
