import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse } from "yaml";
import { loadSkills } from "../plugins/pstack/skills";

export const root = resolve(import.meta.dir, "..");
export const source = JSON.parse(readFileSync(resolve(root, "provenance/source.json"), "utf8"));
export const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function original(path: string): Buffer {
  return execFileSync("tar", ["-xOf", resolve(root, "provenance/upstream.tar"), path]);
}
export function split(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)$/.exec(text);
  if (!match) throw new Error("Missing frontmatter");
  return { attributes: parse(match[1]), header: match[1], body: match[2] };
}
export type Rewrite = { file: string; before: string; after: string; reason: string };
export function ported(path: string, bytes: Buffer, rewrites: Rewrite[] = []): Buffer {
  let text = bytes.toString();
  if (path.endsWith("/SKILL.md")) {
    const before = split(text);
    if (before.attributes["disable-model-invocation"] !== undefined && typeof before.attributes["disable-model-invocation"] !== "boolean") throw new Error("Invalid source invocation policy");
    text = before.attributes["disable-model-invocation"] === undefined
      ? text.replace(/^---\n/, "---\nmetadata:\n  opencode/autoinvoke: true\n")
      : text.replace(/^disable-model-invocation: (true|false)$/m, (_, disabled) => `metadata:\n  opencode/autoinvoke: ${disabled === "true" ? "false" : "true"}`);
  }
  for (const edit of rewrites.filter(edit => edit.file === path.slice("pstack/".length))) {
    if (!edit.reason || !edit.before || text.split(edit.before).length !== 2) throw new Error(`Reviewed edit must match exactly once: ${edit.file}: ${edit.reason}`);
    text = text.replace(edit.before, edit.after);
  }
  return path.endsWith(".md") || rewrites.some(edit => edit.file === path.slice("pstack/".length)) ? Buffer.from(text) : bytes;
}
export function renderReport() {
  const livePath = resolve(root, "provenance/skills-live.json");
  const live = existsSync(livePath) ? JSON.parse(readFileSync(livePath, "utf8")) : undefined;
  const rows = source.order.map((name: string, i: number) => {
    const path = resolve(root, "porting", `${name}.json`);
    if (!existsSync(path)) return `| ${i + 1} | ${name} | 대기 | — | — | — |`;
    const record = JSON.parse(readFileSync(path, "utf8"));
    const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
    const verified = live?.results.find((r: any) => r.name === name && r.fileSha256 === sha(readFileSync(resolve(root, `skills/${name}/SKILL.md`))));
    const status = verified ? "본문·파일 보존 + 실제 호스트 등록·명시 로드 확인" : "본문·파일 검증 완료; 실제 호스트 로드 대기";
    const evidence = `[파일별 해시·검사 기록](porting/${name}.json)` + (verified ? "; [로드 증거](provenance/skills-live.json)" : "") + (record.runtimeEvidence ?? []).map((file: string) => `; [실행 검증](${file})`).join("");
    return `| ${i + 1} | [${name}](skills/${name}/SKILL.md) | ${status} | ${cell(record.changes)} | ${cell(record.equivalence)} | ${evidence} |`;
  });
  const extras = source.additionalScope.map((scope: string) => {
    const name = scope.startsWith("automations/benny/") ? "benny" : scope.split("/").at(-1);
    const path = resolve(root, `porting/additional/${name}.json`);
    if (!existsSync(path)) return `| ${scope} | 대기 | — | — |`;
    const record = JSON.parse(readFileSync(path, "utf8"));
    const safe = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
    const skill = live?.results.find((r: any) => r.name === name && r.fileSha256 === sha(readFileSync(resolve(root, `skills/${name}/SKILL.md`))));
    const status = record.registered ? (skill ? "실제 호스트 등록·명시 로드 확인" : "호스트 로드 대기") : "원본 절차 보존; 외부 자동화 실행 기반 필요";
    return `| ${scope} | ${status} | ${safe(record.changes)} ${safe(record.equivalence)} | [파일별 근거](porting/additional/${name}.json) |`;
  });
  writeFileSync(resolve(root, "PORTING.md"), `# 스킬별 포팅 보고서

원본: \`${source.commit}\`. 이전 포트의 파일을 복사하지 않고 고정 원본에서 새로 포팅했다.
원문 archive와 파일별 해시, 정확한 치환 전후 문자열을 보존한다. 테스트는 원문에 기록된 치환만 적용한 결과와 설치 파일 전체를 비교한다.

본문 보존과 실제 호스트 등록은 모델의 모든 판단이나 복합 워크플로 성공을 보증하지 않는다.
역할·설정·실패·재사용·예약·웹훅은 별도의 실제 호스트 실행 근거로 구분한다.

| 순서 | 스킬 | 상태 | 포팅한 내용 | 원본과 동등한 근거 | 증거 |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## 추가 범위

| 스킬·범위 | 상태 | 변경과 동등성·한계 | 증거 |
| --- | --- | --- | --- |
${extras.join("\n")}

Benny의 3개 운영 스킬은 원본처럼 slash 목록에 등록하지 않는다. 전체 pack을 보존하지만 Slack 트리거·외부 편집기·클라우드 checkout 실행은 미구현이며 활성화하지 않았다. native/create-skill과 native/visualize는 원본에 없는 환경 의존 기능을 보충한 스킬이다.

## 실행 검증

- [전체 스킬](provenance/skills-live.json): 실제 카탈로그·호출 정책·명령·명시적 본문 로드. 본문 해시가 현재 파일과 맞을 때만 위 표에 반영한다.
- [역할](provenance/models-live.json): 17개 역할·20개 실제 자식의 제공자 요청에 모델과 추론량 전달, 역할 누락 거부, 위임 에이전트 본문.
- [실패·재사용](provenance/model-failures-live.json): 전경·백그라운드 병렬 모델 거부 보존, 원래 설정값 복귀, 엄격한 자식 재사용, 명시적 모델로 독립 감사 우회 차단.
- [설정](provenance/setup-live.json): 17개 역할·4예산 계획, 부분 설정과 alias·중복 좌석 보존, 검증·원자적 저장·오래된 저장 거부, 저장 모델의 실제 위임.
- [기록](provenance/history-live.json), [프로그램 상태·worktree](provenance/core-live.json): 압축 전 기록·범위 제한·프로그램 공유 상태·경합·이벤트.
- [모드·예약](provenance/modes-schedules-live.json): 지속 모드와 해제, 재시작 복구, 타이머·native 이벤트·loop 중지.
- [웹훅](provenance/routines-live.json): 생성·비밀 입력·wake·재시작·삭제. 실제 외부 서비스나 UI의 성공을 대신하는 근거는 아니다.
- [위임 구조](provenance/topology-live.json): 원본 3계층 조정자와 검수·조사 보조 호출.
- [statechart](provenance/statechart-tests.json): 실제 TLC·Java·렌더·원본 corpus 검사. [부속 스크립트](provenance/helper-tests.json): 원본 decision log와 watcher·계획 검사.
- [충돌 처리](provenance/overrides-live.json), [런처](provenance/launcher-live.json), [Freefy 실행](provenance/project-live.json): 프로필 우선순위·명시적 override·독립 서비스·주 에이전트·실제 프로젝트 스킬 확인.
- [프로필 분리](provenance/profile-isolation-live.json), [당시 Freefy 검수 호환](provenance/freefy-review-live.json): 당시 oc-lite 검수 도구 유지·pstack 비활성화·명령 충돌을 검증했다. 이후 Freefy dev의 프로젝트 스킬·자체 검수·goal은 제거됐으며, 이 파일은 검사 시점의 이력이다.
- [설치된 실제 서비스](provenance/installed-live.json): 실행 중인 세션이 없는 상태에서 새 런처로 재시작 후 Freefy의 주 에이전트·63개 스킬·플러그인 오류 부재 확인.

## 플랫폼상 남는 차이

클라우드 VM 생성·원격 자식 전송·VM 상태 fork는 제공하지 않는다. 해당 전제가 필수인 단계를 로컬 worktree로 축소하지 않고 BLOCKED로 보고한다.
예약·웹훅은 OpenCode 서비스가 실행 중이어야 전달된다. 상주 서비스가 없는 클라우드 호스팅이나 오프라인 전달 보장을 뜻하지 않는다.
Benny에는 외부 Slack 이벤트 구독·검토 편집기·비밀 격리 실행기가 필요하다. 이미지 생성과 실제 앱 제어도 연결된 도구와 프로젝트별 환경이 필요하다.
모델 카탈로그에 없는 모델·추론 단계·fast 속도를 만들어내지 않는다. 원본의 가용성 fallback 또는 명시적 미실행으로 보고한다.
`);
}

