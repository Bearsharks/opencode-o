"""Opt-in host/model test: implement → clarify → implement in one main session."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--model', required=True)
args = p.parse_args()
launcher = Path(__file__).resolve().parents[1] / 'bin/oc-bstack'
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    subprocess.run(['git','init','-q'], cwd=root, check=True)
    target = root/'title.txt'
    target.write_text('old\n')
    session = None
    for idx, (prompt, expected) in enumerate([
        ('title.txt의 old 한 줄을 ready로 바꾸고 실제 결과를 확인해줘. 줄바꿈은 유지해.', 'ready\n'),
        ('다른 기능 기획을 검토하자. 구획 A에서 B로 내려가는 게임이고, 부활은 현재 기점에서 한다. B 진입 전에 실패하면 어느 기점을 현재로 볼지는 미정이다.', 'ready\n'),
        ('그 기획은 보류. 지금은 title.txt의 ready 한 줄을 done으로 바꾸고 결과를 확인해줘. 줄바꿈은 유지해.', 'done\n'),
    ]):
        cmd = [str(launcher),'run','--format','json','--archived','-m',args.model]
        if session: cmd += ['-s',session]
        run = subprocess.run(cmd+[prompt],cwd=root,capture_output=True,text=True,timeout=150)
        events = list(map(json.loads,run.stdout.splitlines()))
        assert run.returncode == 0 and not any(e['type']=='error' for e in events), 'model request failed'
        sid=events[0]['sessionID']
        assert session is None or session==sid
        session=sid
        calls=[e['part'] for e in events if e['type']=='tool_use']
        tools=[c['tool'] for c in calls]
        skills=[c['state']['input'].get('id') for c in calls if c['tool']=='skill' and c['state']['status']=='completed']
        assert target.read_text()==expected, 'wrong product file'
        if idx==0:assert not (root/'.bstack').exists()
        else:assert len(list((root/'.bstack').glob('draft-*/index.md')))==1 and all(f.name.startswith('draft-') for f in (root/'.bstack').iterdir())
        if idx==1:
            text=''.join(e['part']['text'] for e in events if e['type']=='text')
            assert skills==['bstack-clarify'] and 'bstack_prd_start' in tools and 'bstack_prd_wait' in tools and 'bstack_review' not in tools and '기점' in text, (tools,text)
            print('planning reply:',text)
        else:
            assert not skills and 'bstack_review' not in tools, tools
        print('PASS',idx+1,tools,skills,repr(expected))
