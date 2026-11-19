# OpenCode pstack

고정 원본 `de8ee15dd1194627d21eb5fcd41cb1873208dabb`의 58개 스킬을 순서대로 포팅했다.
동반 스킬 `deslop`, `control-ui`, `control-cli`와 OpenCode용 `create-skill`, `visualize`, `acceptance-criteria`를 포함해 64개를 등록한다.
원본과 치환 내역은 [스킬별 보고서](PORTING.md)에 있다. 모델에게 번역 어댑터를 읽히지 않으며,
도구명·인자·경로는 설치 파일에서 native 형식으로 바꿨다. 이전 포트는 사용하지 않는다.

## 설치와 사용

```sh
./scripts/install/pstack.sh
oc-pstack
```

OpenCode 2.2.7에서 검증했다. OpenCode V2, Bun, Git이 필요하다. 설치기는 의존성·원본 보존 검사를 실행하고
임시 DB의 실제 관리 서비스에서 런처를 검증한 뒤 `~/.local/bin/oc-pstack`을 설치한다.
프로필의 기본 에이전트는 `pstack`이며 `oc-lite`와 설정·서비스 등록·DB를 분리한다.
공통 셸에 이 프로필의 `OPENCODE_CONFIG_DIR`를 export하지 않는다.

처음에는 `/setup-pstack`으로 사용 가능한 모델과 전체 역할표를 검토한다. 사용자가 확인한 설정만
`pstack-models.json`에 저장하며 서비스 재시작 없이 다음 위임부터 읽는다. 제공자 인증은 OpenCode에서 별도로 설정해야 한다.
기본 모델 계열이 실제 제공자에 없다면 설정 단계에서 그 사실과 선택이 필요한 역할을 보여 준다.

- `/poteto-mode <작업>`: 원본의 작업 절차를 실행한다.
- `/pstack-mode on poteto-mode [개인-mode]`: 해당 세션에 모드를 지속 적용한다. `off`로 해제한다.
- `/how`, `/why`, `/architect`, `/arena` 등의 명령: 각각의 전체 스킬을 로드한다.
- `/loop 5m <작업>`: 반복 실행을 예약한다. 간격을 생략하면 모델이 다음 시각·이벤트를 정한다. `/loop stop`으로 취소한다.

작업 에이전트는 병합 요청을 [독립 Shipping 에이전트](pr-review.md)에 인계하고 재작업 사유 또는 병합 커밋을 받는다.

기획 확정 후 [/acceptance-criteria](skills/acceptance-criteria/SKILL.md)로 제품 레포의 작업 문서를 커밋하고 워크트리에 그 경로를 연결한다. 구현·Shipping·재검수는 같은 문서의 현재 기준을 읽으며 검수 댓글은 Shipping 프라이머리가 취합한다.

## 모델과 호출 정책

17개 역할, 4개 예산(`unlimited→max`, `large→xhigh`, `medium→high`, `small→medium`),
패널의 순서·중복·좌석 수를 보존한다. 일부 역할만 저장할 수 있고 빠진 역할은 원본 Grok/Claude 기본값을 사용한다.
`auto`와 `inherit-parent`를 지정한 역할만 명시적으로 부모를 상속한다.

모든 native `subagent` 호출에 `role`을 요구하며 패널에는 `seat`도 요구한다. 설명 접두어로 역할을 추정하지 않는다.
`difficulty`, `urgent`, `verification`은 원본 추론량·속도 조절에 연결한다.
조절한 모델 거부 시 원래 설정부터 재시도하고, 동시 거부와 백그라운드 거부도 모델별로 기록한다.
새 작업·수정·재시도는 새 자식이 기본이며, 꼭 필요한 이동 비용이 큰 상태를 명시한 소유 자식만 재사용한다.
Shipping의 동일 PR·동일 관점 재검수는 기존 담당 세션을 이어 쓴다.
필수 독립 감사는 다른 모델 계열을 증명하지 못하면 `NOT RUN`이다.

원본 명시 호출 제한을 `metadata.opencode/autoinvoke`에 보존한다. 개인 모드 생성도 기본값은 `false`다.
명령 로드, 자동 호출 가능 여부, 세션의 지속 모드는 서로 다른 기능이다.

위임 에이전트 원본은 `agent-templates/`에 두고 pstack 플러그인만 등록한다. native 자동탐색 대상인
`agents/`에 복사하면 경로 치환 전 원본이 최종 지침을 덮어쓸 수 있다.

## 프로젝트와 개인 설정

