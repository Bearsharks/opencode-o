import {test,expect} from 'bun:test';
import {fresh,conclude,identity,parseReport,type Vote} from '../plugins/review/cycle';

test('review rationale may start a new paragraph but may not be empty or for another head',()=>{
  const head='a'.repeat(64), first=`VERDICT: PASS ${head} product`;
  expect(parseReport(first+'\n\nD: 상담팀이 지정한 독립 식별 과제다.\nV: 해당 과제에서 정답 일치와 무도움을 직접 관찰한다.',head,'product')).toBe('PASS');
  for(const body of ['정책과 관찰이 일치한다.','D: 요구사항이 있다.','V: 결과를 직접 관찰한다.','D: \nV: 결과를 직접 관찰한다.']) {
    expect(()=>parseReport(first+'\n'+body,head,'product')).toThrow();
  }
  expect(()=>parseReport(first+'\n\n',head,'product')).toThrow();
  expect(()=>parseReport(first+'\n\n근거', 'b'.repeat(64),'product')).toThrow();
});

test('only distinct rejected repairs count: initial + three, not a repeated head or BLOCKED',()=>{
  const c=fresh(); const vote=(status:Vote['status']):Vote=>({status,report:'finding',reviewer:'session',head:c.head,scope:'scope'});
  for(const [head,status,want] of [['a','RESOLVE','RESOLVE'],['a','RESOLVE','RESOLVE'],['b','BLOCKED','BLOCKED'],['c','RESOLVE','RESOLVE'],['d','RESOLVE','RESOLVE'],['e','RESOLVE','AWAITING_USER']] as const){
    c.head=head;c.votes={product:vote(status),function:vote('PASS')};expect(conclude(c)).toBe(want);
  }
  expect(c.repairs).toEqual(['a','c','d','e']);expect(c.paused).toBe(true);
});
test('a shared policy, definition or evidence change invalidates both reviews',()=>{
  const row={definition:'x',verification:'y',grounds:{definition:'z',verification:'w'}};const first=identity({product:row,function:row},['a'],'e');
  for(const next of [identity({product:{...row,definition:'xx'},function:row},['a'],'e'),identity({product:row,function:row},['a','b'],'e'),identity({product:row,function:row},['a'],'ee')]){
    expect(next.head).not.toBe(first.head);for(const lane of ['product','function'] as const) expect(next.scopes[lane]).not.toBe(first.scopes[lane]);
  }
  expect(()=>parseReport('PASS',first.head,'product')).toThrow();expect(()=>conclude(fresh())).toThrow();
});
