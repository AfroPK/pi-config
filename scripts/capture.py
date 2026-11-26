#!/usr/bin/env python3
"""Capture the active Pi configuration without credentials or disposable state."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
from typing import Any

HOME_TOKEN = "__PI_HOME__"
AGENT_FILES = (
    "AGENTS.md",
    "settings.json",
    "keybindings.json",
    "models.json",
    "mcp.json",
    "mcp-adapter.json",
    "prompt-suggestions.json",
    "trust.json",
    # Provider preferences only; its sessions.json is per-machine state.
    "antigravity-acp-provider/config.json",
)
TEXT_SUFFIXES = {
    ".bat", ".cmd", ".conf", ".css", ".env", ".gitignore", ".glsl", ".html", ".js",
    ".json", ".lua", ".md", ".mjs", ".patch", ".ps1", ".py", ".sh", ".ts",
    ".txt", ".vbs", ".xml", ".yaml", ".yml", "",
}
SKIP_DIRS = {"node_modules", ".venv", "venv", "__pycache__", ".git", "sessions"}
LOCAL_FILES = (
    ("C:/llama-swap/config.yaml", "llama-swap/config.yaml"),
    ("C:/llama-swap/start-llama-swap.bat", "llama-swap/start-llama-swap.bat"),
    ("C:/llama-swap/kill-tree.ps1", "llama-swap/kill-tree.ps1"),
    ("C:/Strata/start-strata-pi.bat", "Strata/start-strata-pi.bat"),
    ("C:/Strata/strata-gyro-gyro-s.json", "Strata/strata-gyro-gyro-s.json"),
    ("llama/start-qwen36-iq3.bat", "llama/start-qwen36-iq3.bat"),
    ("llama/start-swift27-xs-64k.bat", "llama/start-swift27-xs-64k.bat"),
    ("hipfire-test/serve-ornith.cmd", "hipfire-test/serve-ornith.cmd"),
)
# psmux (the Windows tmux that pi-interactive-subagents drives) loads the first of
# these it finds, so every candidate is captured under its home-relative path.
PSMUX_CONFIGS = (".psmux.conf", ".tmux.conf", ".config/psmux/psmux.conf")


def command_version(command: list[str]) -> str | None:
    try:
        executable = shutil.which(command[0])
        resolved = [executable or command[0], *command[1:]]
        result = subprocess.run(resolved, capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    output = (result.stdout or result.stderr).strip()
    return output.splitlines()[0] if result.returncode == 0 and output else None


def global_npm_packages() -> dict[str, str]:
    try:
        npm = shutil.which("npm") or "npm"
        result = subprocess.run(
            [npm, "list", "-g", "--depth=0", "--json"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        data = json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return {}
    return {
        name: details["version"]
        for name, details in sorted(data.get("dependencies", {}).items())
        if isinstance(details, dict) and isinstance(details.get("version"), str)
    }


def environment_name(provider: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", provider).strip("_").upper() + "_API_KEY"


def is_env_reference(value: str) -> bool:
    return bool(re.fullmatch(r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?", value.strip()))


def sanitize_models(data: dict[str, Any]) -> list[str]:
    """Replace literal remote credentials with Pi's environment interpolation."""
    required: list[str] = []
    for provider_name, provider in data.get("providers", {}).items():
        if not isinstance(provider, dict):
            continue
        env_name = environment_name(provider_name)
        api_key = provider.get("apiKey")
        if isinstance(api_key, str) and api_key.lower() not in {"local", "ollama", "dummy"}:
            if not is_env_reference(api_key) and not api_key.startswith("!"):
                provider["apiKey"] = "${" + env_name + "}"
            if is_env_reference(str(provider["apiKey"])):
                required.append(env_name)
        headers = provider.get("headers", {})
        if isinstance(headers, dict):
            for key, value in headers.items():
                if key.lower() != "authorization" or not isinstance(value, str):
                    continue
                if "$" not in value and not value.startswith("!"):
                    scheme = "Bearer " if value.lower().startswith("bearer ") else ""
                    headers[key] = scheme + "${" + env_name + "}"
                if "$" in str(headers[key]):
                    required.append(env_name)
    return sorted(set(required))


def sanitize_text(text: str, source_home: Path) -> str:
    """Make captured paths portable; credentials are handled structurally above."""
    home_native = str(source_home)
    home_forward = source_home.as_posix()
    for old in (home_forward, home_native.replace("\\", "\\\\"), home_native):
        text = text.replace(old, HOME_TOKEN)
    return text


def is_text(path: Path) -> bool:
    return path.suffix.lower() in TEXT_SUFFIXES or path.name in {".gitignore", "env"}


