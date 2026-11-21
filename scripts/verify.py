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
        if ".bak" in path.name or path.suffix in {".log", ".pyc", ".jsonl"}:
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
    return errors


def check_installation(home: Path) -> list[str]:
    errors: list[str] = []
    agent = home / ".pi" / "agent"
    for relative in ("settings.json", "models.json", "mcp.json", "AGENTS.md"):
        if not (agent / relative).is_file():
            errors.append(f"installed file missing: .pi/agent/{relative}")
    if not (home / ".pi" / "pi-plan.cmd").is_file():
        errors.append("installed file missing: .pi/pi-plan.cmd")
    errors.extend(check_json(agent))
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
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    errors = check_snapshot(repo)
    if args.installed_home:
        errors.extend(check_installation(args.installed_home.resolve()))
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        print(f"Verification failed with {len(errors)} error(s).", file=sys.stderr)
        return 1
    count = len(list((repo / "config").rglob("*")))
    print(f"OK: snapshot JSON, manifest hashes, exclusions, and credential scan passed ({count} config entries).")
    if args.installed_home:
        print(f"OK: restored home validated at {args.installed_home.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