번들 스킬은 프로젝트에 남아 있는 같은 이름의 원본 스킬보다 우선한다. `bundled-skills`는 `skills`를 가리키는
상대 심볼릭 링크이며 native 설정 소스의 명시적 우선순위를 제공한다. 파일을 중복 복사하지 않는다.

- 프로젝트에서 번들 스킬을 수정해 쓸 때: `.opencode/pstack/skills/<이름>/SKILL.md`
- 프로필 전체에서 개인 스킬·수정본을 쓸 때: `$OPENCODE_CONFIG_DIR/local-skills/<이름>/SKILL.md`
- 별도 이름의 일반 프로젝트 스킬: `.opencode/skills/<이름>/SKILL.md`

수정본은 전체 스킬 폴더를 복사하고 상대 참조를 확인한다. 번들 `skills/`의 직접 수정은 원본 보존 검사가 거부한다.
프로젝트의 제품·저장·실행 환경 규칙은 해당 저장소에서 읽는다. 역할 설정과 작업 절차는 프로필이 소유한다.
Freefy의 프로젝트 내 스킬 복사본과 자체 검수·goal은 별도 저장소 정리에서 제거했다.

## 지원 범위와 외부 준비

| 기능 | 구현과 경계 |
| --- | --- |
| 할 일·기록·프로그램 상태 | 지속 todo, 압축 전 전체 세션 기록, 범위 제한, 공유 프로그램 저장소·충돌 검사·native 변경 이벤트 |
| 모드·예약·heartbeat | 턴·압축·서비스 재시작 후 복구. 전달하려면 OpenCode 서비스가 실행 중이어야 함 |
| 웹훅 UI | routine 생성, 비밀 입력, 인증 wake, 재시작 복구, 이미 연결된 Tailscale의 선택적 공개. 호스팅 VM은 생성하지 않음 |
| 클라우드 작업자·fork | VM 생성·원격 native 자식 전송·VM 상태 복제는 미구현. 필수 전제가 없으면 `BLOCKED`, 로컬 worktree로 조용히 대체하지 않음 |
| Benny | 전체 운영 pack을 `automations/benny/`에 보존. 원본처럼 slash 등록하지 않음. Slack 트리거·외부 검토 편집기·클라우드 checkout·credential 격리 실행기가 필요하며 활성화하지 않음 |
| 앱·이미지·외부 서비스 | 프로젝트별 UI/CLI 제어 도구, 이미지 생성 도구, 인증된 MCP 연결은 해당 기능을 사용할 때 필요 |
| statechart | TypeScript 지원 runtime 및 `mise`, 또는 기존 `JAVA`·`TLA2TOOLS` 환경 경로 필요. 원본 launcher가 TLC/Java를 준비하며 모델·config·출력 계약은 동일 |

statechart는 임시 도구 환경의 Temurin 25.0.5와 TLC 1.7.4로 실제 검사했다.
프로필 설치가 시스템 Java나 mise를 설치·변경하는 것은 아니다.
직접 `opencode serve`를 사용할 때 기록 API는 `PSTACK_API_URL`과 해당 서버의 표준 인증 환경변수가 필요하다.
일반 `oc-pstack` 관리 서비스에서는 자동 탐색한다. 비밀 값은 스킬이나 채팅에 넣지 않는다.

이력 도구의 native 대비 범위, 검색 예제와 페이지 처리 계약은 [세션 이력 조회와 검색](docs/history.md)을 참고한다.

## 검증

```sh
bun run check:pstack
bun run test:pstack-skills:live
bun run test:pstack-models:live
bun run test:pstack-agents:live
bun run test:pstack-failures:live
bun run test:pstack-setup:live
bun run test:pstack-overrides:live
bun run test:pstack-history:live
bun run test:pstack-core:live
bun run test:pstack-modes:live
bun run test:pstack-routines:live
bun run test:pstack-topology:live
bun run test:pstack-upstream
bun run doctor:pstack
```

실행 시험은 격리된 실제 OpenCode 호스트와 결정적 로컬 대역 제공자를 사용한다. 실제 자식 생성·제공자 모델/추론량,
실패·재시도·저장·예약은 검사하지만 모델이 모든 자연어 분기를 자율적으로 끝까지 수행한다는 보장은 아니다.
스킬별 근거와 미지원 범위는 [PORTING.md](PORTING.md), 원본 파일과 치환 기록은 `provenance/`와 `porting/`에 있다.
원본 MIT 라이선스와 동반 스킬의 라이선스를 포함한다. `falentio/opencode-pstack` 패키지는 설치하지 않았다.
