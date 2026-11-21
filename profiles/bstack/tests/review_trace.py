"""Validate receipts from the native review tool, not the author's prose."""
import json
import re


def reviewer(call):
    return call.get('tool') == 'bstack_review'


def verdicts(calls, previous=0):
    # Clarification-only turns legitimately have no review; approval cases assert PASS separately.
    decisions = []
    for call in filter(reviewer, calls):
        state = call['state']
        if state['status'] != 'completed': raise ValueError('review failed')
        data = state['output']
        if isinstance(data, str): data = json.loads(data)
        if data.get('status')=='INVALID_PRD':
            decisions.append('INVALID_PRD')
            continue
        status, head, rev = data['status'], data['head'], data['revision']
        if status not in ('PASS','RESOLVE','BLOCKED') or not re.fullmatch('[0-9a-f]{64}',head) or rev < previous:
            raise ValueError('missing, paused, or stale review')
        votes=data['votes']; reports=[votes[l] for l in ('product','function')]
        if len({v['reviewer'] for v in reports})!=2 or any(not v['reviewer'] for v in reports): raise ValueError('missing independent sessions')
        expected='BLOCKED' if any(v['status']=='BLOCKED' for v in reports) else 'RESOLVE' if any(v['status']=='RESOLVE' for v in reports) else 'PASS'
        if expected!=status or any(v['status'] not in ('PASS','RESOLVE','BLOCKED') or (v['head']!=head and v['status']!='PASS') for v in reports): raise ValueError('inconsistent review')
        if state['input'] or set(data['table'])!={'product','function'}: raise ValueError('expected review of the saved draft')
        decisions.append(status); previous=rev
    return decisions,previous
