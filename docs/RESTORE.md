# Full restoration guide

This guide restores the snapshot onto a Windows account. It does not require access to the original PC, but hosted services need their own credentials and local AI tools need their own installation.

## 1. Understand the restore boundary

The installer reproduces Pi's user-level configuration, custom resources, package versions, launchers, and optional local-model configuration. It does **not** reproduce:

- credentials or OAuth sessions;
- Pi conversation history or compaction backups;
- application binaries, GGUF models, Python virtual environments, or npm `node_modules` directories in the snapshot (dependencies are rebuilt from lockfiles);
- browser cookies/login profiles;
- separately maintained applications such as pi-loop, pi-durable-agent, DaVinci bridge, ComfyUI, Hermes, or Kaggle notebooks.

See [External services](EXTERNAL-SERVICES.md) for those steps.

## 2. Install prerequisites

Required for the core restore:

| Tool | Requirement | Captured version | Purpose |
|---|---|---:|---|
| Windows/PowerShell | Windows 10/11, PowerShell 5.1+ | Windows 11, PS 5.1 | Native installer and launchers |
| Node.js | 22.19+ | 26.13.1 | Pi runtime |
| npm | Bundled or current | 12.2.3 | Exact dependency installation |
| Git | Current | 2.56.0 | Clone and package sources |
| Python | 3.12 recommended | 3.12.10 | Verification, helper scripts, PDF and other skills |
| Git Bash | Current; expected under Scoop in settings | Scoop Git | Pi's configured `shellPath` |

Use official installers or your normal Windows package manager. If Git Bash is not at `~/scoop/apps/git/current/bin/bash.exe`, either install it there or change `shellPath` in `~/.pi/agent/settings.json` after restoration.

Optional but used by the captured tools:

- Google Chrome for `look` page screenshots;
- Playwright Chromium for the `browser_*` tools;
- GitHub CLI (`gh`) for GitHub workflows;
- ImageMagick for `generate_image` pixel processing;
- ripgrep (`rg`) and fd for the global instructions' preferred search commands;
- LuaJIT and LOVE 11.4 for the included Lua skills/templates.

## 3. Clone and inspect

```powershell
git clone https://github.com/AfroPK/pi-config.git
cd pi-config
Get-Content .\manifest.json
Get-Content .\docs\SECRETS.md
```

Before replacing an existing setup, you can make an independent archive as an extra precaution:

```powershell
Compress-Archive -Path "$HOME\.pi" -DestinationPath "$HOME\pi-before-restore.zip" -Force
```

The installer also makes its own per-file backup. Existing credentials in `~/.pi/agent/auth.json` are left in place because the snapshot does not contain that file.

## 4. Choose the restore mode

### Standard restore

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

This restores the Pi files, installs Pi and the `agent-desktop`/`playwright` global tools at captured versions, runs `npm ci --ignore-scripts --legacy-peer-deps` for the package-managed extensions and three local extension projects, and applies all local package patches plus `loop-police.json` via `manage-patches.mjs apply`. Legacy peer resolution prevents npm from installing conflicting copies of Pi host packages that Pi itself supplies to extensions at runtime.

### Files-only restore

Useful for inspection or when all dependencies are already installed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -SkipPackages -SkipPiInstall
```

### Restore to another account or test directory

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -DestinationHome C:\Temp\pi-restore-test -SkipPackages -SkipPiInstall
python .\scripts\verify.py --installed-home C:\Temp\pi-restore-test
```

`__PI_HOME__` in captured text files becomes the destination home. JSON, TypeScript, Python, Markdown, YAML, and shell files use forward slashes; `.cmd`, `.bat`, `.ps1`, and `.vbs` files use native Windows paths.

### Include local-model configuration

Review `config/machine/` first, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -IncludeMachineIntegrations
```

This additionally targets:

- `C:\llama-swap\`;
- `C:\Strata\`;
- `~\llama\`;
- `~\.config\pi-local\env`.

Use `-MachineDrive D:` if the machine integrations live on another drive, then update hard-coded `C:\Strata` and `C:\llama-swap` references inside the restored files accordingly. Model files still need to be downloaded to the exact paths in [External services](EXTERNAL-SERVICES.md#local-models).

### Install all captured global tools

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -InstallAllGlobalPackages
```

The default installs only Pi, agent-desktop, and Playwright. The expanded option also installs OmniRoute, Photoshop MCP, vidLens MCP, Supergateway, TypeScript tools, and the other versions listed in `config/global-npm-packages.json`. It deliberately excludes npm itself to avoid an unexpected package-manager upgrade.

## 5. Configure credentials

At minimum, run Pi and use `/login` for OpenRouter if you use the default cloud model. Provider entries whose keys were sanitized need the variable names documented in [Secrets](SECRETS.md):

- `OMNIROUTER_API_KEY`;
- `KAGGLE_API_KEY`;
- `KAGGLE_STRATA_API_KEY`;
- `RD_API_KEY`.

Only configure services you actually use. Missing credentials do not prevent local providers from loading, but their cloud tools/models will be unavailable.

The `.env.local` file is a storage template only; Pi does not automatically load it. Variables must be present in the terminal/process that starts Pi.

## 6. Finish integration setup

From the repository's browser extension directory:

```powershell
npx playwright install chromium
```