// This build-time operation accepts exactly one reviewed skill. It is not loaded by OpenCode.
if (import.meta.main) {
  const [name, rationale] = process.argv.slice(2);
  if (name === "--report") { renderReport(); process.exit(0); }
  if (!source.order.includes(name) || !rationale) throw new Error("Usage: port-skill.ts NAME EQUIVALENCE_REASON");
  const earlier = source.order.slice(0, source.order.indexOf(name));
  if (earlier.some((s: string) => !existsSync(resolve(root, "porting", `${s}.json`)))) throw new Error("Finish the preceding skill first");
  if (sha(readFileSync(resolve(root, "provenance/upstream.tar"))) !== source.archiveSha256) throw new Error("Source archive changed");
  const paths = Object.keys(source.files).filter(p => p.startsWith(`pstack/skills/${name}/`));
  const rewritePath = resolve(root, "porting/changes", `${name}.json`);
  const rewrites: Rewrite[] = existsSync(rewritePath) ? JSON.parse(readFileSync(rewritePath, "utf8")) : [];
  if (rewrites.some(edit => !paths.includes(`pstack/${edit.file}`))) throw new Error("Rewrite references a file outside this skill");
  const files = [];
  const prepared = paths.map(path => {
    const bytes = original(path);
    if (sha(bytes) !== source.files[path]) throw new Error(`Source hash mismatch: ${path}`);
    const output = ported(path, bytes, rewrites);
    if (/\.(md|ts|js|sh|json)$/.test(path) && /\bCursor\b|\.cursor[\\/]|\bTask\s*\(|subagent_type|run_in_background|generalPurpose|disable-model-invocation/.test(output.toString())) {
      throw new Error(`Needs individual native implementation: ${path}`);
    }
    const destination = resolve(root, path.slice("pstack/".length));
    if (existsSync(destination) && !readFileSync(destination).equals(output)) throw new Error(`Refusing to overwrite reviewed edits: ${destination}`);
    return { path, bytes, output, destination };
  });
  for (const { path, bytes, output, destination } of prepared) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, output);
    chmodSync(destination, source.modes[path]);
    if (!readFileSync(destination).equals(output)) throw new Error(`Write verification failed: ${path}`);
    files.push({ path: path.slice("pstack/".length), sourceSha256: sha(bytes), portSha256: sha(output), mode: source.modes[path], bodyUnchanged: path.endsWith("SKILL.md") ? split(output.toString()).body === split(bytes.toString()).body : undefined });
  }
  const native = loadSkills(resolve(root, "skills")).find(skill => skill.name === name)!;
  const before = split(original(`pstack/skills/${name}/SKILL.md`).toString());
  const expected = split(ported(`pstack/skills/${name}/SKILL.md`, original(`pstack/skills/${name}/SKILL.md`), rewrites).toString());
  if (!native || native.autoinvoke !== !before.attributes["disable-model-invocation"] || native.content !== expected.body.slice(1) || native.description !== expected.attributes.description) throw new Error("Native skill loader changed reviewed content");
  const record = { name, changes: "호출 제한을 OpenCode metadata.opencode/autoinvoke로 변환. " + (rewrites.length ? rewrites.map(e => e.reason).join(" ") : "본문과 보조 파일 보존."), equivalence: rationale, checks: ["source SHA-256", "all source paths included", rewrites.length ? "exact reviewed replacements; all other bytes preserved" : "body byte equality", "native loader content/description/autoinvoke equality", "legacy instruction scan"], rewrites, files };
  const previous = resolve(root, "porting", `${name}.json`);
  if (existsSync(previous)) {
    const evidence = JSON.parse(readFileSync(previous, "utf8")).runtimeEvidence;
    if (evidence) Object.assign(record, { runtimeEvidence: evidence });
  }
  writeFileSync(resolve(root, "porting", `${name}.json`), JSON.stringify(record, null, 2) + "\n");
  renderReport();
  console.log(`PASS ${name}: ${files.length} files; ${rewrites.length} reviewed replacements; invocation policy preserved`);
}
