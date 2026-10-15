import fs from "node:fs";
import path from "node:path";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";
import type { RepoConfig } from "../config/repo-config.ts";
import { buildFixedContract } from "../contract/build.ts";
import { renderUserSummary } from "../contract/render.ts";
import type { Contract } from "../contract/schema.ts";
import { validateContract } from "../contract/validate.ts";
import type { JudgeBuildInput, JudgeOptions, JudgePhase } from "../judge/builder.ts";

export const CANCEL_COMMAND = "harness-cancel";
export const WIDGET_KEY = "pi-harness";
export const STATUS_KEY = "pi-harness";

export type EntryTarget = { repo: Contract["repo"]; repoConfig: RepoConfig | null; configWarning?: string };

export type EntryDeps = {
  offReason: string | null;
  resolveTarget: () => EntryTarget;
  newRunDir: () => Contract["paths"];
  buildContract: (input: JudgeBuildInput, opts: JudgeOptions) => Promise<Contract>;
  judge: Omit<JudgeOptions, "say" | "warn" | "signal" | "onPhase">;
  eventsFile: (runDir: string, phase: JudgePhase) => string;
  tickMs?: number;
  now?: () => number;
};

export type EntryHost = {
  activate(contract: Contract, runDir: string, ctx: ExtensionContext): Promise<void>;
};

export type EntryState = "off" | "pending" | "judging" | "active";
type Level = "info" | "warning" | "error";

const LAST_LIMIT = 80;
const CANCELLED = "계약 판정을 취소했습니다. 첫 메시지는 입력창에 되돌려 두었습니다. 다시 보내면 판정을 새로 시작합니다.";

export function isEscapeKey(data: string): boolean {
  return data === "\u001b" || /^\u001b\[27(;1(:1)?)?u$/.test(data);
}

export class EventsTail {
  calls = 0;
  last: string | undefined;
  readonly file: string;
  private offset = 0;
  private rest = "";

  constructor(file: string) {
    this.file = file;
  }

  read(): void {
    let fd: number;
    try {
      fd = fs.openSync(this.file, "r");
    } catch {
      return;
    }
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= this.offset) return;
      const buf = Buffer.alloc(size - this.offset);
      const n = fs.readSync(fd, buf, 0, buf.length, this.offset);
      this.offset += n;
      const lines = (this.rest + buf.subarray(0, n).toString("utf8")).split("\n");
      this.rest = lines.pop() ?? "";
      for (const line of lines) this.take(line);
    } finally {
      fs.closeSync(fd);
    }
  }

  private take(line: string): void {
    if (line.trim() === "") return;
    let e: { type?: unknown; toolName?: unknown; args?: Record<string, unknown> };
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (e.type !== "tool_execution_start" || typeof e.toolName !== "string") return;
    this.calls++;
    const a = e.args ?? {};
    const target = [a.path, a.pattern].find((v) => typeof v === "string" && v !== "") as string | undefined;
    const text = target !== undefined ? `${e.toolName} ${target}` : e.toolName;
    this.last = text.length > LAST_LIMIT ? `${text.slice(0, LAST_LIMIT)}...` : text;
  }
}

type Job = {
  generation: number;
  abort: AbortController;
  text: string;
  images: ImageContent[];
  ctx: ExtensionContext;
  startedAt: number;
  phase: JudgePhase;
  runDir?: string;
  tail?: EventsTail;
  judgeCalls: number;
  timer?: NodeJS.Timeout;
  unbindKeys?: () => void;
};

export class PendingEntry {
  state: EntryState = "pending";
  private pi: ExtensionAPI | undefined;
  private host: EntryHost | undefined;
  private job: Job | undefined;
  private generation = 0;
  private readonly now: () => number;
  private readonly deps: EntryDeps;

