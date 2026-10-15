import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { renderAgentSection, renderUserSummary } from "../contract/render.ts";
import type { Contract } from "../contract/schema.ts";
import { runWorkersTool } from "../workers/run-workers.ts";
import type { PendingEntry } from "./entry.ts";
import {
  type ContractEntryData, ENTRY_CONTRACT, findContractEntry, INITIAL_GOAL_SENTINEL, type SessionEntryLike,
} from "./types.ts";

export type HarnessOptions = {
  contract: Contract;
  runDir: string;
  mode: "start" | "resume";
} | {
  mode: "interactive";
  entry: PendingEntry;
};

const RUN_WORKERS = "run_workers";

export function harness(opts: HarnessOptions): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const entry = opts.mode === "interactive" ? opts.entry : undefined;
    let contract: Contract | undefined = opts.mode === "interactive" ? undefined : opts.contract;
    let runDir: string | undefined = opts.mode === "interactive" ? undefined : path.resolve(opts.runDir);
    let workersFor: { cap: number; runDir: string } | undefined;
    let firstInputPending = false;
    let hasUI = false;

    const need = (): Contract => {
      if (contract === undefined) throw new Error("pi-harness has no contract for this session yet.");
      return contract;
    };
    const dir = (): string => {
      if (runDir === undefined) throw new Error("pi-harness has no run directory for this session yet.");
      return runDir;
    };

    function warn(message: string): void {
      try {
        if (runDir !== undefined) {
          fs.mkdirSync(runDir, { recursive: true });
          fs.appendFileSync(path.join(runDir, "harness.log"), `${new Date().toISOString()} ${message}\n`);
        }
      } catch {
        // logging must never break the session
      }
      if (!hasUI) process.stderr.write(`[pi-harness] ${message}\n`);
    }

    const appendContract = (data: ContractEntryData) => pi.appendEntry(ENTRY_CONTRACT, data);

    if (opts.mode !== "interactive" && opts.contract.runtime.workerCap > 0) pi.registerTool(runWorkersTool({ contract: need, runDir: dir() }));

    function syncWorkers(): void {
      const cap = contract?.runtime.workerCap ?? 0;
      if (cap > 0 && runDir !== undefined && (workersFor?.cap !== cap || workersFor.runDir !== runDir)) {
        pi.registerTool(runWorkersTool({ contract: need, runDir }));
        workersFor = { cap, runDir };
      }
      const active = pi.getActiveTools();
      if (cap > 0 && workersFor !== undefined && !active.includes(RUN_WORKERS)) pi.setActiveTools([...active, RUN_WORKERS]);
      else if (cap <= 0 && active.includes(RUN_WORKERS)) pi.setActiveTools(active.filter((n) => n !== RUN_WORKERS));
    }

    entry?.register(pi, {
      async activate(next, nextRunDir, ctx) {
        hasUI = ctx.hasUI;
        contract = next;
        runDir = path.resolve(nextRunDir);
        fs.mkdirSync(runDir, { recursive: true });
        appendContract({ contract: next, runDir });
        pi.setThinkingLevel(next.runtime.thinkingLevel);
        syncWorkers();
      },
    });

    pi.on("session_start", async (event, ctx) => {
      hasUI = ctx.hasUI;
      if (runDir !== undefined && entry === undefined) fs.mkdirSync(runDir, { recursive: true });
      const data = findContractEntry(ctx.sessionManager.getBranch() as unknown as SessionEntryLike[]);
      if (entry !== undefined) {
        contract = data?.contract;
        runDir = data !== undefined ? path.resolve(data.runDir ?? data.contract.paths.runDir) : undefined;
        firstInputPending = false;
        entry.sessionStart(ctx, data !== undefined);
        syncWorkers();
        if (runDir === undefined) return;
        fs.mkdirSync(runDir, { recursive: true });
      } else if (opts.mode === "interactive") {
        return;
      } else if (data !== undefined) {
        if (data.contract.contractId !== opts.contract.contractId) {
          warn(`the session already has contract ${data.contract.contractId}; using it instead of ${opts.contract.contractId}`);
        }
        contract = data.contract;
        firstInputPending = false;
      } else {
        if (opts.mode === "resume") warn("the resumed session has no harness contract entry; using the contract given by the launcher");
        contract = opts.contract;
        appendContract({ contract, runDir: dir() });
        firstInputPending = opts.mode === "start" && event.reason === "startup";
      }
      if (ctx.hasUI) ctx.ui.notify(renderUserSummary(need()), "info");
    });

    pi.on("input", (event, ctx) => {
      if (contract === undefined) {
        if (entry === undefined) return { action: "continue" as const };
        try {
          return entry.input(event, ctx);
        } catch (e) {
          warn(`input handler failed: ${(e as Error).message}`);
          return { action: "continue" as const };
        }
      }
      if (!firstInputPending || !event.text.endsWith(INITIAL_GOAL_SENTINEL)) {
        firstInputPending = false;
        return { action: "continue" as const };
      }
      firstInputPending = false;
      const prefix = event.text.slice(0, event.text.length - INITIAL_GOAL_SENTINEL.length);
      const goal = contract.goal.original;
      if (goal.startsWith("/")) {
        const name = goal.slice(1).split(/\s/)[0] ?? "";
        const hit = pi.getCommands().find((c) => c.source !== "extension" && c.name === name);
        if (hit !== undefined) {
          warn(`The goal starts with "/${name}", which pi would expand as a ${hit.source === "skill" ? "skill" : "prompt template"}; it cannot be delivered verbatim. Rephrase the goal or disable that ${hit.source}.`);
          process.exitCode = 1;
          return { action: "handled" as const };
        }
      }
      if (prefix !== "") warn("piped stdin or @file content was placed before the contract goal in the first message");
      return { action: "transform" as const, text: prefix + goal, ...(event.images !== undefined ? { images: event.images } : {}) };
    });

    pi.on("before_agent_start", (event) => {
      if (contract === undefined) return;
      try {
        event.systemPromptOptions.sections.session_contract = renderAgentSection(contract);
      } catch (e) {
        warn(`could not render the contract section: ${(e as Error).message}`);
      }
    });

    pi.on("session_shutdown", () => {
      entry?.shutdown();
    });
  };
}
