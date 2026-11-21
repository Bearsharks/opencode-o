"""Opt-in hosted inference. Mechanical trace checks only; inspect text against expect."""
import argparse, json, re, subprocess, tempfile
from pathlib import Path
from review_trace import reviewer, verdicts

root = Path(__file__).resolve().parents[1]
cases = json.loads((root/'tests/scenarios.json').read_text())
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('case', choices=cases); p.add_argument('--model', required=True)
p.add_argument('--out', type=Path, required=True); args = p.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
case = cases[args.case]
with tempfile.TemporaryDirectory() as d:
    subprocess.run(['git','init','-q',d],check=True)
    fixture = case.get('files', {})
    for name, data in fixture.items():
        f=Path(d)/name; f.parent.mkdir(parents=True,exist_ok=True); f.write_text(data)
    session = None
    revision = 0
    approved = set()
    draft = None
    for i, prompt in enumerate([case['request']] + ([case['followup']] if 'followup' in case else [])):
        cmd = [str(root/'bin/oc-bstack'), 'run', '--format', 'json', '--archived', '-m', args.model]
        if session: cmd += ['-s', session]
        target = args.out/f'{args.case}-{i}.jsonl'
        with target.open('w') as log:
            run = subprocess.run(cmd+[prompt], cwd=d, stdout=log, stderr=subprocess.PIPE, text=True, timeout=360)
        events = [json.loads(s) for s in target.read_text().splitlines() if s.strip()]
        errors = [e['error'].get('type') for e in events if e['type']=='error']
        if run.returncode or errors: raise SystemExit(f'NOT PASSED: {errors or run.returncode}; {target}')
        session = events[0]['sessionID']; parts = [e.get('part',{}) for e in events]
        calls = [v for v in parts if v.get('type')=='tool']; tools=[v.get('tool') for v in calls]
        ids = [v.get('state',{}).get('input',{}).get('id') for v in calls if v.get('tool')=='skill' and v.get('state',{}).get('status')=='completed']
        if not i: assert 'bstack-clarify' in ids, 'planning workflow was not loaded'
        def workflow_load(v):
            state=v.get('state',{}); inp=state.get('input',{})
            return state.get('status')=='completed' and (
                (v.get('tool')=='skill' and inp.get('id')=='bstack-clarify') or
                v.get('tool') in ('bstack_prd_start','bstack_prd_wait') or
                (v.get('tool')=='read' and 'bstack-clarify' in inp.get('path','')))
        text = '\n'.join(v['text'] for v in parts if v.get('type')=='text'); print(target, tools, ids, '\n', text)
        for v in calls:
            if v.get('tool')=='bstack_prd_start' and v['state']['status']=='completed':
                receipt=v['state']['output']
                if isinstance(receipt,str):receipt=json.loads(receipt)
                draft=receipt['folder']
        assert draft and Path(d,draft,'index.md').is_file(), 'named draft was not opened'
        for v in filter(reviewer,calls):
            data=v['state'].get('output',{})
            if isinstance(data,str): data=json.loads(data)
            if data.get('status')=='PASS':
                prefix=f".bstack/{data['head']}/"
                assert data['artifact']==prefix+'index.md'
                index=(Path(d)/data['artifact']).read_text()
                assert '| 구분 | 성공 정의 | 검증 | 근거 |' in index and '| 제품 가설 |' in index and '| 기능 |' in index
                approved.add(data['artifact'])
                for doc in (Path(d)/draft).glob('*.md'):
                    if doc.name in ('index.md','criteria.md'):continue
                    assert f"]({doc.name})" in index and (Path(d)/prefix/doc.name).is_file()
                    assert doc.read_text().strip().split('\n',1)[1].strip() in (Path(d)/prefix/doc.name).read_text()
                    approved.add(prefix+doc.name)
                if (Path(d)/prefix/'criteria.md').exists(): approved.add(prefix+'criteria.md')
        visible={str(f.relative_to(d)):f for f in Path(d).rglob('*') if f.is_file() and '.git' not in f.relative_to(d).parts}
        draftfiles={f for f in visible if Path(f).parent==Path(draft) and f.endswith('.md')}
        assert text and set(visible)==set(fixture)|approved|draftfiles and all(visible[f].read_text()==s for f,s in fixture.items()), 'missing answer or unexpected project changes'
        # Owned scratch experiments may execute; the product fixture must remain byte-identical.
        decisions, revision = verdicts(calls, revision)
        print('Independent decisions:', decisions)
        work = [v for v in calls if not reviewer(v) and not workflow_load(v)]
        if (i and args.case in ('term','stage')) or args.case in ('clear','split','investigate'):
            assert decisions[-1]=='PASS', 'current table not accepted'
        if i and args.case=='stage':
            body='\n'.join(visible[f].read_text() for f in approved if not f.endswith('/index.md'))
            assert all(x in body for x in ('생성','상승','도달','클리어')) and re.search('정지|중단|멈',body)
        if args.case=='investigate':
            assert 'shell' in tools and any(v.get('tool')=='shell' and v['state']['status']=='completed' and 'PROBE-OBS=7/12' in str(v['state'].get('output','')) for v in calls), 'missing real probe observation'
            assert any('7/12' in visible[f].read_text() for f in approved if not f.endswith('/index.md')), 'lost probe evidence from PRD'
        if (args.case in ('term','stage') and not i) or args.case in ('blocked','revive'):
            assert 'bstack_prd_wait' in tools and not decisions and not approved, 'no registered wait or premature review'
            assert '|---' not in text.replace(' ', ''), 'rendered a candidate table instead of asking the decisive question'
        if args.case=='revive':
            assert '부활' in text and re.search(r'어느\s*(기점|지점|위치)|어디|A.{0,50}(인지|인가|에서).{0,50}B',text), 'did not ask which checkpoint is meant'
        if not i:
            if case.get('tools')=='none': assert ids==['bstack-clarify'] and decisions[-1]=='PASS', 'extra method on clear request'
            if 'skill' in case: assert case['skill'] in ids, 'explicit method missing'
            if 'workers' in case: assert sum(v.get('tool')=='subagent' and v.get('state',{}).get('status')=='completed' for v in work)>=case['workers'], 'independent workers missing'
    print('TRACE PASS; human review:',case['expect'])
