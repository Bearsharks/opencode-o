"""Negative controls: the verifier must reject lost evidence, not just count files."""
import runpy
import shutil
import tempfile
import unittest
from pathlib import Path

PROFILE = Path(__file__).resolve().parents[1]


class PortAudit(unittest.TestCase):
    def test_reference_and_license_drift(self):
        audit = runpy.run_path(str(PROFILE/'docs/check-selection.py'))
        name = 'bstack-context-decisions'
        files = audit['snapshot']('E', 'skills/context-and-decisions', '69706b9066d8baebe220b29335588f47fa76db2a', 13, 44)
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            shutil.copytree(PROFILE/'docs/port-exceptions', root/'docs/port-exceptions')
            target = root/'skills'/name
            shutil.copytree(PROFILE/'skills'/name, target)
            check = audit['check_port']; check.__globals__['DOC'] = root/'docs'
            self.assertEqual(check(name, files), [])
            (target/'references/source.md').unlink()
            (target/'LICENSE').write_text('replaced\n')
            self.assertEqual(check(name, files), ['LICENSE', 'references/source.md'])


if __name__ == '__main__': unittest.main()
