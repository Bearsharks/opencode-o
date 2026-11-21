import {execFileSync} from 'node:child_process';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,lanes,type Table,type Row} from './cycle';
import {prepareBundle,renderBundle,type Document} from './artifact';

const blank='⟪작성⟫';
const row={definition:blank,verification:blank,grounds:{definition:blank,verification:blank}};
const mainFile='requirements.md';
const template=(name:string)=>renderBundle({product:row,function:row},blank,[{file:mainFile,title:name,body:blank}]);
export type Draft={name:string;folder:string;root:string;phase:'active'|'waiting'|'held'|'approved';first:string;artifact?:string;reason?:string};

export function startDraft(directory:string,input:string,owner:string,first:string):Draft {
  const name=input.trim().normalize('NFC');
  if(!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u.test(name)) throw Error('Use 1–64 letters, numbers, spaces, hyphens or underscores for the PRD name.');
  const root=realpathSync(execFileSync('git',['-C',directory,'rev-parse','--show-toplevel'],{encoding:'utf8'}).trimEnd());
  const dir=join(root,'.bstack'); mkdirSync(dir,{recursive:true});
  if(!lstatSync(dir).isDirectory()) throw Error('Unsafe .bstack directory');
  const folder=`.bstack/draft-${name}-${digest(owner).slice(0,10)}`, dest=join(root,folder);
  // Never adopt or overwrite unregistered work. Registered starts reuse their state in the tool.
  if(lstatSync(dest,{throwIfNoEntry:false})) throw Error(`Existing unregistered draft: ${folder}`);
  const stage=mkdtempSync(join(dir,'.creating-'));
  try{
    for(const [file,body] of template(name))writeFileSync(join(stage,file),body,{flag:'wx',mode:0o600});
    renameSync(stage,dest);
  }finally{rmSync(stage,{recursive:true,force:true})}
  return {name,root,folder,phase:'active',first};
}

// Use the same template as the renderer; accept free Markdown in each value, not missing/reordered cells.
export function readDraft(d:Draft){
  const dir=join(d.root,d.folder);
  if(!lstatSync(dir).isDirectory()||realpathSync(dir)!==dir)throw Error('Unsafe draft directory');
  const files=new Map<string,string>();
  for(const f of readdirSync(dir)){
    if(!/^[a-z0-9][a-z0-9-]{0,62}\.md$/.test(f))throw Error(`Unexpected file: ${f}`);
    const p=join(dir,f),s=lstatSync(p); if(!s.isFile()||s.nlink!==1||s.size>512*1024)throw Error(`Unsafe or oversized draft file: ${f}`);
    files.set(f,readFileSync(p,'utf8'));
  }
  const skeleton=template(d.name);
  if(files.get('index.md')!==skeleton.get('index.md'))throw Error('Keep the generated draft index unchanged; put decisions in requirements.md and criteria.md.');
  const pattern=skeleton.get('criteria.md')!.split(blank).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('([\\s\\S]+?)');
  const criteria=files.get('criteria.md')??'';
  const m=new RegExp('^'+pattern.trimEnd()+'\\s*$').exec(criteria);
  if(!m||criteria.includes(blank)||m.slice(1).some(v=>!v.trim()))throw Error('Fill every criteria.md section; preserve headings and anchor lines.');
  const table={} as Table;let i=1;
  for(const lane of lanes)table[lane]={definition:m[i++].trim(),verification:m[i++].trim(),grounds:{definition:m[i++].trim(),verification:m[i++].trim()}} satisfies Row;
  if(!files.has(mainFile))throw Error(`Missing ${mainFile}`);
  const documents:Document[]=[];
  for(const [file,md] of files){
    if(file==='criteria.md'||file==='index.md')continue;
    const h=/^# ([^\n]+)\n+([\s\S]+)$/.exec(md);
    if(!h||!h[2].trim()||md.includes(blank))throw Error(`Complete ${file} with a title and actual body.`);
    documents.push({file,title:h[1].trim(),body:h[2].trim()});
  }
  const evidence=m[i].trim();
  const bundle=prepareBundle(d.root,'0'.repeat(64),table,evidence,documents);
  return {table,evidence,documents,bundle,stamp:digest([...files])};
}
