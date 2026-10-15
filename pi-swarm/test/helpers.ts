import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import type { Launcher, LaunchSpec } from "../src/launcher.ts";
import type { SwarmState } from "../src/state.ts";

Object.assign(process.env, {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
});

export function tempRoot(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function gitOut(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export type FakeLauncher = Launcher & {
  launched: LaunchSpec[];
  attached: number;
  open: boolean;
  fail?: string;
};

export function fakeLauncher(open = false): FakeLauncher {
  const l: FakeLauncher = {
    launched: [],
    attached: 0,
    open,
    isOpen: async (_s: SwarmState) => l.open,
    launchAgent: async (_s: SwarmState, spec: LaunchSpec) => {
      if (l.fail !== undefined) throw new Error(l.fail);
      l.launched.push(spec);
    },
    attach: async () => { l.attached++; },
  };
  return l;
}
