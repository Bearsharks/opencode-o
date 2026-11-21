// Opt-in real evaluator calibration. Requests go directly to fresh bstack-verdict sessions.
// The expected decision/deficient ground is not sent to the model.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {OpenCode} from '@opencode/client';
import {digest,parseReport,type Lane} from '../plugins/review/cycle';

const model=process.argv[2]; assert.ok(model?.includes('/'),'usage: bun grounds.live.ts provider/model');
const slash=model.indexOf('/'), modelRef={providerID:model.slice(0,slash),id:model.slice(slash+1)};
const req='팀 결정: 지정 티켓 한 건에서 상담원이 동료 도움 없이 지정 정답을 식별하는 것이 목표다. 기능 계약은 비인가 ID를 노출하지 않는 것이다. 전체 이용자의 업무 개선은 합의하거나 측정한 적 없다.';
const product={definition:'지정 티켓에서 상담원이 혼자 정답 문서를 식별한다.',verification:'지정 과제에서 선택 ID=정답 ID이고 도움을 받지 않았으면 통과.',grounds:{definition:'상담팀이 원하는 결과는 지정 티켓의 독립 식별이다.',verification:'같은 티켓에서 선택한 문서와 기준 정답, 도움 여부를 직접 대조하므로 해당 과제의 독립 식별을 확인한다.'}};
const fn={definition:'권한 fixture의 비인가 문서 ID는 검색 결과에 없다.',verification:'fixture 계정으로 검색해 비인가 ID와 결과 집합의 교집합이 비면 통과.',grounds:{definition:'비인가 ID 미노출은 권한 계약이다.',verification:'이 fixture의 비인가 집합 전체와 결과를 대조하므로 해당 조회에서 금지된 노출이 없음을 확인한다.'}};
const cases=[
  ['정의 근거 없음','product',{definition:'검색 버튼을 눌렀으면 제품 성공이다.',verification:'버튼 클릭 이벤트를 직접 확인한다.',grounds:{definition:'검색 버튼이 있으므로 클릭 자체가 목표다.',verification:'클릭 이벤트는 그 버튼을 눌렀다는 사실을 확인한다.'}},'RESOLVE','D'],
  ['검증이 대리 신호','product',{...product,verification:'클릭 이벤트 하나가 찍히면 통과.',grounds:{...product.grounds,verification:'정답을 찾을 때도 클릭하기 때문에 통과로 본다.'}},'RESOLVE','V'],
  ['두 근거 충족·아직 미실행','product',product,'PASS',''],
  ['확인하지 않은 범위까지 보장','function',{...fn,verification:'로그인 응답 200인지 확인한다.',grounds:{...fn.grounds,verification:'로그인 성공이면 후속 검색도 접근 제어를 준수할 것이다.'}},'RESOLVE','V'],
  ['한정된 기능 계약과 직접 대조','function',fn,'PASS',''],
] as const;
const directory=mkdtempSync(join(tmpdir(),'bstack-grounds-'));
const pw=crypto.randomUUID();
const server=Bun.spawn([resolve(import.meta.dir,'../bin/oc-bstack'),'serve','--hostname','127.0.0.1','--port','0','--print-logs'],{cwd:directory,env:{...process.env,OPENCODE_DB:undefined,OPENCODE_SERVER_USERNAME:'opencode',OPENCODE_SERVER_PASSWORD:pw},stdout:'pipe',stderr:'pipe'});
let log='';const streams=[server.stdout,server.stderr].map(async s=>{for await(const b of s) log+=new TextDecoder().decode(b)});
try{
  const until=Date.now()+30000;
  while(!log.match(/http:\/\/127\.0\.0\.1:\d+/)&&Date.now()<until&&server.exitCode===null) await Bun.sleep(100);
  const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(url);
  const api=OpenCode.make({baseUrl:url,headers:{authorization:'Basic '+Buffer.from('opencode:'+pw).toString('base64')}});
  for(const [label,lane,row,want,gap] of cases){
    const s=await api.session.create({agent:'bstack-verdict',location:{directory},model:modelRef,title:'bstack rubric calibration'});
    const head=digest([req,lane,row]);
    await api.session.prompt({sessionID:s.id,text:JSON.stringify({head,lane,row,requests:[req],definitions:{product:lane==='product'?row.definition:product.definition,function:lane==='function'?row.definition:fn.definition},evidence:'사용자 결정만 주어졌으며 실제 과제나 기능 검증은 아직 실행하지 않았다.'})});
    await api.session.wait({sessionID:s.id},{signal:AbortSignal.timeout(100000)});
    const a=(await api.session.context({sessionID:s.id})).findLast(m=>m.type==='assistant');
    assert.ok(a?.type==='assistant'&&!a.error&&a.finish==='stop',`${label}: no terminal review`);
    const report=a.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
    console.log(label,report);
    assert.equal(parseReport(report,head,lane as Lane),want);
    if(gap) assert.match(report.split('\n').slice(1).join('\n'),gap==='D'?/\bD\b|정의.{0,8}(근거|이유|정당)/:/\bV\b|검증.{0,8}(근거|범위|충분)/);
  }
}finally{server.kill();await server.exited;await Promise.all(streams);rmSync(directory,{recursive:true,force:true})}
