# Snapshot inventory and exclusions

## Capture identity

See `manifest.json` for the machine-readable source of truth. It records:

- capture timestamp and snapshot format version;
- original OS and tool versions;
- required provider/MCP environment references;
- every captured file's size and SHA-256 hash.

The snapshot was taken on Windows 11 with Pi 1.6.0, Node 26.13.1, npm 12.2.3, Python 3.12.10, and Git 2.56.0.windows.4. It contains 218 files (approximately 4.6 MB before repository documentation).

## Included files

| Area | Files | Notes |
|---|---:|---|
| Agent directory, total | 168 | Includes the categories below |
| Agent top-level | 9 | AGENTS, settings, models, MCP, adapter, keybindings, suggestions, trust, Antigravity provider preferences |
| Local extensions | 33 | Source, READMEs, manifests/lockfiles, snippets, shim, tests; no logs/profiles |
| Skills | 118 | 32 skill directories and supporting source/assets; no venv/bytecode |
| Package npm directory | 3 | `.gitignore`, package manifest, package lock |
| Patches | 4 | README, two diffs, patched renderer |
| Agent tests | 1 | ask-guard test |
| `.pi` root | 39 | Active launchers, role prompts, notes, PowerShell helpers |
| Machine integrations | 9 | llama-swap, Strata, standalone model launchers, Hipfire Ornith launcher, pi-loop env |
| Shell | 1 | Extracted Pi alias/PATH block |
| Global package inventory | 1 | Exact global npm package versions |

`config/agent` counts include its immediate files and all listed subdirectories; categories are not additional to the 168-file total.

## Deliberately excluded: credentials and private state

- `agent/auth.json` and all of its backups;
- MCP OAuth/token stores;
- web-search's real `auth.json` (the placeholder example remains);
- browser `.profile` data, cookies, and login state;
- session JSONL files and session indexes;
- compact backups and smart-compaction cache/extractions;
- logs, including MCP and Claude shim logs;
- loop-police detection history;
- prompt/session caches and other runtime state.

These are either sensitive, machine-specific, or reproducible.

## Deliberately excluded: history and obsolete configuration

- `*.bak*` files throughout `.pi`;
- `agent/extensions-removed-*` and `agent/skills-removed-*`;
- `agent/skills-retired/`;
- `.pi/backup-*` and `.pi/launchers-removed-*`;
- old role/model/launcher variants;
- retired MCP caches and onboarding/version state.

The active source files retain historical comments where those comments explain why current settings exist. The obsolete files themselves are not needed to reproduce the active setup.

## Deliberately excluded: generated dependencies and large artifacts

- all `node_modules` directories;
- `.venv`/`venv` directories and Python bytecode;
- `agent/bin/rg.exe` and `fd.exe` binaries;
- GGUF models and other large AI model weights;
- llama.cpp, llama-swap, Strata, ComfyUI, Aseprite, Resolve, Chrome, and other application binaries;
- ComfyUI checkpoints, LoRA, VAE, packs, generated expert profiles, and output images;
- the separate pi-loop, pi-durable-agent, Aseprite MCP, DaVinci bridge, Hermes, and Kaggle project source directories.

Dependencies with npm lockfiles are recreated by the installer. External source/artifacts are documented in [External services](EXTERNAL-SERVICES.md).

## Small state retained intentionally

Not every JSON file is disposable state. The snapshot retains files that affect reproduction:

- `settings.json` includes changelog markers alongside real preferences;
- `skillful-install.json` records the installed skillful version;
- `prompt-suggestions.json` selects the ghost-suggestion model and mode;
- `trust.json` records the trusted workspace;
- `mcp-adapter.json` contains actual adapter behavior, not a connection cache.

`models-store.json`, `mcp-cache.json`, `mcp-npx-cache.json`, and `mcp-last-seen-version.json` were treated as generated/catalog state and excluded.

## Path and credential transformations

The snapshot is not a byte-for-byte credential dump. Two deliberate transformations make it safe and portable:

1. The original home prefix becomes `__PI_HOME__`; the installer expands it for the target account.
2. Literal remote `apiKey` and authorization values become `${PROVIDER_API_KEY}` environment references.

Everything else is copied from the active source, apart from normal JSON pretty-printing of sanitized `models.json`. Local dummy keys such as `local` remain because they are not credentials.

## Integrity verification

```bash
python scripts/verify.py
```

Verification fails on missing or hash-mismatched captured files, malformed JSON, credential files, logs/backups, excluded directories, common token formats, literal credential assignments, and non-interpolated remote model keys.
