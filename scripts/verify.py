#!/usr/bin/env python3
"""Validate the public snapshot or a files-only restored Pi home."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
from typing import Iterable

REQUIRED = (
    "config/agent/AGENTS.md",
    "config/agent/settings.json",
    "config/agent/models.json",
    "config/agent/mcp.json",
    "config/agent/mcp-adapter.json",
    "config/agent/keybindings.json",
    "config/agent/npm/package.json",
    "config/agent/npm/package-lock.json",
    "config/agent/extensions/bash-guard/index.ts",
    "config/agent/skills/game-dev/SKILL.md",
    "config/pi/pi-plan.cmd",
    "config/pi/pi-exec.cmd",
    "manifest.json",
)
DISALLOWED_PARTS = {"node_modules", ".venv", "__pycache__", "sessions"}
TEXT_SUFFIXES = {
    ".bat", ".cmd", ".env", ".gitignore", ".js", ".json", ".lua", ".md",
    ".mjs", ".patch", ".ps1", ".py", ".sh", ".ts", ".txt", ".yaml", ".yml", "",
}
SECRET_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})")),
    ("OpenAI-style key", re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{12,}")),
    ("Google API key", re.compile(r"\bAIza[A-Za-z0-9_-]{20,}")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
)
CREDENTIAL_ASSIGNMENT = re.compile(
    r"(?i)(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)"
    r"\s*[\"']?\s*[:=]\s*[\"']([^\"'\r\n]{8,})"
)
SAFE_VALUES = {"local", "ollama", "dummy", "password", "your_api_key", "your-api-key"}
ENV_REFERENCE = re.compile(r"^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$")


def text_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
            yield path


def credential_findings(text: str) -> list[str]:
    findings: list[str] = []
    for label, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            findings.append(label)
    for match in CREDENTIAL_ASSIGNMENT.finditer(text):
        value = match.group(1).strip()
        lower = value.lower()
        if (
            lower in SAFE_VALUES
            or value.startswith(("$", "!", "<"))
            or "YOUR_" in value.upper()
            or "REPLACE" in value.upper()
            or "example" in lower
        ):
            continue
        findings.append("literal credential assignment")
    return findings


def check_json(root: Path) -> list[str]:
    errors: list[str] = []
    for path in root.rglob("*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            errors.append(f"{path.relative_to(root)}: invalid JSON: {exc}")
    return errors


def check_snapshot(repo: Path) -> list[str]:
    errors: list[str] = []
    for relative in REQUIRED:
        if not (repo / relative).is_file():
            errors.append(f"missing required file: {relative}")
    if errors:
        return errors

    try:
        manifest = json.loads((repo / "manifest.json").read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"manifest.json: {exc}"]

    import hashlib
    for relative, expected in manifest.get("files", {}).items():
        path = repo / relative
        if not path.is_file():
            errors.append(f"manifest file missing: {relative}")
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected.get("sha256"):
            errors.append(f"manifest hash mismatch: {relative}")

    config = repo / "config"
    errors.extend(check_json(config))
    for path in config.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(repo).as_posix()
        if any(part in DISALLOWED_PARTS for part in path.parts):
            errors.append(f"disposable/dependency directory captured: {relative}")
        if ".bak" in path.name or path.suffix.lower() in {".log", ".pyc", ".jsonl", ".lock"}:
            errors.append(f"backup/log/state captured: {relative}")
        if path.name == "auth.json":
            errors.append(f"credential file captured: {relative}")

    for path in text_files(config):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for finding in credential_findings(text):
            errors.append(f"{path.relative_to(repo)}: possible {finding}")

    models = json.loads((config / "agent" / "models.json").read_text(encoding="utf-8"))
    for name, provider in models.get("providers", {}).items():
        value = provider.get("apiKey")
        if isinstance(value, str) and value.lower() not in SAFE_VALUES:
            if not ENV_REFERENCE.fullmatch(value) and not value.startswith("!"):
                errors.append(f"models.json: provider {name} has a literal apiKey")

    errors.extend(check_pi_compat_static(config / "agent"))
    return errors


def check_pi_compat_static(agent: Path) -> list[str]:
    errors: list[str] = []

    # 1. Agent definitions must use LF line endings (pi-interactive-subagents frontmatter regex requires \n).
    agents_dir = agent / "agents"
    if agents_dir.is_dir():
        for path in sorted(agents_dir.glob("*.md")):
            if b"\r\n" in path.read_bytes():
                errors.append(f"agents/{path.name}: CRLF line endings break pi-interactive-subagents")

    # 2. Local extensions must not import deprecated @mariozechner/* or @sinclair/typebox aliases.
    ext_dir = agent / "extensions"
    if ext_dir.is_dir():
        for path in sorted(ext_dir.rglob("*")):
            if not path.is_file() or any(p in DISALLOWED_PARTS for p in path.parts):
                continue
            if path.suffix.lower() not in {".ts", ".mts", ".js", ".mjs"}:
                continue
            text = path.read_text(encoding="utf-8")
            if re.search(r"@mariozechner/|@sinclair/typebox", text):
                errors.append(f"extensions/{path.relative_to(ext_dir).as_posix()}: deprecated @mariozechner/@sinclair import")

    # 3. Skills frontmatter matches Pi's skill loader contract.
    skills_dir = agent / "skills"
    if skills_dir.is_dir():
        for skill_dir in sorted(p for p in skills_dir.iterdir() if p.is_dir()):
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.is_file():
                errors.append(f"skills/{skill_dir.name}: missing SKILL.md")
                continue
            raw = skill_md.read_bytes()
            if raw.startswith(b"\xef\xbb\xbf"):
                errors.append(f"skills/{skill_dir.name}/SKILL.md: UTF-8 BOM not allowed")
            text = raw.decode("utf-8")
            fm_match = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", text)
            if not fm_match:
                errors.append(f"skills/{skill_dir.name}/SKILL.md: missing YAML frontmatter")
                continue
            fm = fm_match.group(1)
            name_m = re.search(r"^name:\s*[\"']?([^\r\n\"']+)[\"']?\s*$", fm, re.MULTILINE)
            desc_m = re.search(r"^description:\s*(.+)$", fm, re.MULTILINE)
            if not name_m or name_m.group(1).strip() != skill_dir.name:
                errors.append(f"skills/{skill_dir.name}/SKILL.md: frontmatter name must match directory")
            elif not re.fullmatch(r"[a-z0-9-]{1,64}", name_m.group(1).strip()):
                errors.append(f"skills/{skill_dir.name}/SKILL.md: invalid name format")
            if not desc_m or not desc_m.group(1).strip():
                errors.append(f"skills/{skill_dir.name}/SKILL.md: missing description")

    # 4. Patches manifest references valid patch/config files.
    patches_dir = agent / "patches"
    manifest_path = patches_dir / "patches-manifest.json"
    if not manifest_path.is_file():
        errors.append("patches/patches-manifest.json: missing")
    else:
        try:
            p_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for pkg in p_manifest.get("packages", []):
                for p in pkg.get("patches", []):
                    if not (patches_dir / p["file"]).is_file():
                        errors.append(f"patches/{p['file']}: missing")
                for c in pkg.get("configCopies", []):
                    if not (patches_dir / c["source"]).is_file():
                        errors.append(f"patches/{c['source']}: missing")
        except (OSError, json.JSONDecodeError, KeyError) as exc:
            errors.append(f"patches/patches-manifest.json: {exc}")

    return errors


def check_installation(home: Path) -> list[str]:
    errors: list[str] = []
    agent = home / ".pi" / "agent"
    for relative in (
        "settings.json",
        "models.json",
        "mcp.json",
        "AGENTS.md",
        "patches/manage-patches.mjs",
        "patches/patches-manifest.json",
        "tests/verify-pi-compat.mjs",
    ):
        if not (agent / relative).is_file():
            errors.append(f"installed file missing: .pi/agent/{relative}")
    if not (home / ".pi" / "pi-plan.cmd").is_file():
        errors.append("installed file missing: .pi/pi-plan.cmd")
    if not (home / ".pi" / "pi-update.cmd").is_file():
        errors.append("installed file missing: .pi/pi-update.cmd")
    errors.extend(check_json(agent))
    errors.extend(check_pi_compat_static(agent))
    for path in text_files(home / ".pi"):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if "__PI_HOME__" in text:
            errors.append(f"unexpanded home token: {path}")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--installed-home", type=Path, help="Also validate a restored home directory")
    parser.add_argument("--runtime", action="store_true", help="Also run verify-pi-compat.mjs against the installed home (or live home)")
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    errors = check_snapshot(repo)
    if args.installed_home:
        errors.extend(check_installation(args.installed_home.resolve()))
    if args.runtime:
        import subprocess
        target_home = args.installed_home.resolve() if args.installed_home else Path.home()
        compat = target_home / ".pi" / "agent" / "tests" / "verify-pi-compat.mjs"
        if not compat.is_file():
            errors.append(f"runtime verifier missing: {compat}")
        else:
            res = subprocess.run(["node", str(compat), "--agent-dir", str(target_home / ".pi" / "agent")], capture_output=True, text=True)
            if res.returncode != 0:
                errors.append(f"verify-pi-compat.mjs failed:\n{res.stdout}\n{res.stderr}".strip())
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        print(f"Verification failed with {len(errors)} error(s).", file=sys.stderr)
        return 1
    count = len(list((repo / "config").rglob("*")))
    print(f"OK: snapshot JSON, manifest hashes, exclusions, compat checks, and credential scan passed ({count} config entries).")
    if args.installed_home:
        print(f"OK: restored home validated at {args.installed_home.resolve()}")
    if args.runtime:
        print("OK: live Pi runtime compatibility checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
