import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('review_prepare', Path(__file__).with_name('prepare.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrepareTest(unittest.TestCase):
    def test_profile_is_location_scoped_and_never_overwrites_existing_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            control = root / 'control'
            (control / '.opencode/lib').mkdir(parents=True)
            (control / '.opencode/lib/independent-review.mjs').write_text('export {};')
            location = module.prepare(root / 'review', control, root / 'binding.json', root / 'ready.json')
            config = json.loads((location / 'opencode.json').read_text())
            self.assertEqual(config['plugins'][0], '-oc-lite-topology')
            self.assertEqual(config['model'], 'openai/gpt-6.1-sol')
            self.assertNotIn('providers', config)
            self.assertEqual(config['plugins'][1]['options']['bindingPath'], str(root / 'binding.json'))
            with self.assertRaises(FileExistsError):
                module.prepare(location, control, root / 'binding.json', root / 'ready.json')


if __name__ == '__main__':
    unittest.main()
