# 독립 리뷰 프로필

순정 OpenCode 2.0.14의 **기존 공유 서비스**에서 별도 primary 리뷰 세션을
실행한다. oc-lite의 worker/runner 프로필을 전역으로 교체하지 않으며,
같은 DB에 private server를 추가하지 않는다. 모델은 `openai/gpt-6.1-sol`이다.

`prepare.py`는 새 리뷰 전용 디렉터리에만 설정을 만든다. 후보의 코드·설정은
그 디렉터리로 복사하지 않는다. 제어부가 고정 후보 reader를 제공한다.

```sh
npm ci --ignore-scripts --prefix profiles/oc-review
python3 profiles/oc-review/prepare.py \
  --directory /absolute/new-review-location \
  --control /absolute/accepted-controller \
  --binding /absolute/controller-state/review-binding.json \
  --ready /absolute/controller-state/review-ready.json \
  --workflow /absolute/controller-state/workflow-config.json
```

메시지 연결은 oc-lite의 기존 `setupJobMessages`를 재사용한다. `--messaging`은
격리 시험용 기존 설정 파일 경로를 지정할 때만 사용한다. 비밀 자체를 프로필이나
후보에 넣지 않는다. 제어부는 `opencode api`로 공유 서비스에 세션을 만들 때
`location.directory`를 위 디렉터리로 지정한다. 새 CLI의 환경변수만 바꿔
이미 실행 중인 서비스의 시작 프로필이 바뀐다고 가정하지 않는다.

실제 로더에서 `oc-review.primary`와 `oc-review.execution-guard`가 모두
active여야 한다. 실행 제한은 카탈로그뿐 아니라 typed Effect 실행 전 훅에도
적용한다. 리뷰어는 고정 파일 읽기·검색·합의한 검사 요청·결과 제출만 수행한다.
`completeJob`, 제품 편집, 임의 shell, 추가 에이전트, 직접 PR 쓰기는 제공하지 않는다.

결과는 기존 메시지 서비스의 `sendPeerMessage`로 제출한다. 발신자는 런타임의
실제 세션에서 결정하고 수신 대상·후보·회차는 제어부 binding에서 가져온다.
큐 저장 후 짧은 도착 알림만 `steer`한다. 제출은 리뷰 결과 전달이며 공식 작업
완료 판정이 아니다. `sendPeerMessage`가 없는 운영 서비스에는 아직 연결할 수 없다.

검사:

```sh
python3 profiles/oc-review/prepare.test.py
bun test profiles/oc-review/guard.test.ts
bun test profiles/oc-lite/plugins/oc-lite-v2/job-messages.test.ts
```

로더 활성·단위 검사와 실제 리뷰→수정→재리뷰·CI·공식 완료 인수는 별개다.
제품 제어부의 실행 근거와 미완료 범위는 해당 작업 PR에서 관리한다.
