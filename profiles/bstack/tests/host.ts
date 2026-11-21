// Native catalogue and instruction delivery; never requests model inference.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OpenCode } from '@opencode/client';

const profile = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'bstack-host-'));
const directory = join(tmp, 'project'); mkdirSync(directory);
const pass = crypto.randomUUID();
const host = Bun.spawn([join(profile, 'bin/oc-bstack'), 'serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs'], {
  cwd: directory, stdout: 'pipe', stderr: 'pipe', env: {...process.env,
    BSTACK_CONFIG_HOME: join(tmp,'config'), BSTACK_STATE_HOME: join(tmp,'state'),
    XDG_DATA_HOME: join(tmp,'data'), XDG_CACHE_HOME: join(tmp,'cache'),
    OPENCODE_SERVER_USERNAME:'opencode', OPENCODE_SERVER_PASSWORD:pass},
});
let log = '';
const consume = async (s: ReadableStream<Uint8Array>) => {for await(const bytes of s) log += new TextDecoder().decode(bytes)};
const streams = [consume(host.stdout), consume(host.stderr)];
try {
  const deadline = Date.now()+30000;
  while (!log.match(/http:\/\/127\.0\.0\.1:\d+/) && host.exitCode === null && Date.now()<deadline) await Bun.sleep(100);
  const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; assert.ok(url,'server not ready');
  const api = OpenCode.make({baseUrl:url, headers:{authorization:'Basic '+Buffer.from('opencode:'+pass).toString('base64')}});
  const location = {directory};
  const ids = readdirSync(join(profile,'skills'), {withFileTypes:true}).filter(f=>f.isDirectory() && existsSync(join(profile,'skills',f.name,'SKILL.md'))).map(f=>f.name).sort();
  assert.equal(ids.length,10); assert.ok(ids.includes('bstack-clarify'));
  const config = await api.config.get({location});
  assert.ok(config.some(c => c.type==='document' && c.info.default_agent==='bstack'));
  const session = await api.session.create({location,agent:'bstack',title:'bstack host check'});
  assert.equal(session.agent,'bstack');
  let reviewPlugin;
  do {
    reviewPlugin=(await api.plugin.list({location})).data.find(p=>p.id==='bstack-review');
    if(reviewPlugin?.state.status==='active'||reviewPlugin?.state.status==='failed') break;
    await Bun.sleep(100);
  } while(Date.now()<deadline);
  assert.equal(reviewPlugin?.state.status,'active','review plugin in actual launcher');
  let agents = (await api.agent.list({location})).data;
  while(!['bstack','bstack-reader','bstack-verdict'].every(id=>agents.some(a=>a.id===id)) && Date.now()<deadline) {await Bun.sleep(100); agents=(await api.agent.list({location})).data}
  for(const [id,mode] of [['bstack','primary'],['bstack-reader','subagent'],['bstack-verdict','subagent']]) {
    const agent = agents.find(a=>a.id===id);
    assert.equal(agent?.mode,mode);
    // Check resolved broad permissions at this clean test location, not user/project overrides.
    for(const action of ['edit','shell']) assert.equal(agent!.permissions.filter(r=>(r.action==='*'||r.action===action)&&r.resource==='*').at(-1)?.effect,id==='bstack'?'allow':'deny');
    if(id==='bstack') assert.equal(agent!.system?.trim(),readFileSync(join(profile,'main.md'),'utf8').trim());
    if(id==='bstack-verdict') {
      for(const f of ['verdict.md','skills/bstack-clarify/references/rubric.md']) assert.ok(agent!.system?.includes(readFileSync(join(profile,f),'utf8').trim()));
      const rules=agent!.permissions;
      const end=rules.findLastIndex(r=>r.action==='*'&&r.resource==='*');
      assert.ok(end>=0 && rules.slice(end).every(r=>r.effect==='deny'));
    }
  }
  const list = () => api.skill.list({location}).then(x=>x.data.filter(s=>s.id.startsWith('bstack-')));
  let catalog = await list();
  while(catalog.length < ids.length && Date.now()<deadline) {await Bun.sleep(100); catalog=await list()}
  assert.deepEqual(catalog.map(s=>s.id).sort(),ids);
  for(const id of ids){
    const body = readFileSync(join(profile,'skills',id,'SKILL.md'),'utf8').split('\n---\n').slice(1).join('\n---\n').trim();
    assert.equal(catalog.find(s=>s.id===id)?.content.trim(),body,id);
    await api.session.skill({sessionID:session.id,id,resume:false});
    const contains = (x:unknown):boolean => typeof x === 'string' ? x.includes(body) : !!x && typeof x === 'object' && Object.values(x).some(contains);
    assert.ok(contains(await api.session.context({sessionID:session.id})),id+' missing from session');
    console.log('PASS catalogue + session body:',id);
  }
  assert.deepEqual(readdirSync(directory),[]);
} finally {host.kill(); await host.exited; await Promise.all(streams); rmSync(tmp,{recursive:true,force:true})}
