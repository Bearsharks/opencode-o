"""Offline audit of method-selection.md; never edits either checkout."""
import argparse
import re
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

DOC = Path(__file__).resolve().parent
ROOT = DOC.parents[2]
REPOS = {'E': (ROOT / 'ecc', '4adeee6732a12d1540f49a4d50a38ce8c97f9a53', 'LICENSE'),
         'P': (ROOT, '2795e89692c8d0e5825f50aaa73ce7b0f4302ecc', 'profiles/pstack/LICENSE')}
IDS = {'bstack-' + n for n in ('product-lens', 'context-decisions', 'acceptance', 'prototype', 'swarm', 'arena', 'interrogate', 'research-ops', 'explain-the-number')}


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def insist(ok, msg):
    if not ok:
        raise ValueError(msg)


def snapshot(source, path, oid, first, last):
    repo, rev, license_path = REPOS[source]
    ref = rev + ':' + path
    insist(git(repo, 'rev-parse', '--verify', ref).decode().strip() == oid, 'wrong pinned object: ' + path)
    if git(repo, 'cat-file', '-t', ref).strip() == b'tree':
        names = git(repo, 'ls-tree', '-rz', '--name-only', ref).decode().split('\0')[:-1]
        files = {n: git(repo, 'show', ref + '/' + n) for n in names}
    else:
        files = {'SKILL.md': git(repo, 'show', ref)}
    lines = files['SKILL.md'].decode().splitlines()
    insist(1 <= int(first) <= int(last) <= len(lines), 'invalid evidence lines: ' + path)
    files['LICENSE.upstream'] = git(repo, 'show', rev + ':' + license_path)
    return files


def check_port(name, files):
    patch = DOC / 'port-exceptions' / (name + '.patch')
    note = patch.with_suffix('.md')
    insist(patch.exists() == note.exists(), 'unpaired exception: ' + name)
    target = DOC.parent / 'skills' / name
    with TemporaryDirectory() as t:
        base = Path(t)
        for n, content in files.items():
            (base / n).parent.mkdir(parents=True, exist_ok=True)
            (base / n).write_bytes(content)
        if patch.exists():
            insist(all(label in note.read_text() for label in ('위치:', '이유:', '대체:')), 'incomplete exception note: ' + name)
            git(base, 'apply', '--whitespace=error-all', str(patch))
        # A patch must not erase required supporting files or notices, even on both sides.
        insist(all((base / n).is_file() for n in files), 'removed source file: ' + name)
        for n in files:
            if 'LICENSE' in Path(n).name:
                insist((base / n).read_bytes() == files[n], 'changed license: ' + n)
        def contents(d):
            paths = list(d.rglob('*'))
            insist(not d.is_symlink() and not any(p.is_symlink() for p in paths), 'unexpected symlink: ' + str(d))
            return {p.relative_to(d).as_posix(): p.read_bytes() for p in paths if p.is_file()}
        expected, actual = contents(base), contents(target)
        return sorted(n for n in expected.keys() | actual.keys() if expected.get(n) != actual.get(n))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('sources', 'ports', 'inventory', 'alternatives'))
    stage = parser.parse_args().stage
    if stage in ('inventory', 'alternatives'):
        catalog = {}
        for src, (repo, rev, _) in sorted(REPOS.items()):
            base = 'skills' if src == 'E' else 'profiles/pstack/skills'
            paths = git(repo, 'ls-tree', '-r', '--name-only', rev, base).decode().splitlines()
            for path in paths:
                m = re.fullmatch(base + r'/([^/]+)/SKILL\.md', path)
                if m:
                    catalog[src, m[1]] = path
                    if stage == 'inventory':
                        print(src, path)
            print(src, sum(key[0] == src for key in catalog), 'skill entries')
        if stage == 'inventory':
            return 0
        seen = set()
        for line in (DOC / 'alternative-review.md').read_text().splitlines():
            if not line.startswith(('| E |', '| P |')):
                continue
            src, name, span, quote, comparison = [x.strip() for x in line.strip('|').split('|')]
            key = (src, name)
            insist(key in catalog and key not in seen and name not in {'context-and-decisions', 'acceptance-criteria', 'product-lens', 'prototype', 'arena', 'swarm', 'interrogate'}, 'not a distinct alternative: ' + name)
            repo, rev, _ = REPOS[src]
            lines = git(repo, 'show', rev + ':' + catalog[key]).decode().splitlines()
            a, b = map(int, span.split('–'))
            insist(1 <= a <= b <= len(lines) and quote and quote in '\n'.join(lines[a-1:b]) and comparison, 'bad citation: ' + name)
            seen.add(key)
            print('PASS', src, name, span)
        insist(len(seen) == 13, 'expected 13 comparative readings')
        return 0
    text = (DOC / 'method-selection.md').read_text()
    rows = re.findall(r'^\| (bstack-[a-z-]+) \| ([EP]) \| ([\w./-]+) \| ([0-9a-f]{40}) \| (\d+)–(\d+) \|$', text, re.M)
    insist(len(rows) == len(IDS) and {r[0] for r in rows} == IDS, 'missing or duplicate selection')
    failures = 0
    if stage == 'ports':
        actual = {p.parent.name for p in (DOC.parent / 'skills').rglob('SKILL.md')}
        expected = IDS | {'bstack-clarify'}  # native workflow plus nine source-pinned methods
        insist(actual == expected, 'unexpected or missing installed skill: ' + str(sorted(actual ^ expected)))
    for name, source, path, oid, first, last in rows:
        files = snapshot(source, path, oid, first, last)
        diff = check_port(name, files) if stage == 'ports' else []
        failures += bool(diff)
        print(('FAIL' if diff else 'PASS'), name, ', '.join(diff) if diff else oid[:12])
    others = re.findall(r'^\| ([EP]) ((?:`[^`]+`(?:, )?)+) \|', text, re.M)
    found = set()
    for source, field in others:
        repo, rev, _ = REPOS[source]
        for path in re.findall(r'`([^`]+)`', field):
            insist(git(repo, 'cat-file', '-t', rev + ':' + path).strip() == b'blob', 'missing alternative: ' + path)
            found.add((source, path))
    insist(len(found) == 8, 'expected eight comparison sources')
    print(f'{stage}: {len(rows) - failures}/{len(rows)}; comparison sources: {len(found)}')
    return int(bool(failures))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
