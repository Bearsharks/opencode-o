# oc-bstack — 프로젝트 작업을 맡는 메인 에이전트

`bstack`은 pstack과 마찬가지로 사용자의 작업을 받아 조사·기획·구현·검증까지 책임지는 기본 에이전트다. pstack 전체를 복제한 것은 아니다. **모호함 해소는 첫 번째 전문 스킬**이지 모든 작업의 목적이나 선행 조건이 아니다.

| 구분 | 성공 정의 | 검증 | 근거 |
|---|---|---|---|
| 제품 가설 | 사용자는 한 세션에서 명확한 수정은 바로 맡기고, 기획이 필요할 때만 성공 조건을 정한다. | 임시 레포에서 파일 수정 후 같은 세션에서 기획 요청. 실제 파일, 질문과 호출 기록을 대조한다. | 사용자가 지정한 역할은 프로젝트 작업을 맡는 메인이다. 두 요청을 같은 세션에서 수행하면 이 사례에서 프로필 전환이나 의무적인 기획 문서 없이 작업할 수 있음을 확인한다. |
| 기능 | 메인의 지침·권한과 기획 스킬의 제한은 별개다. | 일반 수정에서 기획 호출·인덱스 생성 없음. 기획 시 `bstack-clarify`를 로드하고 필요한 경우에만 메서드·독립 검수·인덱스 발행을 사용한다. 보조 에이전트 편집은 금지한다. | 이름이나 설명만으로는 역할을 보장할 수 없다. 실제 호스트의 권한, 도구 호출과 파일 결과가 일치해야 한다. |

## 첫 번째 전문 스킬: `bstack-clarify`

`bstack_prd_start({name:"세로 파쇄"})`는 메인 세션 전용 `.bstack/draft-…/`를 만들고 `folder`를 반환한다. `index.md`는 인덱스, `criteria.md`는 성공 정의·검증·근거 템플릿, `requirements.md`는 요구와 결정 기록이다. 메인은 실제 파일을 작성한 뒤 `bstack_review({})`를 호출한다. 도구가 활성 초안을 읽으므로 본문을 도구 인자로 다시 쓰지 않는다.

미승인 초안이 열린 상태에서 메인이 말로만 끝내면 실행 중인 플러그인이 같은 세션에 후속 작업을 전달한다. 사용자 결정·권한을 기다리거나 명시적 보류일 때는 `bstack_prd_wait`로 **미완료 상태**를 보존한다. 질문의 답은 같은 세션에서 이어가며, 보류한 초안은 같은 이름으로 다시 연다. 호스트 종료·사용자 인터럽트·모델 장애를 무시하거나 새 권한을 얻는 장치는 아니다. 완료 조건은 독립 검수 두 건이 모두 `PASS`이고 `.bstack/<검수 해시>/index.md`와 관련 문서를 실제 발행한 것이다.

인덱스는 **제품 가설 / 기능 × 성공 정의 / 검증 / 근거**로 탐색한다. 설명은 링크로 연결하고 필요한 본문은 `criteria.md`에 둔다. 별도 관련 문서의 이름과 개수는 작업에 맞게 정한다. 합의한 규칙·조사·실험 증거를 보존하되 기존 계약·외부 문서는 복제하지 않아도 된다. 레포 내 원본 링크는 PRD 폴더 기준(`../../docs/…`)이다. 외부 URL은 통신 검증하지 않는다. 두 근거(D: 왜 이 정의인가, V: 통과가 어떤 범위에서 성공을 보장하는가)와 관련 문서를 함께 검수하고 전부 승인해야 묶음을 발행한다. 검증 계획 승인과 실제 제품 성공은 다르다.

이 스킬의 흐름은 **현재 정보의 충분성 판단 → 필요한 정보만 얻기 → 산출물 구성 → 독립 검수 → 승인본 발행**이다. 메인과 검수자는 [동일한 준비도 기준](skills/bstack-clarify/references/rubric.md)을 사용한다. 루브릭은 *어떤 답이 충분한지* 정하고, 방법론은 *빠진 답을 어떻게 얻을지* 정한다. 직접 답하거나 한 문장으로 물을 수 있으면 방법론을 호출하지 않는다. 반례 만들기는 acceptance/interrogate 등의 선택 기법이지 필수 진입·종료 조건이 아니다. 논의 중에는 매번 표를 제출하지 않고, 결정권자나 자료가 없으면 독립 검수로 넘기지 않고 보류한다.

`RESOLVE`·`BLOCKED`·미확정은 승인 문서를 만들지 않는다. 후보 구성 오류(`INVALID_PRD`)는 가능한 한 직접 수정한다. 승인 후 저장 오류(`SAVE_FAILED`)는 완료로 취급하지 않는다. 기획 중에는 제품 소스를 편집하지 않는다. 스킬 종료 후 메인은 사용자가 요청한 범위에 따라 구현할 수 있다.

