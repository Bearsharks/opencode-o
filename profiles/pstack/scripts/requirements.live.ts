// Run explicitly with the configured oc-pstack service: bun profiles/pstack/scripts/requirements.live.ts
// Each case starts a fresh, tool-free pstack session. No PR, Studio or merge is involved.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);

// Adapted from #300 v2/v3 (issue comments 6905856620, 6907396538) and the #309
// surrender decision. Controls below change one premise; they are not historical runs.
const exhibit =
  "승인 범위는 자기 전시실에서 전시물 위를 걷고 발밑 눌림·소리·이탈 후 복원을 두 클라이언트에서 경험하는 것이다. A→B→C 순서를 고정했다. 설계 표에는 지지면 Y=0.85와 키보드 복원 대기 0초가 있다. 사용자는 플레이에 지장 없는 미세한 틈은 병합 기준에서 제외했다.";
const measured =
  "실제 걷기·발밑 반응·소리·복원을 두 클라이언트에서 확인했다. 팀이 만든 체크리스트는 Y=0.85 점별 일치와 별도 wait 캡처를 요구한다. 한 곡면에서 미세한 틈이 측정됐고 별도 wait 화면은 없다.";
const quit =
  "승인 범위는 포기 후 같은 층 상점으로 돌아가 도착 후 조작을 푸는 것이다. 이전 구현은 이동 실패 시 패배 위치로 복구했으며 검수자는 공중·측벽에서도 옛 위치를 복구하는 테스트를 요구한다.";
const cases = [
  { name: "exhibit-diagnostics", facts: exhibit + measured, expected: "PASS" },
  {
    name: "exhibit-real-failure",
    facts: exhibit + " 높이·내부 sequence 검사는 통과했지만 실제로 걸어 밟으면 발밑 물체가 반응하지 않는다.",
    expected: "FIX",
  },
  {
    name: "exhibit-missing-evidence",
    facts:
      exhibit +
      " 정적 구조는 통과했으나 곡면의 시각적 표면이 지지면보다 0.108 stud 낮다는 진단이 있다. 두 클라이언트로 실제 전시물을 밟아 본 기록은 없다.",
    expected: "VERIFY",
  },
  {
    name: "explicit-numeric-contract",
    facts:
      exhibit +
      measured +
      " 추가로 사용자가 해당 곡면의 높이 오차 0.01 stud 이하를 인수조건으로 명시했고 실제 오차는 0.108 stud다.",
    expected: "FIX",
  },
  {
    name: "surrender-destination",
    facts:
      quit +
      " 현재 후보는 이미 확정한 포기를 유지하고 상점 이동만 재시도한다. 중복 지급 없이 상점에 도착하고 그때만 조작이 풀림을 확인했다. 이전 위치로 돌아가지 않아 옛 테스트가 실패한다.",
    expected: "PASS",
  },
  {
    name: "surrender-control-lock",
    facts:
      quit +
      " 현재 후보는 상점 바닥이 준비되기 전에 입력을 풀어 캐릭터가 떨어진다. 이전 위치 복구 테스트는 통과했다.",
    expected: "FIX",
  },
] as const;

const cwd = await mkdtemp(join(tmpdir(), "pstack-requirements-"));
async function api(op: string, ...args: string[]) {
  const { stdout } = await exec("oc-pstack", ["api", op, ...args], { cwd, timeout: 120_000 });
  return stdout.trim() ? JSON.parse(stdout).data : undefined;
}
try {
  for (const example of cases) {
    const session = await api(
      "session.create",
      "--data",
      JSON.stringify({
        agent: "pstack",
        model: { providerID: "openai", id: "gpt-6.2-sol", variant: "medium" },
        location: { directory: cwd },
        title: "요구 판단 시험: " + example.name,
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      }),
    );
    const param = ["--param", "sessionID=" + session.id];
    const text =
      example.facts +
      "\n이 범위에서 다음 행동을 판정해라. PASS=제품 수정이나 추가 실험 없이 이 동작을 인수, FIX=제품 수정 필요, VERIFY=필수 행동 근거 추가 확인. 실제 작업 없이 JSON {decision, reason}만 반환하라.";
    await api("session.prompt", ...param, "--data", JSON.stringify({ text }));
    await exec("oc-pstack", ["api", "POST", `/api/experimental/session/${session.id}/wait`], {
      cwd,
      timeout: 120_000,
    });
    const messages = await api("session.context", ...param);
    const answer = messages.findLast((m: any) => m.type === "assistant");
    if (!answer || answer.error || answer.finish !== "stop")
      throw Error(example.name + ": " + (answer?.error?.type ?? "no final answer"));
    const raw = answer.content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("")
      .trim();
    const verdict = JSON.parse(raw.replace(/^\x60\x60\x60(?:json)?\s*/, "").replace(/\s*\x60\x60\x60$/, ""));
    console.log(example.name, verdict.decision, verdict.reason);
    if (verdict.decision !== example.expected || !verdict.reason?.trim())
      throw Error(example.name + ": expected " + example.expected);
  }
} finally {
  await rm(cwd, { recursive: true, force: true });
}
