import {test,expect} from 'bun:test';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareBundle,publishBundle,renderBundle} from '../plugins/review/artifact';
import {identity} from '../plugins/review/cycle';
const head='a'.repeat(64);
const row={definition:'[정책](../../policy.md#goal)',verification:'[절차](study.md#probe)',grounds:{definition:'담당자 결정',verification:'고정 표본의 결과만 보장한다.'}};
const table={product:row,function:row}, docs=[{file:'study.md',title:'실험 기록',body:'## Probe\n\n실제 표본 결과는 A였고 모집단 효과는 미측정이다.'}];
function setup(){
  const root=mkdtempSync(join(tmpdir(),'bstack-prd-'));execFileSync('git',['init','-q',root]);
  mkdirSync(join(root,'sub'));writeFileSync(join(root,'policy.md'),'# Goal\n\npolicy A');
  const prepare=()=>prepareBundle(join(root,'sub'),head,table,'',docs);
  return {root,prepare,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('self-contained navigation including external policy; reuse exact bytes only',()=>{
  const {root,prepare,close}=setup();
  try{
    const bundle=prepare(), p=publishBundle(bundle),dir=join(root,'.bstack',head);
    expect(p).toBe(`.bstack/${head}/index.md`);
    expect(readdirSync(dir).sort()).toEqual(['criteria.md','index.md','study.md']);
    expect(readFileSync(join(root,p),'utf8')).toContain('| 제품 가설 | [정책](../../policy.md#goal) | [절차](study.md#probe)');
    for(const [f,v] of bundle.files) expect(readFileSync(join(dir,f),'utf8')).toBe(v);
    expect(publishBundle(bundle)).toBe(p);
    writeFileSync(join(dir,'study.md'),'user edit');expect(()=>publishBundle(bundle)).toThrow();
    expect(readFileSync(join(dir,'study.md'),'utf8')).toBe('user edit');
  }finally{close()}
});
test('missing support, broken links/anchors, traversal, symlinks and source drift fail closed',()=>{
  const {root,prepare,close}=setup();
  try{
    expect(()=>renderBundle(table,'',[])).toThrow();
    for(const doc of [{...docs[0],body:'  '},{...docs[0],file:'../notes.md'},{...docs[0],file:'index.md'}]) expect(()=>renderBundle(table,'',[doc])).toThrow();
    for(const link of ['ghost.md','study.md#absent','../../policy.md#typo','../../../outside','../../policy.md/../missing']){
      expect(()=>prepareBundle(root,head,table,'',[{...docs[0],body:docs[0].body+`\n[link](${link})`}])).toThrow();
    }
    const bundle=prepare(); writeFileSync(join(root,'policy.md'),'# Goal\n\npolicy B');
    expect(()=>publishBundle(bundle)).toThrow('changed');expect(existsSync(join(root,'.bstack'))).toBe(false);
    symlinkSync(join(root,'sub'),join(root,'.bstack'));expect(()=>publishBundle(prepare())).toThrow();
  }finally{close()}
});
test('support content changes require both reviewers, even when index rows are unchanged',()=>{
  const first=identity(table,['request'],'',{documents:docs});
  const second=identity(table,['request'],'',{documents:[{...docs[0],body:'Another decision'}]});
  expect(first.head).not.toBe(second.head);
  expect(first.scopes.product).not.toBe(second.scopes.product);expect(first.scopes.function).not.toBe(second.scopes.function);
});
