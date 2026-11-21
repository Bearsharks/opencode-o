# 일곱 메서드에 대한 반대 검토

> 역사 기록: 아래 비교 당시에는 일곱이었으며, 이후 사용자가 두 추가 후보를 승인했다. 현재의 9개 명세는 [선택 문서](method-selection.md)가 기준이다.

이 조사는 일곱 원본의 정합성 검사가 아니다. 질문은 **기존 선택보다 다른 스킬이 적은 가정으로 판정표의 같은 공백을 해결할 수 있는가**다. 소스 버전은 [선택 명세](method-selection.md)의 E와 P를 쓴다.

## 범위와 발굴 방법

고정본의 직접 자식 `skills/<id>/SKILL.md` 목록은 ECC 328개, pstack 64개다. 명령·에이전트·번역·중첩 플레이북은 이 모집단에 포함하지 않았다. `inventory` 명령은 이 목록과 원본 경로를 전부 출력한다. **392개를 정독했다는 뜻은 아니다.** 목록에서 목적이 비슷한 이름을 찾고, 근거 분류·측정 타당성·반대 의견·경계 사례·검증 시점에 해당하는 본문을 좁혀 읽었다. 두 Runner의 ECC/pstack 독립 탐색 제보도 사용하되 아래 인용은 번역이나 요약이 아니라 직접 고정 원문의 해당 줄과 대조했다.

가설을 먼저 나눴다. (1) 근거는 있는데 사실인지 추론인지 모른다. (2) 지표는 있는데 판정을 바꾸는 측정인지 모른다. (3) 대안끼리 채점할 기준 자체가 합의되지 않았다. (4) 기능 기준이나 재현의 범위가 잘못됐다. (5) 주관적 경험·반복 실행처럼 제한된 영역에서만 필요한 방법이다. 이에 대해 **기존 일곱에 없는** 다음 원본들을 비교했다. 표의 인용은 해당 범위 안의 연속 원문이다.

