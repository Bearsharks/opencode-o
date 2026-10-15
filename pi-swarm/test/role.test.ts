import assert from "node:assert/strict";
import { test } from "node:test";
import { renderRole } from "../src/role.ts";
import type { AgentRow, SwarmState } from "../src/state.ts";

const state: SwarmState = { repoRoot: "/r/app", baseBranch: "main", tmuxSession: "swarm-app", worktreeRoot: "/r/app-swarm", agents: [] };
const row = (over: Partial<AgentRow>): AgentRow => ({
  name: "front", role: "front", contextDir: "/h/.pi-swarm/app/agents/front/context", cwd: "/r/app", branch: "main", createdAt: "t", ...over,
});
const common = (name: string, label: string, ctx: string, cwd: string, branch: string) => `당신은 리더 없이 함께 일하는 에이전트들 중 하나입니다.
이름: ${name}
역할: ${label}
개인 폴더: ${ctx}
대화가 길어지면 앞부분이 압축되어 자세한 내용을 잊게 됩니다. 한 일을 하나하나 다 적지 말고, 나중에도 보존할 지식만 골라 이 폴더에 자기 방식대로 남겨 두세요. 다른 에이전트가 물어보면 이 폴더를 보고 답하세요.
코드 작업 폴더: ${cwd} (브랜치: ${branch})
다른 에이전트 목록은 list_agents로 보고, 메시지는 send_message로 보냅니다. 다른 에이전트가 보낸 메시지는 "[이름에게서 온 메시지]"로 시작합니다.
`;

test("front role text", () => {
  assert.equal(renderRole({ ...state, baseBranch: "develop" }, row({})), common("front", "창구 에이전트", "/h/.pi-swarm/app/agents/front/context", "/r/app", "main") +
`사용자에게서 기능을 받으면 create_feature_owner로 그 기능의 책임자를 만들고, 그 책임자가 시작할 때 가질 맥락을 직접 써서 넣어 주세요.
다른 에이전트가 검수를 요청하면 그 브랜치의 변경을 보고, 받아들이면 develop에 합치고, 받아들이지 않으면 이유를 그 에이전트에게 메시지로 보내세요.`);
});

test("architect role text", () => {
  const r = row({ name: "architect", role: "architect", contextDir: "/c/a", cwd: "/r/app-swarm/architect", branch: "swarm/architect" });
  assert.equal(renderRole(state, r), common("architect", "아키텍처 책임자", "/c/a", "/r/app-swarm/architect", "swarm/architect") +
`목표: 전체 구조를 계속 발전시키는 것입니다.
바꾼 것은 자기 브랜치에서 작업한 뒤, 브랜치 이름과 설명을 front에게 메시지로 보내 검수를 요청하세요.`);
});

test("feature role text", () => {
  const r = row({ name: "login", role: "feature", feature: "로그인 화면\n두 줄", contextDir: "/c/l", cwd: "/r/app-swarm/login", branch: "swarm/login" });
  assert.equal(renderRole(state, r), common("login", "기능 책임자", "/c/l", "/r/app-swarm/login", "swarm/login") +
`맡은 기능(사용자 원문):
로그인 화면
두 줄
목표: 이 기능 하나를 화면부터 서버까지 끝까지 만드는 것입니다.
작업을 마치면 브랜치 이름과 설명을 front에게 메시지로 보내 검수를 요청하세요.`);
});
