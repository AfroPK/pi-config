from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


verify = load("verify", ROOT / "scripts" / "verify.py")
capture = load("capture", ROOT / "scripts" / "capture.py")


class CredentialTests(unittest.TestCase):
    def test_environment_references_and_local_keys_are_safe(self):
        text = '"apiKey": "${KAGGLE_API_KEY"}\n"apiKey": "local"'
        self.assertEqual(verify.credential_findings(text), [])

    def test_literal_remote_key_is_rejected(self):
        self.assertIn("OpenAI-style key", verify.credential_findings('"apiKey": "sk-abc123def456ghi789"'))

    def test_arbitrary_literal_api_key_is_rejected(self):
        self.assertIn("literal credential assignment", verify.credential_findings('"apiKey": "a9f8e7d6c5b4a3928170"'))

    def test_task_id_does_not_look_like_an_api_key(self):
        self.assertEqual(verify.credential_findings("task-2026-10-22T20-15-00"), [])


class CaptureTests(unittest.TestCase):
    def test_models_are_redacted_without_changing_local_dummy_keys(self):
        data = {
            "providers": {
                "remote-one": {"apiKey": "a9f8e7d6c5b4a3928170"},
                "local": {"apiKey": "local"},
            }
        }
        required = capture.sanitize_models(data)
        self.assertEqual(data["providers"]["remote-one"]["apiKey"], "${REMOTE_ONE_API_KEY}")
        self.assertEqual(data["providers"]["local"]["apiKey"], "local")
        self.assertEqual(required, ["REMOTE_ONE_API_KEY"])

    def test_home_path_forms_become_portable_token(self):
        home = Path("C:/Users/Example")
        text = r"C:/Users/Example/.pi C:\Users\Example\.pi C:\\Users\\Example\\.pi"
        replaced = capture.sanitize_text(text, home)
        self.assertNotIn("Example", replaced)
        self.assertEqual(replaced.count(capture.HOME_TOKEN), 3)

    def test_captured_models_have_no_literal_remote_keys(self):
        models = json.loads((ROOT / "config" / "agent" / "models.json").read_text(encoding="utf-8"))
        for provider in models["providers"].values():
            value = provider.get("apiKey")
            if value and value != "local":
                self.assertRegex(value, r"^\$\{[A-Z][A-Z0-9_]*\}$")


class CompatTests(unittest.TestCase):
    def test_static_compat_catches_crlf_agents_legacy_imports_and_bad_skills(self):
        with tempfile.TemporaryDirectory() as td:
            agent = Path(td)
            (agent / "agents").mkdir()
            (agent / "agents" / "scout.md").write_bytes(b"---\r\nname: scout\r\n---\r\n")
            (agent / "extensions").mkdir()
            (agent / "extensions" / "bad.ts").write_text('import "@mariozechner/pi-coding-agent";', encoding="utf-8")
            (agent / "skills" / "demo-skill").mkdir(parents=True)
            (agent / "skills" / "demo-skill" / "SKILL.md").write_text("---\nname: wrong-name\ndescription: ok\n---\n", encoding="utf-8")
            (agent / "patches").mkdir()
            (agent / "patches" / "patches-manifest.json").write_text('{"packages":[]}', encoding="utf-8")

            errors = verify.check_pi_compat_static(agent)
            joined = "\n".join(errors)
            self.assertIn("CRLF line endings", joined)
            self.assertIn("deprecated @mariozechner", joined)
            self.assertIn("frontmatter name must match directory", joined)


if __name__ == "__main__":
    unittest.main()