def copy_file(source: Path, destination: Path, source_home: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if is_text(source):
        try:
            text = source.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            shutil.copy2(source, destination)
            return
        destination.write_bytes(sanitize_text(text, source_home).encode("utf-8"))
    else:
        shutil.copy2(source, destination)


def copy_tree(source: Path, destination: Path, source_home: Path) -> list[Path]:
    copied: list[Path] = []
    if not source.is_dir():
        return copied
    for path in sorted(source.rglob("*")):
        if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
            continue
        if ".bak" in path.name or path.suffix.lower() in {".log", ".pyc", ".lock"}:
            continue
        if path.name == "auth.json":  # auth.example.json remains eligible.
            continue
        target = destination / path.relative_to(source)
        copy_file(path, target, source_home)
        copied.append(target)
    return copied


def required_environment(config_root: Path) -> list[str]:
    """List uppercase interpolation names in executable provider/MCP configuration only."""
    names: set[str] = set()
    reference = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")
    for relative in ("agent/models.json", "agent/mcp.json"):
        path = config_root / relative
        if path.is_file():
            names.update(reference.findall(path.read_text(encoding="utf-8")))
    return sorted(names)


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prune_stale_files(root: Path, keep: set[Path]) -> None:
    if not root.is_dir():
        return
    for existing in sorted(root.rglob("*"), reverse=True):
        if existing.is_file() and existing not in keep:
            existing.unlink()
        elif existing.is_dir() and not any(existing.iterdir()):
            existing.rmdir()


def capture(source_home: Path, repo: Path) -> dict[str, Any]:
    source_home = source_home.resolve()
    agent = source_home / ".pi" / "agent"
    config = repo / "config"
    if not agent.is_dir():
        raise ValueError(f"Pi agent directory not found: {agent}")

    copied: list[Path] = []
    for name in AGENT_FILES:
        source = agent / name
        if source.is_file():
            target = config / "agent" / name
            copy_file(source, target, source_home)
            copied.append(target)

    models_path = config / "agent" / "models.json"
    if models_path.is_file():
        models = json.loads(models_path.read_text(encoding="utf-8"))
        sanitize_models(models)
        models_path.write_text(json.dumps(models, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for name in ("extensions", "skills", "tests", "agents"):
        copied.extend(copy_tree(agent / name, config / "agent" / name, source_home))
    for name in ("patches", "npm"):
        copied.extend(copy_tree(agent / name, config / "agent" / name, source_home))

    for source in sorted((source_home / ".pi").iterdir()):
        if not source.is_file() or ".bak" in source.name or source.suffix.lower() in {".jsonl", ".lock"}:
            continue
        target = config / "pi" / source.name
        copy_file(source, target, source_home)
        copied.append(target)

    for relative in PSMUX_CONFIGS:
        source = source_home / relative
        if source.is_file():
            target = config / "psmux" / relative
            copy_file(source, target, source_home)
            copied.append(target)

    copied_set = set(copied)
    prune_stale_files(config / "agent", copied_set)
    prune_stale_files(config / "pi", copied_set)
    prune_stale_files(config / "psmux", copied_set)

    aliases = [
        "# Pi local-model launchers. Source this file from ~/.bashrc after adding ~/.pi to PATH.",
        'export PATH="$HOME/.pi:$PATH"',
    ]
    bashrc = source_home / ".bashrc"
    if bashrc.is_file():
        for line in bashrc.read_text(encoding="utf-8").splitlines():
            if re.match(r"\s*alias\s+pi-[A-Za-z0-9_-]+=", line):
                aliases.append(line)
    alias_file = config / "shell" / "pi-aliases.sh"
    alias_file.parent.mkdir(parents=True, exist_ok=True)
    alias_file.write_text("\n".join(aliases) + "\n", encoding="utf-8")
    copied.append(alias_file)

    for original, relative in LOCAL_FILES:
        source = Path(original) if original.startswith("C:/") else source_home / original
        if source.is_file():
            target = config / "machine" / relative
            copy_file(source, target, source_home)
            copied.append(target)
    loop_env = source_home / ".config" / "pi-local" / "env"
    if loop_env.is_file():
        target = config / "machine" / "pi-local" / "env"
        copy_file(loop_env, target, source_home)
        copied.append(target)

    packages = global_npm_packages()
    global_file = config / "global-npm-packages.json"
    global_file.parent.mkdir(parents=True, exist_ok=True)
    global_file.write_text(json.dumps(packages, indent=2) + "\n", encoding="utf-8")
    copied.append(global_file)

    manifest_files = {
        path.relative_to(repo).as_posix(): {"bytes": path.stat().st_size, "sha256": hash_file(path)}
        for path in sorted(set(copied))
    }
    manifest = {
        "snapshotVersion": 1,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "sourceHomeToken": HOME_TOKEN,
        "platform": platform.platform(),
        "versions": {
            "pi": command_version(["pi", "--version"]),
            "node": command_version(["node", "--version"]),
            "npm": command_version(["npm", "--version"]),
            "python": command_version(["python", "--version"]),
            "git": command_version(["git", "--version"]),
        },
        "requiredEnvironment": required_environment(config),
        "files": manifest_files,
    }
    (repo / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-home", type=Path, default=Path.home(), help="Home containing the live .pi directory")
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1], help="Repository to update")
    args = parser.parse_args(argv)
    try:
        manifest = capture(args.source_home, args.repo.resolve())
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"capture failed: {exc}", file=sys.stderr)
        return 1
    print(f"Captured {len(manifest['files'])} files; credentials were replaced with environment references.")
    print("Required environment variables: " + ", ".join(manifest["requiredEnvironment"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