`look` instead uses the globally installed Playwright package and installed Chrome, so it does not need that Chromium download. The browser extension uses `playwright-core` and does need it.

For the PDF skill:

```powershell
python -m venv "$HOME\.pi\agent\skills\pdf-reader\.venv"
& "$HOME\.pi\agent\skills\pdf-reader\.venv\Scripts\python.exe" -m pip install `
  -r "$HOME\.pi\agent\skills\pdf-reader\requirements.txt"
```

Then follow [External services](EXTERNAL-SERVICES.md) for any MCP/local-model integrations you need. Do not start every service merely to make the setup look complete; the local models and MCP servers are independent.

## 7. Add Git Bash aliases (optional)

Either rerun the installer with `-InstallBashAliases`, or add:

```bash
source "$HOME/.pi/pi-aliases.sh"
```

to `~/.bashrc`. Open a new Git Bash window afterward. The file also prepends `~/.pi` to PATH for that shell. Windows Terminal/cmd users should add `%USERPROFILE%\.pi` to the user PATH through Windows environment settings if they want to invoke `pi-plan.cmd` and similar commands by name.

## 8. Verify the restore

Run structural and runtime compatibility checks:

```powershell
python .\scripts\verify.py --installed-home $HOME --runtime
node "$HOME\.pi\agent\patches\manage-patches.mjs" check
node "$HOME\.pi\agent\tests\verify-pi-compat.mjs"
pi --version                 # expected: 1.6.0
pi list                      # lists the 13 configured user packages
pi config                    # inspect loaded resources and built-ins
pi mcp list                  # checks configured servers; unavailable services may fail
```

Expected package declarations:

- `@juanibiapina/pi-plan`;
- `pi-paster`;
- `pi-mcp-adapter`;
- `@oresk/pi-remote-tools`;
- `pi-ssh`;
- `pi-token-speed`;
- `pi-skillful`;
- `pi-loop-police@1.14.1` (pinned + patched);
- `pi-ghost-text@0.1.2` (pinned + patched);
- `@lanlance/pi-btw@0.2.0` (pinned + patched);
- `@gwynnnplaine/pi-discord-presence` (Discord must run unelevated);
- `pi-antigravity-acp-provider@0.1.22` (pinned + patched);
- `pi-interactive-subagents` (git package; run Pi inside `tmux new -A -s pi pi` to use it).

Run the local compatibility and unit tests individually if needed:

```powershell
node "$HOME\.pi\agent\tests\verify-pi-compat.mjs"
node "$HOME\.pi\agent\extensions\bash-guard\test\dialog-fit.test.mjs"
node "$HOME\.pi\agent\extensions\bash-guard\test\agent-desktop.test.mjs"
node --test "$HOME\.pi\agent\tests\ask-guard.test.mjs"
node --test "$HOME\.pi\agent\tests\loop-police-provider-exemption.test.mjs"
```

Then start Pi and check `/model`, `/settings`, `/hotkeys`, `/mcp`, `/patch-status`, and `/reload`. Do not treat a successful CLI load as proof every external model or MCP service works; test only the integrations you configured.

## 9. Roll back

Every replaced file is copied to:

```text
~/.pi-config-backups/<timestamp>/
```

Runs of `pi-update.cmd` also create `pre-update-<timestamp>/` backups under `~/.pi-config-backups/` covering `settings.json`, `models.json`, `keybindings.json`, `npm/package.json`, `npm/package-lock.json`, and `loop-police.json`.

`backup-manifest.json` in installer backup directories maps each original path to its backup. To roll back, close Pi and copy the listed backups back to their `original` paths. Files newly created by the installer are not in that manifest because there was no original to back up; remove those manually if desired.

All local npm package patches (`pi-ghost-text`, `pi-loop-police`, `pi-antigravity-acp-provider`, `@lanlance/pi-btw`) are tracked as unified diffs under `~/.pi/agent/patches/`; running `npm ci --ignore-scripts --legacy-peer-deps` in `~/.pi/agent/npm` without running `manage-patches.mjs apply` returns those packages to clean upstream versions.

## Tested restore path

For this repository snapshot, the installer was run into a fresh temporary home, then rerun to test backups, locked dependency installation, aliases, and the ghost-text patch. Verification confirmed valid path expansion and JSON, 193 backed-up files, an exact patched renderer, and installed package dependencies. The captured bash-guard dialog tests, all 40 agent-desktop guard cases, and the ask-guard Node test passed against the live host Pi installation.

The isolated `npm ci` test also established why `--legacy-peer-deps` is required: ordinary npm peer resolution attempts to install conflicting Pi host versions, while Pi supplies those host packages at runtime.

No paid model/API calls or GPU/service startup was part of testing. External service behavior must be verified separately on the target machine.

### Dependency audit findings in the pinned snapshot

The isolated installation reported:

- managed Pi packages: 3 high (`pi-paster`, `sharp`, `fast-uri`);
- bash-guard: 1 critical (`shell-quote`);
- browser: 0;
- web-fetch: 1 low (`@mozilla/readability`).

These findings are recorded honestly because the repository pins the working historical setup. Run `npm audit` in the relevant installed directory for current details and available fixes. Do not run `npm audit fix --force` as part of restoration: proposed fixes include breaking/downgrade changes and need separate compatibility testing.
