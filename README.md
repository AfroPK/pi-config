# Pi configuration snapshot

A complete, sanitized snapshot of the Pi setup used on Freddy's Windows 11 PC, plus a repeatable installer and restoration guide.

**Captured:** 2026-11-21 · **Pi:** 1.6.0 · **Node:** 26.13.1 · **Platform:** Windows 11

The repository preserves the active configuration—not old backups or conversation history. It contains **201 captured files**, **31 skills**, **11 local extension entry points**, **10 declared Pi packages**, **37 helper launchers/scripts**, and the referenced llama-swap/Strata profiles.

> **Credential safety:** API keys, OAuth tokens, `auth.json`, sessions, logs, browser profiles, caches, virtual environments, and installed dependencies are not committed. Literal provider keys in the live `models.json` have been replaced with environment-variable references. Run the verification script before every publication.

## Quick restore on Windows

Prerequisites: Git, Node.js 22.19 or newer, npm, PowerShell 5.1 or newer, and Python 3.12 for validation and several skills.

```powershell
git clone https://github.com/AfroPK/pi-config.git
cd pi-config
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
python .\scripts\verify.py --installed-home $HOME
```

The installer:

1. Backs up every file it would replace under `~/.pi-config-backups/<timestamp>/`.
2. Restores `config/agent/` to `~/.pi/agent/` and `config/pi/` to `~/.pi/`.
3. Replaces `__PI_HOME__` with the destination user's home path.
4. Installs Pi 1.6.0 and the core global tools.
5. Uses each `package-lock.json` to install exact Pi package and local-extension dependency versions.
6. Reapplies the local `pi-ghost-text` patch.

Restart the terminal, start Pi, and run `/login` for OpenRouter. See **[Secrets and authentication](docs/SECRETS.md)** before using hosted providers, and **[External services](docs/EXTERNAL-SERVICES.md)** for local models, MCP servers, ComfyUI, Claude CLI, and other integrations.

### Files-only or customized restore

```powershell
# Copy configuration without installing/upgrading anything.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -SkipPackages -SkipPiInstall

# Also restore llama-swap, Strata, local llama.cpp launchers, and pi-loop's env file.
# Review the paths first; these target C:\llama-swap, C:\Strata, and ~\llama.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -IncludeMachineIntegrations

# Restore into a test home rather than the current account.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -DestinationHome C:\Temp\pi-restore-test -SkipPackages -SkipPiInstall

# Install every global npm tool captured in the snapshot, not just the core set.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -InstallAllGlobalPackages
```

To add the captured Git Bash aliases, pass `-InstallBashAliases`, or manually add this line to `~/.bashrc`:

```bash
source "$HOME/.pi/pi-aliases.sh"
```