[Shipping 원본과 bstack 실행 경로의 대응표](docs/shipping-lineage.md). `bstack_review`가 제품/기능 검수 세션을 따로 생성하고 판정을 취합한다. 두 관점이 통과해야 승인한다. PR·병합 또는 pstack 플러그인에 런타임 의존하지 않는다. SDK와 테스트 의존성은 저장소 루트에서 `bun install --frozen-lockfile`로 설치한다.

```sh
./scripts/install/bstack.sh        # 기본 설치: ~/.local/bin/oc-bstack
cd /path/to/project
oc-bstack                         # TUI, 새 세션
oc-bstack run '빈 입력에서 실패하는 테스트를 확인하고 함수를 수정해줘.'
oc-bstack run 'bstack-clarify로 부활 기점의 성공 기준을 정리하자.'
```

OpenCode V2가 필요하다. 모델을 고정하지 않으므로 사용 가능한 모델을 선택한다. 런처는 자체 config/state·DB 이름과 private server를 사용하고 프로젝트의 현재 디렉터리는 유지한다. `OPENCODE_O_BIN_DIR`로 설치 위치를 지정할 수 있다. 실행 시 ECC나 pstack 런타임은 필요 없다. 호스트의 다른 설정과 조직 정책을 무력화하는 보안 샌드박스는 아니다.

[기획 스킬](skills/bstack-clarify/SKILL.md)은 PRD 완성까지 필요한 메서드를 선택한다. [선택 명세](docs/method-selection.md)는 9개 원본 위치·해시·채택 이유를, [예외 패치](docs/port-exceptions)는 변경 근거를 설명한다. 검증된 VM·별도 모델·실행 권한이 없으면 해당 관찰은 미실행으로 표시한다.

## 검증 (저장소 루트에서)

[준비도 루브릭의 설계 근거와 행동 검증 사례](docs/readiness.md)

```sh
python3 profiles/bstack/docs/check-selection.py sources
python3 profiles/bstack/docs/check-selection.py ports
python3 profiles/bstack/docs/check-selection.py alternatives
bun profiles/bstack/tests/host.ts
bun test profiles/bstack/tests/{cycle,artifact}.test.ts
bun profiles/bstack/tests/rework.live.ts
python3 -B profiles/bstack/tests/scenarios.py stage --model <provider/model> --out /tmp/bstack-stage
python3 -B profiles/bstack/tests/main-role.live.py --model <provider/model>
python3 profiles/bstack/tests/scenarios.py clear --model <provider/model> --out /tmp/bstack-trace
python3 profiles/bstack/tests/scenarios.py investigate --model <provider/model> --out /tmp/bstack-probe
python3 profiles/bstack/tests/scenarios.py term --model <provider/model> --out /tmp/bstack-followup
bun profiles/bstack/tests/grounds.live.ts <provider/model>
```

- 앞의 두 명령은 고정 Git 객체(로컬 `ecc` 클론 포함)에서 9개 원본과 패치를 검증한다. `ports`는 불필요한 스킬·누락된 파일·미기록 변경도 실패시킨다.
- `host.ts`는 저장소의 Bun 의존성이 필요하다. 실제 런처에서 메인의 편집·셸 권한, 읽기 전용 조사자와 무도구 검수자의 권한, 본문이 다른 기본 지침에 상시 주입되지 않는지, **기획 스킬 1개와 메서드 9개**의 세션 로딩을 확인한다.
- `main-role.live.py`는 선택한 모델을 실제 호출한다. 같은 세션에서 일반 수정 → 모호한 기획 → 기획을 보류하고 일반 수정으로 복귀하는 세 턴의 파일 내용과 도구 사용을 확인한다.
- `scenarios.py`는 실제 모델을 호출한다. 사례·후속 답·사전 기대 판정은 [scenarios.json](tests/scenarios.json)에 있다. 사례 이름을 바꿔 각각 실행한다. `--out`에는 실제 이벤트가 저장된다. 호출/무호출·작업 파일 불변·지정 메서드 로드를 검사한다. **TRACE PASS는 내용의 적합성 판정이 아니다.** `expect`와 답변을 대조하고, 실행 불가·재현 실패를 통과로 기록하지 않는다. 두 번째 턴이 있으면 같은 세션에서 첫 결정을 유지하는지도 본다.
- `grounds.live.ts`는 유료일 수 있는 별도 모델 검수 시험이다. 매 사례를 새로운 독립 세션에 전달하되 기대 판정은 주지 않는다. **D(왜 이 성공인가)**, **V(조건부로 검증 통과 ⇒ 그 범위의 성공인 이유)** 중 어느 쪽이 빠졌는지와 두 근거가 충분한 미실행 계획을 구별하는지 확인한다. 런타임은 PASS 응답에서 두 근거의 **존재와 제출본 일치**를 검사하며, **내용의 타당성**은 검수자의 판단이다.
