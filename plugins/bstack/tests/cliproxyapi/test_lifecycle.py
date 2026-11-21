"""CPA_BINARY=/path/to/verified/cli-proxy-api python3 test_lifecycle.py -v"""
import http.server
import json
import os
from pathlib import Path
import pty
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

B = Path(__file__).resolve().parents[2] / "bin/bstack-claude"
MODEL = "gpt-6.2-astra"
PICKER_MODELS = [MODEL, "gpt-6.2-sol"]
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Lifecycle(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()
        self.runtime = self.home / ".local/share/bstack-cliproxyapi"
        self.env = {"HOME": str(self.home), "PATH": str(self.home) + ":" + os.environ["PATH"]}

    def cmd(self, *args):
        return subprocess.run([B, *args], env=self.env, capture_output=True, text=True, timeout=10)

    def test_never_adopt_unowned_runtime(self):
        self.runtime.mkdir(parents=True)
        (self.runtime / "keep").touch()
        self.assertNotEqual(self.cmd("remove").returncode, 0)
        self.assertTrue((self.runtime / "keep").exists())

    @unittest.skipUnless(os.environ.get("CPA_BINARY"), "set CPA_BINARY to exercise the release")
    def test_first_login_then_reuse(self):
        # Replace only browser OAuth with a fixture that makes a model available.
        # The installed real binary handles serve and config reloads.
        real = str(Path(os.environ["CPA_BINARY"]).resolve())
        wrapper = self.home / "proxy-wrapper"
        wrapper.write_text(
            "#!/usr/bin/env python3\nimport json, os, sys\nfrom pathlib import Path\n"
            f"real = {real!r}\n"
            "if '-codex-login' not in sys.argv: os.execv(real, [sys.argv[0], *sys.argv[1:]])\n"
            "p = Path(sys.argv[sys.argv.index('-config')+1]); cfg = json.loads(p.read_text())\n"
            "with Path('login-count').open('a') as f: f.write('login\\n')\n"
            "cfg['api-keys'] = {'codex':[{'name':'test', 'base-url':'http://127.0.0.1:1', "
            "'keys':[{'api-key':'test-only'}], 'models':[{'name':'gpt-6.2-astra','alias':'gpt-6.2-astra'}]}]}\n"
            "p.write_text(json.dumps(cfg))\n")
        wrapper.chmod(0o700)
        self.assertEqual(self.cmd("install", str(wrapper)).returncode, 0)
        path = self.runtime / "config.yaml"
        cfg = json.loads(path.read_text())
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            cfg["server"]["port"] = s.getsockname()[1]
        path.write_text(json.dumps(cfg))
        fake = self.home / "claude"
        fake.write_text("#!/bin/sh\necho session-started\n")
        fake.chmod(0o700)
        master, slave = pty.openpty()
        try:
            for _ in range(2):
                run = subprocess.run([B], cwd=self.home, env=self.env, stdin=slave,
                                     capture_output=True, text=True, timeout=20)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertIn("session-started", run.stdout)
            self.assertEqual((self.runtime / "login-count").read_text(), "login\n")
        finally:
            os.close(slave)
            os.close(master)
            stop = self.cmd("stop")
            self.assertEqual(stop.returncode, 0, stop.stderr)

    @unittest.skipUnless(os.environ.get("CPA_BINARY"), "set CPA_BINARY to exercise the release")
    def test_real_proxy(self):
        install = self.cmd("install", os.environ["CPA_BINARY"])
        self.assertEqual(install.returncode, 0, install.stderr)
        config_path = self.runtime / "config.yaml"
        config = json.loads(config_path.read_text())
        self.assertEqual(config_path.stat().st_mode & 0o777, 0o600)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = config["server"]["port"] = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        observed = []

        class MockCodex(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                observed.append((self.path, body["model"]))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for frame in [
                    {"type": "response.created", "response": {"id": "resp_test", "model": body["model"]}},
                    {"type": "response.output_text.delta", "delta": "hello"},
                    {"type": "response.completed", "response": {"id": "resp_test", "model": body["model"],
                     "output": [{"type": "message", "content": [{"type": "output_text", "text": "hello"}]}]}},
                ]:
                    self.wfile.write(("data: " + json.dumps(frame) + "\n\n").encode())

        backend = http.server.ThreadingHTTPServer(("127.0.0.1", 0), MockCodex)
        threading.Thread(target=backend.serve_forever, daemon=True).start()
        self.addCleanup(backend.server_close)
        self.addCleanup(backend.shutdown)
        config["api-keys"] = {"codex": [{"name": "offline", "base-url": f"http://127.0.0.1:{backend.server_port}",
                                        "keys": [{"api-key": "test-only"}],
                                        "models": [{"name": m, "alias": m} for m in PICKER_MODELS]}]}
        config_path.write_text(json.dumps(config))
        fake = self.home / "claude"
        fake.write_text('#!/usr/bin/env python3\nimport json,sys,os\nprint(json.dumps('
                        '[sys.argv[1:], os.environ["ANTHROPIC_BASE_URL"]]))\n')
        fake.chmod(0o700)
        server = subprocess.Popen([B, "serve"], env=self.env, stderr=subprocess.STDOUT, stdout=subprocess.PIPE)
        try:
            # Readiness only; all requests are confined to this test's loopback servers.
            headers = {"Authorization": "Bearer " + config["access"]["api-keys"][0]}
            deadline = time.monotonic() + 8
            while True:
                try:
                    with HTTP.open(urllib.request.Request(base + "/v1/models", headers=headers), timeout=1) as r:
                        if MODEL in [row["id"] for row in json.load(r)["data"]]:
                            break
                except OSError:
                    pass
                if server.poll() is not None or time.monotonic() > deadline:
                    self.fail("proxy did not advertise the fixture model")
                time.sleep(0.1)
            with self.assertRaises(urllib.error.HTTPError) as err:
                HTTP.open(base + "/v1/models")
            self.assertEqual(err.exception.code, 401)
            self.assertNotEqual(self.cmd("remove").returncode, 0)
            (self.home / "bstack-claude").symlink_to(B)
            start = subprocess.run(["bstack-claude"], cwd=self.home, env=self.env,
                                   capture_output=True, text=True, timeout=10)
            self.assertEqual(start.returncode, 0, start.stderr)
            self.assertEqual(self.cmd("start").stdout, start.stdout)
            args, url = json.loads(start.stdout)
            self.assertEqual(url, base)
            self.assertEqual(args[-2:], ["--model", MODEL])
            options = json.loads(args[args.index("--settings") + 1])["modelPicker"]["options"]
            self.assertEqual([opt["model"] for opt in options], PICKER_MODELS)
            for opt in options:
                payload = {"model": opt["model"], "max_tokens": 20, "messages": [{"role": "user", "content": "hi"}]}
                with HTTP.open(urllib.request.Request(base + "/v1/messages", json.dumps(payload).encode(),
                               {**headers, "Content-Type": "application/json"}), timeout=5) as r:
                    reply = json.load(r)
                self.assertIn("hello", [block.get("text") for block in reply["content"]])
            self.assertEqual(observed, [("/responses", m) for m in PICKER_MODELS])
        finally:
            server.terminate()
            server.communicate(timeout=6)
        # Cold start from PATH, reuse the same background proxy, and stop it from the launcher.
        try:
            cold = self.cmd()
            self.assertEqual(cold.returncode, 0, cold.stderr)
            pid = (self.runtime / ".auto-pid").read_text()
            warm = self.cmd()
            self.assertEqual(warm.returncode, 0, warm.stderr)
            self.assertEqual(warm.stdout, cold.stdout)
            self.assertEqual((self.runtime / ".auto-pid").read_text(), pid)
        finally:
            stopped = self.cmd("stop")
            self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertIn("already stopped", self.cmd("stop").stdout)
        self.assertEqual(self.cmd("remove").returncode, 0)
        self.assertFalse(self.runtime.exists())
        self.assertEqual(self.cmd("remove").returncode, 0)


if __name__ == "__main__":
    unittest.main()