The alias file intentionally reflects the live `.bashrc`, including a few historical aliases whose launchers no longer exist. The active aliases are listed in [Configuration reference](docs/CONFIGURATION.md#git-bash-aliases).

## What is included

| Area | Repository path | Contents |
|---|---|---|
| Core preferences | `config/agent/settings.json` | Dark theme, default/scoped models, thinking budgets, compaction, package declarations, MCP adapter selection |
| Model endpoints | `config/agent/models.json` | OpenRouter overrides, OmniRoute, three local models, two Kaggle tunnels; remote keys sanitized |
| MCP | `config/agent/mcp.json`, `mcp-adapter.json` | Context7, Firecrawl, Aseprite, DaVinci Resolve, Retro Diffusion, Browse; adapter exposure rules |
| Global instructions | `config/agent/AGENTS.md` | Engineering rules, verification standards, safety, Git and tool conventions |
| Other Pi files | `config/agent/` | Keybindings, prompt suggestions, trusted workspace, package manifests/lockfile |
| Local extensions | `config/agent/extensions/` | Browser, web search/fetch, vision, image generation, Claude CLI, guards, snippets, header |
| Skills | `config/agent/skills/` | All 31 active skills with scripts, references, tests, templates, licenses, and required model asset |
| Local patches | `config/agent/patches/` | Both ghost-text patches, patched renderer, explanation |
| Launchers and roles | `config/pi/` | Planner/executor/reviewer prompts, local-model launchers, environment notes, helper scripts |
| Machine integration | `config/machine/` | llama-swap config, three model launch profiles, Strata config, process cleanup, pi-loop environment |
| Shell | `config/shell/pi-aliases.sh` | PATH setup and captured `pi-*` aliases |
| Versions/integrity | `manifest.json`, `config/global-npm-packages.json` | Capture metadata, exact tool versions, per-file SHA-256 hashes |
| Automation | `scripts/` | Sanitizing capture, safe installer, snapshot/install verification |
| Tests | `tests/` | Credential-redaction and portability unit tests |

There were no custom `prompts/` or `themes/` directories at capture time. The configured theme is Pi's built-in `dark` theme. Prompt templates supplied by packages remain package-managed.

## Everyday commands

```bash
pi                         # configured default: OpenRouter DeepSeek V4.1 Flash
pi-models                  # plain Pi with configured default
pi-models strata           # local Strata Gyro-S, vision-capable
pi-models qwen36           # local Qwen3.6 35B-A3B IQ3 executor model
pi-models plan-swift       # fallback Swift 27B planner
pi-plan "task"             # write a scoped PLAN.md using Strata
pi-review                  # fresh review of PLAN.md
pi-exec                    # execute PLAN.md using Qwen3.6
pi-pe "task"               # plan -> review -> execute
pi-loop TASK.md            # unattended plan/review/execute/code-review loop
pi-durable "task"          # separate durable-agent supervisor; external install required
```

Useful in-session commands include `/model`, `/thinking`, `/settings`, `/reload`, `/snippets`, `/browser on`, `/claude-cli`, `/claude-usage`, and `/mcp`. Use the shell command `pi config` to inspect loaded resources. See the individual extension READMEs for exact behavior.

## Documentation

- **[Full restoration guide](docs/RESTORE.md)** — prerequisites, install order, rollback, and post-restore checks.
- **[Configuration reference](docs/CONFIGURATION.md)** — every settings area, model, extension, package, skill, launcher, and patch.
- **[Secrets and authentication](docs/SECRETS.md)** — required variables and safe sign-in procedures.
- **[External services and dependencies](docs/EXTERNAL-SERVICES.md)** — components that cannot be reproduced by copying Pi files alone.
- **[Maintenance](docs/MAINTENANCE.md)** — recapture, sanitize, verify, update, and publish safely.
- **[Snapshot inventory and exclusions](docs/INVENTORY.md)** — exactly what was and was not captured.

## Verify this repository

```bash
python scripts/verify.py
python -m unittest discover -s tests -v
```

`verify.py` parses all captured JSON, checks manifest hashes, rejects credential files and disposable state, scans for common tokens and literal credential assignments, and requires every remote model key to use environment interpolation or a credential command. The installer test used for this snapshot is described in the restoration guide.

## Known dependency audit status

The exact locked versions are preserved for reproducibility, not represented as vulnerability-free. During the isolated restore test, npm audit reported **3 high** issues in the managed Pi package tree (`pi-paster`/`sharp`/`fast-uri`), **1 critical** issue in bash-guard's locked `shell-quote`, and **1 low** issue in web-fetch's `@mozilla/readability`. The browser extension tree reported none. Review `npm audit` and test upgrades before changing versions; the installer deliberately does not run `npm audit fix` or `npm audit fix --force`.

## Security and scope

This is a **public** configuration repository. Local paths, hostnames, model names, and personal workflow instructions are intentionally visible. No conversation transcripts or credentials belong here. Third-party npm packages and application binaries are referenced by version/source rather than vendored; GGUF models, ComfyUI models, application data, Kaggle notebooks, and separately maintained applications are not included. Those boundaries are explicit in the external-services guide.

The snapshot is Windows-specific. Pi itself is cross-platform, but the `.cmd` launchers, PowerShell scripts, absolute drive layout, ROCm settings, and several skills need adaptation for macOS or Linux.
