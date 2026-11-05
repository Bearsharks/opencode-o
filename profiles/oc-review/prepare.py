#!/usr/bin/env python3
"""Prepare a review-only location on the existing stock OpenCode service.

Writes only a new directory's opencode.json. Does not launch a server, change
global configuration, access credentials, or create a session. The controller
creates its independent primary session with location.directory set here.
"""
import argparse
import hashlib
import json
from pathlib import Path


def prepare(directory, control, binding, ready, workflow=None, messaging=None):
    directory, control = Path(directory).resolve(), Path(control).resolve(strict=True)
    profile = Path(__file__).resolve().parent
    adapter = control / '.opencode/lib/independent-review.mjs'
    options = {'controlRoot': str(control), 'bindingPath': str(Path(binding).resolve()),
               'readyPath': str(Path(ready).resolve()),
               'adapterSha256': hashlib.sha256(adapter.read_bytes()).hexdigest()}
    if workflow:
        options['workflowConfig'] = str(Path(workflow).resolve(strict=True))
    if messaging:
        options['messagingConfig'] = str(Path(messaging).resolve(strict=True))
    config = json.loads((profile / 'opencode.jsonc').read_text())
    config['plugins'] = ['-oc-lite-topology',
        {'package': str(profile / 'plugins/reviewer'), 'options': options},
        str(profile / 'plugins/review-guard')]
    directory.mkdir(parents=True, exist_ok=False)
    target = directory / 'opencode.json'
    target.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    target.chmod(0o600)
    return directory


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('directory', 'control', 'binding', 'ready'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--workflow', type=Path)
    parser.add_argument('--messaging', type=Path)
    print(prepare(**vars(parser.parse_args())))
