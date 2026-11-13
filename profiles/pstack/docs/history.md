# 세션 이력 조회와 검색

`pstack_history`는 OpenCode가 저장한 메시지를 native API로 읽는다. 별도 기억 저장소나 컴팩션 복구 엔진이 아니며, 중요한 결정을 자동으로 재주입하지 않는다. 임시 검색 커서에는 위치·검색 조건만 저장하고 대화 본문을 복제하지 않는다.

## Native와의 구분

OpenCode 2.2.7의 `session list/export` CLI와 세션·메시지 API가 같은 원본 이력을 제공한다. Code Mode에는 HTTP 요청 기능도 있으므로 native 경로로 조회하는 것이 불가능한 것은 아니다.

검사한 기본 모델 도구·등록 카탈로그에는 전용 이력 목록·읽기·본문 검색 도구가 없었다. [확인한 카탈로그](../provenance/native-history-tools.json)는 해당 런타임의 검사 결과이며 다른 플러그인이나 미래 버전까지 일반화하지 않는다.

현재 `recall`·`automate-me`는 탐색과 범위가 정해진 읽기, `reflect`는 현재 대화 확인과 비공개 JSONL, `eval`은 위임자의 실제 메시지를 사용한다. 이 사용 경로를 CLI/API 조합으로 되돌리지 않기 위해 지금은 유지한다. 동등한 모델용 native 기능이 생기면 소비 스킬까지 함께 전환한다.

## 입력과 결과

| action | 필수 입력 | 결과 |
| --- | --- | --- |
| `current` | action | 현재 세션 정보 |
| `list` | action | 범위 안 세션 metadata와 native 다음 커서 |
| `search` | action, query | 범위 안 모든 세션의 일치 메시지. sessionID가 있으면 그 대화만 검색 |
| `read` | action, sessionID | 지정 대화의 전체 메시지 페이지 |
| `export` | action, sessionID | 지정 대화의 전체 메시지를 접근 권한 0600인 JSONL로 저장 |

검색 예:

```json
{"action":"search","query":"컴팩션","limit":20}
{"action":"search","repositoryHistory":true,"query":"compaction","limit":100}
{"action":"search","sessionID":"<실제 세션 ID>","query":"덮어","limit":20}
```

`search`는 `matches`에 `sessionID`, 세션 제목, native `message`를 반환한다. 메시지 ID는 `message.id`다. 특정 세션 검색도 같은 구조를 사용하며 본문을 별도 `messages` 필드에 중복 반환하지 않는다. `read`의 결과는 기존처럼 `messages`다.

검색 `limit`는 일치 결과 수의 상한이다. 한 호출의 조회량은 제한되므로 일치 결과가 0개여도 커서가 남을 수 있다. 같은 query와 범위를 유지하고 반환된 `cursor`를 전달해 `complete: true`까지 이어간다. 검색 커서는 한 시간 동안 유효하며, list/read의 native 커서와 섞거나 범위·검색어를 바꿔 재사용하지 않는다. 세션·메시지가 계속 바뀌는 이력에 대한 실시간 조회이며 고정 snapshot이나 의미 검색이 아니다.

검색 결과의 `scope`는 실제 directory·project·세션 제한을, `source`는 실제 서비스 PID·버전, 알려진 프로필과 DB 환경 설정, 다른 DB를 조회하지 않았다는 사실을 표시한다. DB 환경 설정이 null이면 파일 위치를 추정하지 않는다. `repositoryHistory: true`는 같은 Git 저장소의 과거 worktree까지 범위를 넓히지만 다른 DB를 열지 않는다. 사용자가 요청한 범위에서만 사용한다.

`complete: true`이고 결과가 없어도 현재 서비스/DB의 해당 범위에 대한 결과일 뿐이다. 다른 프로필 DB까지 검색했거나 과거 대화 자체가 없다고 판단하지 않는다. 다른 DB 검색·세션 관리·자동 기억 보존은 이 도구의 역할이 아니다.
