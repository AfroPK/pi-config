# bash-guard (pi extension)

Intercepts agent-issued `bash` tool calls and applies different protection depending on whether
the session is interactive (main session) or non-interactive (spawned subagent).

## Modes

Behaviour is determined at registration time via the `PI_SUBAGENT_DEPTH` environment variable,
which pi-subagents injects into every spawned process.

### Main session (`PI_SUBAGENT_DEPTH` = 0 or unset) — interactive prompt

- Heuristically detects destructive/questionable commands via shell-aware parsing
- Prompts for git commands that change state (`commit`, `push`, `pull`, `merge`, `rebase`,
  `checkout`, `restore`, `reset`, `clean`, `rm`, `mv`, `stash pop/drop`, deleting branches/tags,
  rewriting `config`) and escalates severity for especially risky ones: `git rm`,
  `git reset --hard`, `git clean -fdx`, `git push --force`, `git reflog expire`, `git gc --prune`
- Prompts for disk/volume tooling: `diskutil`, `hdiutil`, `mkfs*`, `newfs_*`, `wipefs`, `parted`,
  `fdisk`, `gdisk/sgdisk`, `cryptsetup`, `pvcreate/vgcreate/lvcreate`, `zpool`, `lsblk`
- Prompts for: `rm`/`rmdir`/`unlink`, `sudo`, `find -delete`, `dd`, `truncate`, `sed -i`,
  `perl -pi`, `chmod/chown -R`, `mv/cp --force`, `kill`/`pkill`/`killall`, `shutdown`/`reboot`,
  `systemctl stop/disable`, `curl|sh`/`wget|sh`, `kubectl delete`, `terraform destroy`,
  `aws s3 rm --recursive`, `gcloud delete`, output redirection that escapes the working directory,
  pipes into an interpreter or elevation command (`sh`, `bash`, `sudo`, `python -c`, `node -e`, …)
- Shows a 2-option dialog: **Run** / **Abort**
- If aborted, the tool call is blocked and the model receives a clear reason
- Remembers recently aborted commands for 60 s to prevent retry loops

### Subagent (`PI_SUBAGENT_DEPTH` ≥ 1) — headless hard-block

Spawned subagents have no UI (stdin is `/dev/null`), so prompting is impossible. Instead,
a focused set of catastrophic/unrecoverable operations is hard-blocked with no user interaction:

| Pattern | Reason |
|---|---|
| `rm -r` / `-rf` / `-Rf` | Recursive deletion |
| `sudo` | Elevated privileges |
| `curl\|sh`, `wget\|sh` | Pipe to shell (remote code execution) |
| `mkfs*`, `newfs_*` | Filesystem formatting |
| `wipefs` | Disk signature wipe |
| `diskutil erase/zeroDisk/secureErase/reformat` | Destructive disk operation |
| `dd of=/dev/…` | Raw disk write |
| `parted`, `fdisk`, `gdisk`, `sgdisk` | Partition table management |
| `cryptsetup` | Disk encryption management |
| `zpool` | ZFS pool management |
| `shutdown`, `reboot`, `halt`, `poweroff` | System power operation |
| `terraform destroy` | Infrastructure teardown |
| `kubectl delete` | Kubernetes resource deletion |
| `aws s3 rm --recursive` | Bulk S3 deletion |
| `git commit` | Main-session operation |
| `git pull` | Main-session operation |
| `git push` | Main-session operation |
| `git reset --hard` | Discard all uncommitted changes |
| `git clean -f` | Delete untracked files |
| `git reflog expire` | Remove recovery history |
| `git gc --prune` | Prune unreachable objects |

All other commands (including routine git operations) pass through unaffected.

## Install

Auto-discovered from `~/.pi/agent/extensions/bash-guard/`. Run `/reload` in pi.

## Notes

- Scope: `bash` tool calls only (`write`/`edit` and user `!` commands are not intercepted).
- `--bash-guard-auto-allow`: main-session flag that allows flagged commands when there is no UI
  (e.g. running pi non-interactively). Has no effect in subagent sessions.

## Local changes (this machine, vs upstream)

1. **Pipes** are no longer flagged on their own. Only a pipe whose right-hand side is an
   interpreter or elevation command (`sh`, `bash`, `zsh`, `fish`, `sudo`, `doas`, `iex`,
   `powershell`, `cmd`, `xargs sh`, `python -c`, `node -e`, …) is flagged, as high risk.
2. **Redirects**: `2>` / `2>>` are ignored, and `>` / `>>` only flag when the target escapes the
   working directory (`/…`, `\…`, `C:…`, `~…`, `..…`, `…\Windows\…`). `/dev/null` and `NUL` are
   always allowed.
3. **git**: read-only subcommands pass without a prompt (`status`, `diff`, `log`, `show`, `blame`,
   `grep`, `fetch`, `rev-parse`, `describe`, `ls-files`, `branch` without `-d/-D/-m/-M`, `tag -l`,
   `stash list/show`, `remote -v/show/get-url`, `config --get/-l`). Mutating subcommands still prompt.
4. Fixed a flag-lookup bug: `pi.getFlag("--name")` never matched the registered `"name"`, so both
   `--bash-guard-auto-allow` and `--bash-guard-disabled` were inert.
5. The confirmation dialog now fits the terminal: a long command (heredoc, generated PR body) is
   shown as head + tail with `… (N lines omitted) …` and the risk reasons stay visible, so the
   **Run** / **Abort** list is always on screen. When even the reasons do not fit, only the reasons
   are shown. Resizing the terminal re-fits the body.

6. **agent-desktop never prompts.** Any bash command that invokes `agent-desktop` (in any `;`/`&&`/`|`
   segment) skips the Run/Abort dialog, so desktop control runs uninterrupted. The disabled-mode
   hard-block floor still applies (`rm -r`, `sudo`, `shutdown`, `mkfs`, `git push --force`, …), so
   chaining a catastrophic command onto an agent-desktop call is still refused.

## Test

`node test/dialog-fit.test.mjs` (from this directory) loads `index.ts` through jiti with the same
module aliases pi uses, renders the dialog in a fake terminal at several sizes, and asserts the
list and both borders stay inside the window for long commands, giant single lines, narrow
terminals and resizes.
