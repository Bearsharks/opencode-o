"""Stock CLI commands share their profile service without leaking across profiles."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SharedWrapper(unittest.TestCase):
    def test_all_commands_use_the_same_stock_cli_with_profile_service_state(self):
        with tempfile.TemporaryDirectory(prefix='oc-lite-shared-wrapper-') as directory:
            fixture = Path(directory)
            native = fixture / 'opencode'
            native.write_text('''#!/usr/bin/python3
import json,os,sys
print(json.dumps({'args':sys.argv[1:],'db':os.getenv('OPENCODE_DB'),
 'data':os.getenv('XDG_DATA_HOME'),'state':os.getenv('XDG_STATE_HOME'),
 'profile':os.getenv('OPENCODE_CONFIG_DIR'),'gh':os.getenv('GH_CONFIG_DIR'),
 'profile_id':os.getenv('OPENCODE_O_PROFILE')}))
''')
            native.chmod(0o755)
            env = dict(os.environ, PATH=str(fixture) + ':' + os.environ['PATH'],
                OPENCODE_DB='existing.db', XDG_DATA_HOME='/existing/data',
                XDG_STATE_HOME='/existing/state', GH_CONFIG_DIR='/existing/gh')
            env.pop('OC_LITE_PROFILE_DIR', None)
            env.pop('OC_LITE_STATE_HOME', None)
            installer = (ROOT / 'scripts/install/oc-lite.sh').read_text()
            function = 'write_wrapper() {' + installer.split('write_wrapper() {', 1)[1].split("printf 'Running oc-lite preflight", 1)[0]
            wrapper = fixture / 'oc-lite'
            subprocess.run(['bash', '-c', function + '\nwrite_wrapper "$1"', 'fixture', str(wrapper)],
                env=dict(env, ROOT=str(ROOT)), check=True)
            for args in [[], ['--session', 'ses_existing'], ['api', 'get', '/api/info'],
                    ['mcp', 'list'], ['plugin', 'list'], ['service', 'restart'], ['pair'], ['acp'],
                    ['run', '--', 'literal $(value); text'], ['auth', 'list'], ['--server', 'http://127.0.0.1:1234']]:
                with self.subTest(args=args):
                    result = subprocess.run([str(wrapper), *args], env=env, capture_output=True, text=True, check=True)
                    data = json.loads(result.stdout)
                    self.assertEqual(data['args'], args)
                    self.assertEqual(data['db'], 'existing.db')
                    self.assertEqual(data['data'], '/existing/data')
                    self.assertEqual(data['state'], str(Path.home() / '.local/state/opencode-o/oc-lite'))
                    self.assertEqual(data['profile_id'], 'oc-lite')
                    self.assertEqual(data['profile'], str(ROOT / 'profiles/oc-lite'))
                    self.assertEqual(data['gh'], '/existing/gh')


if __name__ == '__main__':
    unittest.main()
