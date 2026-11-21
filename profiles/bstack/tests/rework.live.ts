// Real OpenCode sessions/tools/storage; loopback scripted provider, no credentials or quota.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {ready,testHost} from '../../pstack/scripts/test-host';

const profile=resolve(import.meta.dir,'..');
const config=JSON.parse(readFileSync(resolve(profile,'opencode.jsonc'),'utf8'));
for(const a of Object.values(config.agents) as any[]) if(a.system) a.system=a.system.replace(/\{file:([^}]+)\}/g,(_:string,p:string)=>readFileSync(resolve(profile,p),'utf8'));
const reviewed:any[]=[];
const product={definition:'Identify the correct document',verification:'count clicks',grounds:{definition:'support policy',verification:'Comparison against the known correct ID verifies identification for this ticket.'}};
const fn={definition:'exclude unauthorized IDs',verification:'compare ID sets with fixture',grounds:{definition:'permission contract',verification:'Any unauthorized ID differs from the expected set.'}};
const documents=[{file:'requirements.md',title:'Support workflow',body:'Ticket owners independently identify the known correct document; permission fixtures determine which IDs may appear. Do not infer population-wide impact.'}];
let folder='',step=0;
const endpoint=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  const b=await req.json(); const index=b.messages.findLastIndex((m:any)=>m.role==='user');
  const user=b.messages[index].content;
  const text=typeof user==='string'?user:user.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('');
  let call:any,answer='';
  if(text.trim().startsWith('{')) {
    const v=JSON.parse(text); assert.deepEqual(v.documents,documents); reviewed.push(v);
    const status=v.lane==='product' && v.row.verification==='count clicks'?'RESOLVE':'PASS';
    const head=v.row.verification==='wrong receipt'?'0'.repeat(64):v.head;
    answer=`VERDICT: ${status} ${head} ${v.lane}\n${status==='RESOLVE'?'V: Wrong document clicks count too. Compare selected ID with the known answer.':`D: ${v.row.grounds.definition}\nV: ${v.row.grounds.verification}`}`;
  } else if(b.tools?.some((t:any)=>t.function?.name==='bstack_review')) {
    const invoke=(name:string,args:object)=>({index:0,id:`call_${step}`,type:'function',function:{name,arguments:JSON.stringify(args)}});
    switch(step++){
      case 0: call=invoke('bstack_prd_start',{name:'Support workflow'});break;
      case 1:{
        const m=JSON.stringify(b.messages).match(/\.bstack\/draft-Support workflow-[a-f0-9]{10}/);
        assert.ok(m);folder=m[0];answer='I will work on that.';break; // Deliberately erroneous stop.
      }
      case 2: call=invoke('bstack_review',{});break; // Template must not pass.
      case 3:{
        const vals=[product,fn].flatMap(r=>[r.definition,r.verification,r.grounds.definition,r.grounds.verification]).concat('policy v1');
        const command=`cd '${folder}' && python3 - <<'PY'\nfrom pathlib import Path\np=Path('criteria.md');s=p.read_text()\nfor v in ${JSON.stringify(vals)}: s=s.replace('⟪작성⟫',v,1)\np.write_text(s);Path('requirements.md').write_text(${JSON.stringify('# '+documents[0].title+'\n\n'+documents[0].body+'\n')})\nPY`;
        call=invoke('shell',{command});break;
      }
      case 4:call=invoke('bstack_review',{});break;
      case 5:answer='The reviewer wants a different verification.';break; // Must resume from RESOLVE too.
      case 6:call=invoke('shell',{command:`cd '${folder}' && sed -i.bak 's/count clicks/compare selected ID with known answer/' criteria.md && rm criteria.md.bak`});break;
      case 7:call=invoke('bstack_review',{});break;
      case 8:answer='fixture complete';break;
      default:call=invoke('bstack_prd_wait',{kind:'question',reason:'fixture diagnostic: missing approval'});if(step>10)answer='awaiting input',call=undefined;
    }
  } else answer='fixture';
  const chunk=(delta:any,finish:any)=>'data: '+JSON.stringify({id:'bstack-test',object:'chat.completion.chunk',created:1,model:b.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n';
  return new Response(chunk(call?{role:'assistant',tool_calls:[call]}:{role:'assistant',content:answer},null)+chunk({},call?'tool_calls':'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}});
try {
  const host=await testHost({...config,model:'pstack-test/gpt-parent',plugins:[resolve(profile,'plugins/review'),{package:resolve(profile,'../pstack/scripts/fixtures/models'),options:{url:`http://127.0.0.1:${endpoint.port}/v1`}}]});
  try {
    execFileSync('git',['init','-q',host.project]);writeFileSync(resolve(host.project,'policy.md'),'# Access\nLeast privilege');
    documents[0].body+=' See [policy](../../policy.md#access).';
    await ready(host,'bstack-review'); await ready(host,'pstack-test-models');
    const cli=host.run(['opencode','--standalone','run','--format','json','--archived','--agent','bstack','BSTACK_TEST Customer must identify the correct document unaided; permissions determine visible IDs.'],{PWD:host.project});
    const timer=setTimeout(()=>cli.kill(),65000);
    const [stdout,stderr,exit]=await Promise.all([new Response(cli.stdout).text(),new Response(cli.stderr).text(),cli.exited]);clearTimeout(timer);
    assert.equal(exit,0,`step=${step} ${stderr}\n${stdout.slice(0,7000)}\n${stdout.slice(-700)}`);
    const events=stdout.trim().split('\n').map(s=>JSON.parse(s));
    const receipts=events.filter(e=>e.part?.tool==='bstack_review').map(e=>JSON.parse(e.part.state.output));
    assert.deepEqual(receipts.map(r=>r.status),['INVALID_PRD','RESOLVE','PASS'],JSON.stringify(receipts));
    const [,a,b]=receipts;
    assert.deepEqual(readdirSync(resolve(host.project,'.bstack')).sort(),[folder.split('/')[1],b.head].sort());
    assert.equal(b.artifact,`.bstack/${b.head}/index.md`);
    assert.equal(readFileSync(resolve(host.project,'.bstack',b.head,'requirements.md'),'utf8'),`# ${documents[0].title}\n\n${documents[0].body}\n`);
    assert.match(readFileSync(resolve(host.project,b.artifact),'utf8'),/\| 제품 가설 \|/);
    assert.notEqual(a.head,b.head); assert.notEqual(a.votes.product.reviewer,a.votes.function.reviewer);
    assert.equal(a.votes.product.reviewer,b.votes.product.reviewer); assert.deepEqual(a.votes.function,b.votes.function);
    assert.deepEqual(reviewed.map(v=>v.lane).sort(),['function','product','product']);
    assert.match(reviewed.find(v=>v.revision===2).previousFinding,/Wrong document clicks/);
    console.log('PASS: standalone primary → start → premature stop → automatic continuation → untouched template rejected → RESOLVE → premature stop → automatic revision → two approvals → published files');
  } finally {await host.close()}
} finally {await endpoint.stop(true)}
