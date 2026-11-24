# Maintaining this snapshot

Use this workflow after changing the live Pi setup. It refreshes captured source files while keeping documentation and repository automation intact.

## 1. Recapture

From the repository on the configured Windows PC:

```bash
python scripts/capture.py --source-home "$USERPROFILE" --repo .
```

Defaults are the current user's home and the repository containing the script, so this is normally sufficient:

```bash
python scripts/capture.py
```

The capture script:

- selects active agent configuration, extensions, skills, tests, patches, package lockfiles, `.pi` launchers/prompts, shell aliases, and known machine integrations;
- skips `.bak` files, `.lock` files (`skillful-install.json.lock`), auth files, logs, bytecode, sessions, `node_modules`, and virtual environments;
- prunes stale files previously captured inside `config/agent/` and `config/pi/`;
- replaces the source home path with `__PI_HOME__`;
- structurally replaces literal provider keys with environment references;
- records current tool versions, global npm versions, environment requirements, file sizes, and SHA-256 hashes.

Keep `agent/agents/*.md` saved with LF line endings (`.gitattributes` enforces this in Git, and `verify.py` / `verify-pi-compat.mjs` fail on CRLF).

## 2. Review the diff

```bash
git status --short
git diff -- config/agent/settings.json config/agent/models.json config/agent/mcp.json
git diff --stat
```

Check for:

- accidental session/personal data;
- new credentials or credential-like strings;
- temporary Kaggle URLs you no longer want documented;
- absolute paths that did not use the captured home prefix;
- upstream package updates that need a changed patch or new documentation;
- stale files left in `config/machine/` if machine integrations changed.

## 3. Verify before publishing

```bash
python scripts/verify.py --runtime
python -m unittest discover -s tests -v
```

Test a files-only restore into a temporary directory:

```powershell
$testHome = Join-Path $env:TEMP "pi-config-restore-test"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -DestinationHome $testHome -SkipPackages -SkipPiInstall
python .\scripts\verify.py --installed-home $testHome
```

Use a new empty test directory for each run, or test the backup behavior intentionally. `--runtime` checks live Pi (`verify-pi-compat.mjs`); the `--installed-home` test verifies restored files without making model calls or starting services.

For changes to package versions or local package patches, run `node "$HOME\.pi\agent\patches\manage-patches.mjs" check` (or test `apply` against a fresh unpacked package tarball) and run `node "$HOME\.pi\agent\tests\verify-pi-compat.mjs"`. For launcher changes, test the affected command with a harmless task and a configured local model. Do not claim those integrations are verified by JSON checks alone.

## 4. Commit and push

Only after review and successful checks:

```bash
git add README.md docs config scripts tests manifest.json secrets.example.env .gitignore .gitattributes
git commit -m "Update sanitized Pi configuration snapshot"
git push
```

Never use a broad add to bypass inspection of unexpected files. If GitHub secret scanning or push protection reports a credential, stop, remove it from the entire proposed change, and rotate it if it was valid.

## Updating Pi or extensions

On the live PC, prefer the safe update wrapper:

```powershell
& "$HOME\.pi\pi-update.cmd"            # updates global Pi CLI, preserves & verifies patches
& "$HOME\.pi\pi-update.cmd" --extensions  # updates unpinned/git extensions, skips pinned patched packages, verifies compat
```

What `pi-update.ps1` automates (and what to check when intentionally bumping a pinned package):

1. Backs up `settings.json`, `models.json`, `keybindings.json`, `npm/package.json`, `npm/package-lock.json`, and `loop-police.json` into `~/.pi-config-backups/pre-update-<timestamp>/`.
2. Runs `pi update` (with any flags such as `--extensions`). Pinned packages in `settings.json` (`pi-ghost-text@0.1.2`, `pi-loop-police@1.14.1`, `pi-antigravity-acp-provider@0.1.22`, `@lanlance/pi-btw@0.2.0`) are skipped by `pi update --extensions`; `pi-interactive-subagents` pulls from `AfroPK/pi-interactive-subagents`.
3. Runs `node ~/.pi/agent/patches/manage-patches.mjs apply` to re-verify/reapply local diffs and restore `loop-police.json`. If you intentionally bump one of the four pinned packages, test each diff against the new upstream tarball before applying—`manage-patches.mjs` refuses blind overwrites on conflicts.
4. Runs `node ~/.pi/agent/tests/verify-pi-compat.mjs` to check `SettingsManager`, `DefaultResourceLoader` (all extensions & skills), deprecated imports, LF `agents/*.md`, `pi --list-models`, and unit tests.
5. Afterward, run `python scripts/capture.py`, `python scripts/verify.py --runtime`, and update docs if versions changed.

If `pi-interactive-subagents` falls behind upstream, merge upstream in a clone of `AfroPK/pi-interactive-subagents`, run its tests, push, and run `pi update git:github.com/AfroPK/pi-interactive-subagents`.

The repository installer (`install.ps1`) uses `npm ci --ignore-scripts --legacy-peer-deps` plus `manage-patches.mjs apply` for an exact reproducible restore.

## Adapting for another machine

- Change `shellPath` if Git Bash is installed elsewhere.
- Edit `.pi/environment.md`; it contains original-PC facts and reserved ports.
- Review `trust.json` and remove/replace `D:\AIWorkspace` if that workspace does not exist.
- Update LAN endpoints such as Firecrawl.
- Recreate external application paths or edit `mcp.json`.
- Retune local-model flags for the target GPU; the captured values assume RX 6750 XT 12 GB/gfx1031.
- Rebuild Python virtual environments rather than copying them.

## Public-repository rule

Treat every recapture as a new public release, even when only one setting changed. Credentials must remain only in local secret stores, never in Git history. Rotate any real secret that slips through immediately.
