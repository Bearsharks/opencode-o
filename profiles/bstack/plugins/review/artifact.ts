import {execFileSync} from 'node:child_process';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {lanes,type Table} from './cycle';

export type Document = {file:string; title:string; body:string};
export type Bundle = ReadonlyMap<string,string>;
const stat=(p:string)=>lstatSync(p,{throwIfNoEntry:false});

// The reviewed strings (not subsequently edited project files) supply every published byte.
export function renderBundle(table:Table,evidence:string,documents:Document[]):Bundle {
  if(!documents.length) throw Error('PRD needs at least one substantive supporting document');
  const files=new Map<string,string>(), sections:string[]=[];
  const index=['# PRD', '', '| 구분 | 성공 정의 | 검증 | 근거 |','|---|---|---|---|'];
  for(const lane of lanes){
    const name=lane==='product'?'제품 가설':'기능', r=table[lane];
    const ref=(key:string,label:string,text:string)=>{
      const v=text.trim(); if(!v) throw Error('Empty PRD criterion');
      if(/^\[[^\]\n]+\]\([^\n]+\)$/.test(v)) return v.replace(/\|/g,'\\|');
      const id=`${lane}-${key}`;sections.push(`<a id="${id}"></a>\n\n### ${name}: ${label}\n\n${v}`);
      return `[${label}](criteria.md#${id})`;
    };
    index.push(`| ${name} | ${ref('definition','성공 정의',r.definition)} | ${ref('verification','검증',r.verification)} | 정의의 이유: ${ref('why','정의 근거',r.grounds.definition)} · 통과가 성공을 보장하는 이유: ${ref('warrant','검증 근거',r.grounds.verification)} |`);
  }
  if(evidence.trim()) sections.push('## 공통 근거 및 한계\n\n'+evidence.trim());
  if(sections.length) files.set('criteria.md','# 성공 기준\n\n'+sections.join('\n\n')+'\n');
  index.push('','## 관련 문서','');
  for(const {file,title,body} of documents){
    if(!/^[a-z0-9][a-z0-9-]{0,62}\.md$/.test(file)||['index.md','criteria.md'].includes(file)||files.has(file)) throw Error(`Invalid or duplicate PRD filename: ${file}`);
    if(!title.trim()||/[\r\n]/.test(title)||!body.trim()) throw Error(`Missing document content: ${file}`);
    files.set(file,`# ${title}\n\n${body.trim()}\n`);index.push(`- [${title.replace(/[[\]\\]/g,'\\$&')}](${file})`);
  }
  files.set('index.md',index.join('\n')+'\n');return files;
}

const repoRoot=(cwd:string)=>realpathSync(execFileSync('git',['-C',cwd,'rev-parse','--show-toplevel'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trimEnd());
function hasAnchor(md:string,key:string) {
  if(/^L[1-9]\d*(?:-L[1-9]\d*)?$/.test(key)) return Number(key.split('L').at(-1))<=md.split('\n').length;
  if([...md.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/gi)].some(m=>m[1]===key)) return true;
  return md.split('\n').some(line=>{
    const m=/^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    return m && m[1].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/ /g,'-')===key;
  });
}
// Portable PRD references use inline Markdown links with URL-encoded spaces/parentheses.
// HTTP links are retained as citations, never fetched or counted as verified observations.
export function validateBundle(root:string,head:string,files:Bundle) {
  const folder=join(root,'.bstack',head);
  const sources:Record<string,string>=Object.create(null);
  for(const [name,text] of files) {
    const targets:string[]=[];
    Bun.markdown.render(text,{
      link:(_,meta)=>{targets.push(meta.href);return ''},
      image:(_,meta)=>{targets.push(meta.src);return ''},
    });
    for(const raw of targets){
      if(/^https?:\/\//i.test(raw)) continue;
      if(!raw||/^[a-z][\w+.-]*:|^\/|[\\\0]/i.test(raw)) throw Error(`Unsupported link in ${name}: ${raw}`);
      const [p,anchor]=raw.split('#').map(decodeURIComponent);
      const dest=resolve(folder,p||name);
      const local=relative(folder,dest); let body=files.get(local);
      if(body===undefined){
        const rel=relative(root,dest);
        if(!rel||rel==='..'||rel.startsWith('..'+sep)||rel.split(sep).some(s=>s.startsWith('.'))||
           !stat(dest)?.isFile()||!realpathSync(dest).startsWith(root+sep)) throw Error(`Missing or unsafe PRD link: ${raw}`);
        if(lstatSync(dest).size>8*1024*1024) throw Error(`Reference a short source document instead: ${raw}`);
        const bytes=readFileSync(dest);sources[rel]=createHash('sha256').update(bytes).digest('hex');
        if(anchor) body=bytes.toString('utf8');
      }
      if(anchor&&!hasAnchor(body!,anchor)) throw Error(`Missing PRD anchor: ${raw}`);
    }
  }
  return Object.fromEntries(Object.entries(sources).sort(([a],[b])=>a<b?-1:a>b?1:0));
}

export function prepareBundle(directory:string,head:string,table:Table,evidence:string,docs:Document[]) {
  if(!/^[a-f0-9]{64}$/.test(head)) throw Error('Invalid review head');
  const root=repoRoot(directory), files=renderBundle(table,evidence,docs);
  const sources=validateBundle(root,head,files);return {root,files,head,sources};
}

export function publishBundle({root,files,head,sources}:ReturnType<typeof prepareBundle>) {
  if(JSON.stringify(validateBundle(root,head,files))!==JSON.stringify(sources)) throw Error('PRD source changed after review; resubmit');
  const dir=join(root,'.bstack');mkdirSync(dir,{recursive:true});
  if(!lstatSync(dir).isDirectory()) throw Error('.bstack must be a real directory');
  const dest=join(dir,head), artifact=`.bstack/${head}/index.md`;
  const reuse=()=>{
    if(!lstatSync(dest).isDirectory()||readdirSync(dest).length!==files.size||
       [...files].some(([f,v])=>!stat(join(dest,f))?.isFile()||readFileSync(join(dest,f),'utf8')!==v))
      throw Error(`Refusing to replace existing PRD: ${dest}`);
    return artifact;
  };
  if(stat(dest)) return reuse();
  const stage=mkdtempSync(join(dir,'.stage-'));
  try{
    for(const [f,v] of files) writeFileSync(join(stage,f),v,{flag:'wx',mode:0o600});
    try{renameSync(stage,dest)}catch(e){if(!stat(dest))throw e;return reuse()}
    return artifact;
  }finally{rmSync(stage,{recursive:true,force:true})}
}