| 저장소 | 대조 스킬 | 본문 행 | 확인한 원문 | 기존 선택보다 나은 상황 / 이번 판단과 전환 조건 |
|---|---|---|---|---|
| E | research-ops | 43–51 | Do not restart the analysis from zero | 사용자 발언·티켓·팀의 추정이 이미 한 묶음이면 swarm보다 먼저 할 일은 증거 분류다. 69–78행은 출처 있는 사실·사용자 맥락·추론·권고를 나눈다. **추가 심의 후보**. 보유 자료 정리만으로 부족한 경우에만 외부 조사로 확장한다. 원본은 모니터링·영업 조사 분기도 포함하므로 거의 그대로 이식할 때 그 비용도 검토한다. |
| P | principle-explain-the-number | 10–15 | Name the result that would change a decision, and the noise floor. | ‘2% 빨라지면 성공’인데 반복 편차가 5%라면 arena에서 지표 후보를 더 만드는 것으로는 해결되지 않는다. 결정을 바꿀 값·잡음·다른 설명을 요구한다. **수치 판정의 추가 심의 후보**. 실제 성능 측정은 원본이 benchmark-checklist로 넘긴다. 관찰이 없으면 숫자를 확정하지 않는다. |
| E | council | 118–125 | always include the strongest dissent | 빠른 처리와 복구 가능성 중 무엇을 우선할지 불분명하면 arena는 아직 채점표가 없다. council은 입장과 가장 강한 반대를 보존하므로 결정권자에게 줄 선택지를 만드는 데 낫다. **조건부 대안**. 정책 소유자의 한 답으로 끝나는 경우 context-and-decisions보다 비싸고, 패널 권고는 사용자 결정이 아니다. |
| E | intent-driven-development | 25–29 | materially change scope or behavior | 이미 합의된 PRD에서 금지 부작용·검증 방법만 빠졌다면 추가 인터뷰를 하지 않는 이 절차가 유리하다(56–59행). 경험을 깨는 거짓 통과/과도하게 막는 거짓 탈락이 핵심이면 acceptance가 직접적이다. **대체 후보**. 기존 명세의 부분 보완이 주 사용례가 되면 재선정한다. |
| E | product-capability | 65–92 | failure and recovery expectations | 여러 팀의 부분 취소에서 누가 환불을 소유하고 복구 시 어떤 상태를 지킬지가 미정이면 용어 일치만으로 충분하지 않다. 불변조건·전이를 추출하는 이쪽이 낫다. **조건부 대안**. 단순 용어 결정에는 SRS·인터페이스 작성이 범위를 넘는다. |
| E | deep-research | 151–160 | If only one source says it, flag it as unverified. | 최신 외부 주장에 상반된 출처가 있다면 일반 fan-out보다 교차 확인·최신성·추론 표시가 중요하다. **외부 정보 조사에 한해 swarm보다 적합**. 내부 제품 선호는 외부 출처 수로 정하지 않는다. |
| E | scientific-thinking-scholar-evaluation | 72–89 | Are missing data and bias risks discussed? | 표본에서 포기한 사용자가 빠졌다면 추가 자료원의 수보다 선택 편향·대조군·대안 설명 검토가 급하다. 연구를 제품 근거로 삼는 경우 단순 출처 분류보다 낫다. **범용 이식 제외**. 실제 연구 결과의 타당성 평가가 요청된 경우 재검토한다. |
| E | eval-harness | 273–288 | stability test (all 3 runs must pass) | 에이전트가 ‘재시도 내 한 번 성공’해야 하는지 ‘매번 성공’해야 하는지를 구분한다. 반복 신뢰성이 요구인 경우 이 구분이 단일 프로토타입보다 낫다. **bstack 자체의 향후 행동 평가 후보**, 일상 기획 메서드는 아님. 원본의 권장 임계값은 사용자 목표의 근거가 아니다. |
| E | click-path-audit | 33–42 | Does any later call UNDO a state change from an earlier call? | 완료 이벤트를 보냈지만 후속 호출이 상태를 되돌린 UI라면 일반 interrogate보다 좁고 명확한 추적법이다. **현재 UI에서 잘못된 성공 신호를 조사할 때만**. 실행 대상이나 관측 자료도 없는 제품 발견 단계에는 맞지 않는다. |
| P | sharpen | 8–17 | Say what, other than you or me, would show the result is right. | 외부 관찰자나 원자료를 한 번 묻는 것으로 판정 근거를 찾을 수 있다면 전체 product-lens 인터뷰보다 가볍다. **독립 이식 보류**. 원본의 종점은 프롬프트 재작성이지 판정 근거의 검증이 아니다. |
| P | principle-attack-the-premise | 10–20 | Find an observation that would come out differently if the premise were false | 여러 판정안이 같은 전제로 연속 실패하면 후보를 더 만들기보다 전제를 직접 깨는 관찰이 낫다. **조건부 보류**. 원본 조건은 같은 전제의 수정이 둘 이상 실패한 경우다. 첫 요청부터 강제하지 않는다. |
| P | principle-exhaust-the-design-space | 3–10 | Build 2-3 competing prototypes and compare side by side | 논리보다 ‘느낌’이 중요한 인터랙션에는 단일 시연보다 비교가 필요하다. **별도 스킬 제외**. 이미 prototype 원본의 10–11행이 동일 전환기와 해당 표면의 직접 관찰을 명시한다. 새로운 해결 기능을 추가하지 않는다. |
| P | figure-it-out | 26–43 | Inconclusive is not a pass. | 큰 작업의 baseline과 불확실 판정은 유용하지만, 원본은 계획 후 작은 변경을 실행하고 측정한다. **전체 이식 제외**. 구현 실행까지 맡기는 별도 프로필이라면 다시 비교할 수 있다. |

## 이 조사로 달라진 판단

‘일곱으로 충분’은 철회한다. **근거가 섞인 상황**과 **수치의 판별력이 불명확한 상황**에는 기존 일곱보다 직접적인 원본이 있다. 우선 `research-ops`와 `principle-explain-the-number`를 별도 도입 심의에 올린다. `council`은 arena 대용이 아니라 **채점 기준을 정하기 전의 의견 충돌**이라는 다른 용도로 보류한다. 일곱을 자동으로 아홉으로 바꾸거나 프로필을 수정한 것은 아니다.

남은 결정은 실사용 빈도와 원본 보존 비용이다. ‘사용자 결정과 추론을 섞은 자료’, ‘효과보다 편차가 큰 지표’ 두 사례에서 기존 일곱으로 구한 표와 새 후보를 사용한 표를 비교한다. **새 후보만 잘못된 확정을 막거나 근거 있는 판정을 가능하게 하고**, 원본의 필수 의존성·권한을 보존할 수 있다면 승격할 이유가 있다. 이 비교 실험은 아직 하지 않았다.

```sh
python3 profiles/bstack/docs/check-selection.py inventory     # 고정 Git 트리의 모집단 전체
python3 profiles/bstack/docs/check-selection.py alternatives  # 미채택 원본의 줄 범위·실제 인용·중복 여부
```

첫 명령은 탐색 범위, 둘째는 인용의 진위를 재현한다. 검토자의 판단이나 읽은 시간, 상대적인 효과, 392개 후보 중 전역 최적임을 증명하는 명령은 아니다.
