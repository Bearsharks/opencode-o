import type { Contract, EffortLevel, ProhibitionSource } from "./schema.ts";

function sentence(text: string): string {
  const t = text.trimEnd();
  return /[.!?。]$/.test(t) ? t : `${t}.`;
}

export function renderAgentSection(contract: Contract): string {
  const goal = [
    "GOAL",
    "Original request (authoritative; it wins on any conflict):",
    "<<<",
    contract.goal.original,
    ">>>",
    `Refined goal (clarification only; it adds no decisions): ${contract.goal.refined}`,
  ];
  if (contract.materials.length > 0) {
    goal.push("Reference materials:");
    for (const m of contract.materials) goal.push(`- ${m.id} ${m.path} — ${m.describe}`);
  }

  const done = ["DONE CONDITIONS"];
  if (contract.doneConditions.length === 0) {
    done.push("None.");
  } else {
    for (const d of contract.doneConditions) {
      const v = d.verify;
      if (v.kind === "command") {
        done.push(`- ${d.id} ${sentence(d.statement)} Verify by running \`${v.command}\` in \`${v.cwd}\`.`);
      } else {
        done.push(`- ${d.id} ${sentence(d.statement)} Verify: ${sentence(v.how)}`);
      }
    }
    done.push("If a prohibition prevents you from verifying a condition, do not break the prohibition; report that you could not verify that condition.");
  }

  const prohibitions = ["PROHIBITIONS"];
  if (contract.prohibitions.length === 0) prohibitions.push("None.");
  for (const p of contract.prohibitions) {
    const ref = p.source.ref !== undefined ? ` ${p.source.ref}` : "";
    prohibitions.push(`- ${p.id} ${p.text} (source: ${p.source.kind}${ref})`);
  }

  return [goal, done, prohibitions].map((b) => b.join("\n")).join("\n\n");
}

const SOURCE_SENTENCE: Record<Contract["source"], string> = {
  judge: "이 계약은 판정 에이전트가 작성했습니다.",
  fixed: "이 계약은 레포 설정으로 만든 고정 계약입니다.",
  fallback: "판정 단계를 사용할 수 없어 레포 설정으로 만든 대체 계약을 사용합니다.",
  file: "이 계약은 파일에서 불러왔습니다.",
};

const PROHIBITION_SOURCE: Record<ProhibitionSource["kind"], string> = {
  "user-message": "사용자 메시지",
  "user-rules": "사용자 규칙",
  "repo-rules": "레포 규칙",
  "repo-config": "레포 설정",
  material: "참고 자료",
  judge: "판정 에이전트",
};

const EFFORT_NAME: Record<EffortLevel, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
  extreme: "극한",
};

export function renderUserSummary(contract: Contract): string {
  const lines = [`이번 작업의 계약입니다. ${SOURCE_SENTENCE[contract.source]}`, ""];
  lines.push("다듬은 목표는 다음과 같습니다.", contract.goal.refined, "");

  if (contract.doneConditions.length === 0) {
    lines.push("완료 조건은 없습니다.");
  } else {
    lines.push(`완료 조건은 ${contract.doneConditions.length}개입니다.`);
    for (const d of contract.doneConditions) {
      const v = d.verify;
      const how = v.kind === "command"
        ? `명령 \`${v.command}\`를 \`${v.cwd}\`에서 실행해 확인합니다.`
        : "에이전트가 확인 결과를 보고합니다.";
      lines.push(`- ${d.id} ${sentence(d.statement)} ${how}`);
    }
  }
  lines.push("");

  if (contract.prohibitions.length === 0) {
    lines.push("금지 사항은 없습니다.");
  } else {
    lines.push(`금지 사항은 ${contract.prohibitions.length}개입니다.`);
    for (const p of contract.prohibitions) {
      const ref = p.source.ref !== undefined ? ` (${p.source.ref})` : "";
      lines.push(`- ${p.id} ${sentence(p.text)} 출처는 ${PROHIBITION_SOURCE[p.source.kind]}${ref}입니다.`);
    }
  }
  lines.push("");

  if (contract.materials.length === 0) {
    lines.push("함께 전달되는 참고 자료는 없습니다.");
  } else {
    lines.push("에이전트에게 다음 참고 자료를 함께 전달합니다.");
    for (const m of contract.materials) lines.push(`- ${m.id} ${m.path}: ${m.describe}`);
  }
  lines.push("");

  const r = contract.runtime;
  const workers = r.workerCap === 0
    ? "작업자는 쓰지 않습니다."
    : `작업자는 최대 ${r.workerCap}개까지 동시에 쓸 수 있습니다.`;
  lines.push(`노력 수준은 ${EFFORT_NAME[contract.effort.level]}입니다. 사고 수준은 ${r.thinkingLevel}이고, ${workers}`);
  return lines.join("\n");
}
