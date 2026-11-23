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
- skips `.bak` files, auth files, logs, bytecode, sessions, `node_modules`, and virtual environments;
- replaces the source home path with `__PI_HOME__`;
- structurally replaces literal provider keys with environment references;
- records current tool versions, global npm versions, environment requirements, file sizes, and SHA-256 hashes.

The script updates files it manages but does not prune arbitrary stale files. After removing a live extension/skill, remove its old repository directory explicitly if it is no longer wanted, then inspect `git status`.

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
- stale files left by removed resources.

## 3. Verify before publishing

```bash
python scripts/verify.py
python -m unittest discover -s tests -v
```

Test a files-only restore into a temporary directory:

```powershell
$testHome = Join-Path $env:TEMP "pi-config-restore-test"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -DestinationHome $testHome -SkipPackages -SkipPiInstall
python .\scripts\verify.py --installed-home $testHome
```

Use a new empty test directory for each run, or test the backup behavior intentionally. The verification does not make model calls, install global packages, or start services.

For changes to package versions or the ghost-text patch, also run a real package restore on a test account/machine and the extension tests. For launcher changes, test the affected command with a harmless task and a configured local model. Do not claim those integrations are verified by JSON checks alone.

## 4. Commit and push

Only after review and successful checks:

```bash
git add README.md docs config scripts tests manifest.json secrets.example.env .gitignore .gitattributes
git commit -m "Update sanitized Pi configuration snapshot"
git push
```

Never use a broad add to bypass inspection of unexpected files. If GitHub secret scanning or push protection reports a credential, stop, remove it from the entire proposed change, and rotate it if it was valid.

## Updating Pi or extensions

The snapshot deliberately pins the installed CLI and uses lockfiles. To move versions intentionally:

1. Upgrade the live setup using Pi's normal update flow.
2. Test all local extensions against the new Pi API.
3. Compare `pi-ghost-text`'s new renderer with `patches/render.patched.ts`; drop or adapt the patch rather than overwriting blindly.
   `pi-interactive-subagents` comes from the AfroPK fork; merge upstream there, not in the installed copy.
4. Recapture and update the version references in README/guides if needed.
5. Run package/extension tests and the restore test.

`pi update --extensions` can install newer versions allowed by package ranges. The repository installer instead runs `npm ci` for an exact snapshot restore.

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
