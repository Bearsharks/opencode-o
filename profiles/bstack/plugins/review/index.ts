import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { publishBundle } from './artifact';
import { fresh, identity, lanes, parseReport, conclude, type Cycle, type Lane } from './cycle';
import {readDraft,startDraft,type Draft} from './workspace';

const str={type:'string',minLength:1,pattern:'\\S'};
export default Plugin.define({id:'bstack-review',async setup(ctx){
  const busy=new Set<string>();
  const get=async(id:string)=>await ctx.storage.get(`draft/${id}`) as unknown as Draft|undefined;
  const put=(id:string,d:Draft)=>ctx.storage.set(`draft/${id}`,d);
  const armed=new Set<string>();
  const emptyStops=new Map<string,number>();
  const resume=async(id:string)=>{
    const d=await get(id);if(d?.phase==='waiting'){d.phase='active';delete d.reason;await put(id,d)}
    emptyStops.delete(id);
  };
  await ctx.tool.transform(ed=>ed.add({name:'bstack_prd_start',options:{codemode:false},
    description:'Open a named PRD workspace with index, criteria and requirements templates. Use immediately on entering bstack-clarify. Only independent approval completes it.',
    input:{type:'object',properties:{name:str},required:['name'],additionalProperties:false},output:{type:'object'},
    async execute(input,tool){
      const id=tool.sessionID;
      if(tool.agent!=='bstack'||busy.has(id))throw Error('Primary bstack only; concurrent PRD operation not allowed');
      busy.add(id);
      try{
        const first=(await ctx.session.context({sessionID:id})).findLast(m=>m.type==='user')?.id;
        if(!first)throw Error('No user request');
        const old=await get(id),name=input.name.trim().normalize('NFC');
        if(old && old.name!==name && ['active','waiting'].includes(old.phase))throw Error(`Finish or explicitly defer ${old.folder} first`);
        const saved=await ctx.storage.get(`named/${id}/${encodeURIComponent(name)}`) as unknown as Draft|undefined;
        const draft=old?.name===name?old:saved??startDraft(ctx.location.directory,name,id,first);
        // Explicit reopen for a new revision. Previous approved snapshots are immutable.
        draft.phase='active'; delete draft.artifact;delete draft.reason;
        await ctx.storage.set(`named/${id}/${encodeURIComponent(name)}`,draft);
        await put(id,draft);armed.add(id);
        return {output:{status:'DRAFT',name,folder:draft.folder,files:['index.md','criteria.md','requirements.md']}};
      }finally{busy.delete(id)}
    }}));
  await ctx.tool.transform(ed=>ed.add({name:'bstack_prd_wait',options:{codemode:false},
    description:'Suspend, never approve: only for a concrete missing user decision/access, or an explicit user hold. Record known decisions in the draft first.',
    input:{type:'object',properties:{reason:str,kind:{enum:['question','hold']}},required:['kind','reason'],additionalProperties:false},output:{type:'object'},
    async execute(input,tool){
      const id=tool.sessionID,d=await get(id);
      if(tool.agent!=='bstack'||!d||d.phase==='approved'||busy.has(id))throw Error('No available unapproved primary draft');
      d.phase=input.kind==='hold'?'held':'waiting';d.reason=input.reason;await put(id,d);armed.delete(id);
      return {output:{status:d.phase==='held'?'ON_HOLD':'NEEDS_INPUT',folder:d.folder,reason:input.reason}};
    }}));
  // A real user reply reopens a question, never an explicitly deferred project.
  await ctx.session.hook('prompt',({sessionID})=>resume(sessionID));
  await ctx.tool.hook('execute.after',async event=>{
    if(event.agent!=='bstack'||event.status!=='completed')return;
    if(event.tool==='question')await resume(event.sessionID);
    else emptyStops.delete(event.sessionID);
  });
  await ctx.session.hook('context',async q=>{
    if(q.agent!=='bstack')return;
    const d=await get(q.sessionID);if(d?.phase!=='active'){armed.delete(q.sessionID);return}
    armed.add(q.sessionID);
    q.system.push({type:'text',text:`Open PRD: ${d.folder}. Work on the actual draft and call bstack_review. A prose answer does not close it. For a genuine missing decision use bstack_prd_wait and ask it; respect user cancellation.`});
  });
  await ctx.tool.transform(ed=>ed.add({name:'bstack_review',options:{codemode:false},
    description:'Review the files in the active PRD workspace. No arguments. Two independent reviewers must approve the saved draft before publication. Fix RESOLVE findings in the same folder.',
    input:{type:'object',properties:{},additionalProperties:false}, output:{type:'object'},
    async execute(input,tool){
      const id=tool.sessionID, draft=await get(id);
      if(tool.agent!=='bstack') throw Error('Only bstack may submit a candidate');
      if(!draft||draft.phase!=='active')throw Error('Open the PRD with bstack_prd_start first');
      const key=`review/${id}/${encodeURIComponent(draft.name)}`;
      if(busy.has(id)) throw Error('Review in progress'); busy.add(id);
      try {
        const author=await ctx.session.get({sessionID:id});
        const all=(await ctx.session.context({sessionID:id})).flatMap(m=>{
          if(m.type==='user')return [{id:m.id,text:m.text}];
          if(m.type!=='assistant')return [];
          return m.content.flatMap(p=>p.type==='tool'&&p.name==='question'&&p.state.status==='completed'
            ?[{id:m.id,text:'User answered the interactive question: '+JSON.stringify({question:p.state.input,answer:p.state.content})}]:[]);
        });
        const users=all.slice(Math.max(0,all.findIndex(u=>u.id===draft.first)));
        const last=users.at(-1); if(!last) throw Error('No user request');
        const c=(await ctx.storage.get(key) as unknown as Cycle)||fresh();
        if(c.paused){
          if(c.request===last.id)return {output:{status:'AWAITING_USER',head:c.head}};
          c.paused=false; c.repairs=[c.head];
        }
        const requests=users.map(u=>u.text);
        let snap:ReturnType<typeof readDraft>;
        try {snap=readDraft(draft)}
        catch(error){return {output:{status:'INVALID_PRD',errors:[String(error)]}}}
        const {bundle,table,documents,evidence}=snap;
        const supporting={name:draft.name,documents,sources:bundle.sources};
        const {head,scopes}=identity(table,requests,evidence,supporting);
        bundle.head=head;
        const prior={...c.votes}; const previous=c.head;
        if(head!==previous) c.revision++;
        c.head=head; c.request=last.id;
        // Establish both independent identities before dispatch. Never accept an ID from the author.
        for(const lane of lanes) if(!c.sessions[lane]) c.sessions[lane]=(await ctx.session.create({agent:'bstack-verdict',model:author.model,location:author.location,title:`bstack ${lane} review`})).id;
        if(c.sessions.product===c.sessions.function||Object.values(c.sessions).includes(id)) throw Error('Reviewer identity collision');
        await ctx.storage.set(key,c);
        const run=async(lane:Lane)=>{
          const old=prior[lane]; if(old?.scope===scopes[lane]&&(old.status==='PASS'||(old.status==='RESOLVE'&&old.head===head))) return old;
          const sessionID=c.sessions[lane]!; const who=await ctx.session.get({sessionID});
          if(who.agent!=='bstack-verdict'||who.parentID) throw Error('Invalid independent session');
          const token=randomUUID();
          // Give a lane exactly the substantive inputs covered by its scope hash.
          await ctx.session.prompt({sessionID,text:JSON.stringify({lane,head,revision:c.revision,requests,row:table[lane],definitions:{product:table.product.definition,function:table.function.definition},evidence,...supporting,previousHead:previous,previousFinding:old?.report}),metadata:{bstackRequest:token}});
          await ctx.session.wait({sessionID},{signal:tool.signal}); tool.signal.throwIfAborted();
          const history=await ctx.session.context({sessionID}); const start=history.findLastIndex(m=>m.type==='user'&&m.metadata?.bstackRequest===token);
          const turn=history.slice(start+1);
          const answer=turn.findLast(m=>m.type==='assistant');
          if(start<0||turn.some(m=>m.type==='user')||answer?.type!=='assistant'||answer.error||answer.finish!=='stop') throw Error('UNCONFIRMED: no terminal answer to this reviewer request');
          const report=answer.content.filter(p=>p.type==='text').map(p=>p.text).join('\n').trim();
          return {status:parseReport(report,head,lane),head,scope:scopes[lane],reviewer:sessionID,report};
        };
        const result=await Promise.allSettled(lanes.map(run));
        const errors:string[]=[];
        for(const [i,r] of result.entries()) {if(r.status==='fulfilled') c.votes[lanes[i]]=r.value; else {delete c.votes[lanes[i]]; errors.push(`${lanes[i]}: ${r.reason}`)}}
        const status=errors.length?'UNCONFIRMED':conclude(c);
        await ctx.storage.set(key,c);
        let artifact: string|undefined;
        if(status==='AWAITING_USER'||status==='BLOCKED'){
          draft.phase='waiting';draft.reason=status;await put(id,draft);armed.delete(id);
        }else if(status==='PASS') {
          try {
            if(readDraft(draft).stamp!==snap.stamp)throw Error('Draft changed during review; resubmit the current files');
            artifact=publishBundle(bundle);
            draft.phase='approved';draft.artifact=artifact;await put(id,draft);armed.delete(id);
          }
          catch(error){return {output:{status:'SAVE_FAILED',reviewStatus:'PASS',head,revision:c.revision,errors:[String(error)]}}}
        }
        return {output:{status,head,revision:c.revision,table,...(artifact?{artifact}:{}),votes:c.votes,errors,failedRepairs:Math.max(0,c.repairs.length-1)}};
      } finally {busy.delete(id)}
    }}));
  const controller=new AbortController();
  const listen=(async()=>{
    for await(const e of ctx.event.subscribe({signal:controller.signal})){
      if(e.type==='session.execution.interrupted'||e.type==='session.execution.failed'||e.type==='session.agent.selected'){
        armed.delete(e.data.sessionID);emptyStops.delete(e.data.sessionID);continue;
      }
      if(e.type!=='session.step.ended'||e.data.finish!=='stop'||!armed.has(e.data.sessionID))continue;
      const id=e.data.sessionID,d=await get(id);if(d?.phase!=='active')continue;
      const n=(emptyStops.get(id)??0)+1;emptyStops.set(id,n);
      // A non-functioning provider can repeatedly emit only prose. Don't burn an unbounded budget.
      const fault=n>=4;
      if(fault){d.phase='waiting';d.reason='Repeated terminal responses without successful tool execution';await put(id,d);armed.delete(id)}
      try{
        await ctx.session.synthetic({sessionID:id,resume:true,delivery:'queue',description:fault?'PRD stalled (not approved)':'Unapproved PRD',
          text:fault?`자동 진행 실패: ${d.folder}에서 작업 없이 종료 응답만 반복됨. 미승인 상태와 모델 변경 또는 재개 필요를 사용자에게 알린다.`
            :`PRD 미승인: ${d.folder}. 답변으로 종료하지 말고 초안 작성·독립 검수를 계속한다. 새 권한을 부여하지 않는다.`,metadata:{bstackContinue:true}});
      }catch(error){
        d.phase='waiting';d.reason=`Continuation delivery failed: ${String(error)}`;await put(id,d);armed.delete(id);
      }
    }
  })();
  // Abort cancels the subscription during host disposal.
  void listen.catch(()=>{});
  return async()=>{controller.abort();await listen.catch(()=>{})};
}});