  constructor(deps: EntryDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  register(pi: ExtensionAPI, host: EntryHost): void {
    this.pi = pi;
    this.host = host;
    pi.registerCommand(CANCEL_COMMAND, {
      description: "Cancel the pi-harness judge that is writing the contract for the first message",
      handler: async (_args, ctx) => this.cancel(ctx),
    });
  }

  sessionStart(ctx: ExtensionContext, hasContract: boolean): void {
    this.stop();
    if (hasContract) {
      this.state = "active";
      this.status(ctx, "pi-harness: 계약 적용 중");
      return;
    }
    if (this.deps.offReason !== null) {
      this.state = "off";
      this.status(ctx, "pi-harness: 꺼짐");
      this.notify(ctx, this.deps.offReason, "warning");
      return;
    }
    this.state = "pending";
    this.status(ctx, "pi-harness: 첫 작업 메시지를 기다리는 중");
  }

  shutdown(): void {
    this.stop();
  }

  input(event: InputEvent, ctx: ExtensionContext): InputEventResult {
    if (this.state === "off" || this.state === "active") return { action: "continue" };
    if (event.source === "extension" || this.isCommand(event.text)) return { action: "continue" };
    if (this.state === "judging") {
      this.notify(ctx, "아직 첫 메시지의 작업 계약을 만드는 중입니다.", "warning");
      return { action: "handled" };
    }
    const job: Job = {
      generation: ++this.generation, abort: new AbortController(), text: event.text, images: event.images ?? [], ctx,
      startedAt: this.now(), phase: "judge", judgeCalls: 0,
    };
    this.job = job;
    this.state = "judging";
    this.run(job).catch((e: unknown) => {
      if (this.job === job) this.back(job, `작업 계약을 만들지 못했습니다: ${(e as Error).message}`, "error");
    });
    return { action: "handled" };
  }

  cancel(ctx: ExtensionContext): void {
    if (this.state === "judging" && this.job !== undefined) {
      this.job.abort.abort();
      return;
    }
    this.notify(ctx, "취소할 계약 판정이 없습니다.", "info");
  }

  private isCommand(text: string): boolean {
    if (!text.startsWith("/") || this.pi === undefined) return false;
    const name = text.slice(1).split(/\s/)[0] ?? "";
    return name !== "" && this.pi.getCommands().some((c) => c.name === name);
  }

  private async run(job: Job): Promise<void> {
    const { text, images, ctx } = job;
    const live = () => this.job === job && job.generation === this.generation;

    const model = ctx.model !== undefined ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    if (model === undefined) {
      this.back(job, "선택된 모델이 없어 작업 계약을 만들 수 없습니다. /login 또는 /model로 모델을 고른 뒤 다시 보내 주세요.", "error");
      return;
    }
    let target: EntryTarget;
    let paths: Contract["paths"];
    try {
      target = this.deps.resolveTarget();
      paths = this.deps.newRunDir();
    } catch (e) {
      this.back(job, `작업 계약을 준비하지 못했습니다: ${(e as Error).message}`, "error");
      return;
    }
    if (target.configWarning !== undefined) this.notify(ctx, target.configWarning, "warning");
    job.runDir = paths.runDir;
    this.startProgress(job);

    const input: JudgeBuildInput = {
      original: text, repo: target.repo, paths, model, repoConfig: target.repoConfig, materials: [],
      ...(images.length > 0 ? { attachedImages: images.length } : {}),
    };
    const fallback = () => buildFixedContract({ ...input, source: "fallback" });
    let contract: Contract;
    try {
      contract = await this.deps.buildContract(input, {
        ...this.deps.judge,
        say: (line) => this.notify(ctx, line, "info"),
        warn: (line) => this.notify(ctx, line, "warning"),
        signal: job.abort.signal,
        onPhase: (phase) => this.setPhase(job, phase),
      });
    } catch (e) {
      if (!live()) return;
      if (job.abort.signal.aborted) {
        this.back(job, CANCELLED, "info");
        return;
      }
      this.notify(ctx, `판정 단계에서 오류가 나 대체 계약을 사용합니다. 이유: ${(e as Error).message}`, "warning");
      contract = fallback();
    }
    if (!live()) return;
    if (job.abort.signal.aborted) {
      this.back(job, CANCELLED, "info");
      return;
    }
    const checked = validateContract(contract);
    if (!checked.ok) {
      this.notify(ctx, `만든 계약이 올바르지 않아 대체 계약을 사용합니다: ${checked.errors.join("; ")}`, "warning");
      contract = fallback();
    }
    fs.writeFileSync(path.join(paths.runDir, "contract.json"), `${JSON.stringify(contract, null, 2)}\n`);

    this.stopProgress(job);
    try {
      await this.host?.activate(contract, paths.runDir, ctx);
    } catch (e) {
      this.back(job, `계약을 세션에 적용하지 못했습니다: ${(e as Error).message}`, "error");
      return;
    }
    this.job = undefined;
    this.state = "active";
    this.status(ctx, "pi-harness: 계약 적용 중");
    this.notify(ctx, `${renderUserSummary(contract)}\n실행 폴더: ${paths.runDir}`, "info");
    const content: string | (TextContent | ImageContent)[] = images.length > 0 ? [{ type: "text", text }, ...images] : text;
    this.pi?.sendUserMessage(content, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
  }

  private back(job: Job, message: string, level: Level): void {
    this.stopProgress(job);
    if (this.job === job) this.job = undefined;
    this.state = "pending";
    this.status(job.ctx, "pi-harness: 첫 작업 메시지를 기다리는 중");
    this.restore(job.ctx, job.text);
    this.notify(job.ctx, message, level);
  }

  private stop(): void {
    const job = this.job;
    this.generation++;
    if (job === undefined) return;
    this.job = undefined;
    job.abort.abort();
    this.stopProgress(job);
  }

  private setPhase(job: Job, phase: JudgePhase): void {
    if (job.phase === "judge" && job.tail !== undefined) {
      job.tail.read();
      job.judgeCalls = job.tail.calls;
    }
    job.phase = phase;
    job.tail = job.runDir !== undefined ? new EventsTail(this.deps.eventsFile(job.runDir, phase)) : undefined;
    this.render(job);
  }

  private startProgress(job: Job): void {
    this.setPhase(job, "judge");
    try {
      job.unbindKeys = job.ctx.ui.onTerminalInput((data) => {
        if (this.job !== job || this.state !== "judging" || !isEscapeKey(data)) return undefined;
        this.cancel(job.ctx);
        return { consume: true };
      });
    } catch {
      job.unbindKeys = undefined;
    }
    job.timer = setInterval(() => this.render(job), this.deps.tickMs ?? 1000);
    job.timer.unref?.();
  }

  private stopProgress(job: Job): void {
    if (job.timer !== undefined) clearInterval(job.timer);
    job.timer = undefined;
    job.unbindKeys?.();
    job.unbindKeys = undefined;
    try {
      job.ctx.ui.setWidget(WIDGET_KEY, undefined);
    } catch {
      // the session may already be gone
    }
  }

  private progressLines(job: Job): string[] {
    const sec = Math.max(0, Math.round((this.now() - job.startedAt) / 1000));
    if (job.phase === "judge") {
      const calls = job.tail?.calls ?? 0;
      const last = job.tail?.last;
      return [
        `pi-harness: 첫 메시지로 작업 계약을 만드는 중입니다 · ${sec}초 · 판정 도구 호출 ${calls}회${last !== undefined ? ` · 마지막: ${last}` : ""}`,
        `Esc 또는 /${CANCEL_COMMAND}로 취소할 수 있습니다.`,
      ];
    }
    return [
      `pi-harness: 노력 수준을 정하는 중입니다 · ${sec}초 · 판정 도구 호출 ${job.judgeCalls}회`,
      `Esc 또는 /${CANCEL_COMMAND}로 취소할 수 있습니다.`,
    ];
  }

  private render(job: Job): void {
    if (this.job !== job) return;
    job.tail?.read();
    try {
      job.ctx.ui.setWidget(WIDGET_KEY, this.progressLines(job));
    } catch {
      // the session may already be gone
    }
  }

  private restore(ctx: ExtensionContext, text: string): void {
    try {
      if (ctx.ui.getEditorText().trim() === "") ctx.ui.setEditorText(text);
    } catch {
      // no editor in this mode
    }
  }

  private status(ctx: ExtensionContext, text: string): void {
    try {
      ctx.ui.setStatus(STATUS_KEY, text);
    } catch {
      // no status bar in this mode
    }
  }

  private notify(ctx: ExtensionContext, message: string, level: Level): void {
    if (ctx.hasUI) ctx.ui.notify(message, level);
    else process.stderr.write(`${message}\n`);
  }
}
