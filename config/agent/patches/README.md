# Local patches for installed pi packages

## pi-ghost-text 0.1.2 — ghost text invisible on pi/pi-tui 1.6.0

**Symptom:** `pi-ghost-text` is installed and configured (`~/.pi/agent/prompt-suggestions.json`,
mode `both`), suggestions are generated, but nothing dim ever appears in the prompt box.

**Cause:** pi-tui 1.6.0 renders the focused editor cursor as

```
CURSOR_MARKER + FAKE_CURSOR_START (\x1b_pi:fc\x07) + grapheme + FAKE_CURSOR_END (\x1b_pi:/fc\x07)
```

`renderGhostText()` in `src/render.ts` only skipped `CURSOR_MARKER` + SGR + one grapheme + SGR and then
required the rest of the line to be plain padding. The APC fake-cursor markers made that final match
fail, so the function returned the line unchanged (no ghost), silently.

**Fix:** skip the optional `FAKE_CURSOR_START`/`FAKE_CURSOR_END` markers around the cursor cell, and
copy the lines array instead of mutating it (pi >= 1.6 treats render output as read-only).

**Applied here:** `~/.pi/agent/npm/node_modules/pi-ghost-text/src/render.ts` (patched copy:
`render.patched.ts`, patch: `pi-ghost-text-fake-cursor.patch`).

**After a `pi update` / reinstall of pi-ghost-text**, reapply:

```bash
# either
cp ~/.pi/agent/patches/render.patched.ts ~/.pi/agent/npm/node_modules/pi-ghost-text/src/render.ts
# or
cd ~/.pi/agent/npm/node_modules/pi-ghost-text && patch -p1 < ~/.pi/agent/patches/pi-ghost-text-fake-cursor.patch
```

Verified behaviour 2026-11-20: real `Editor` from pi-tui 1.6.0 + `SuggestingEditor`, mocked
`modelRegistry.complete` → ghost renders after the cursor, no width overflow, Tab accepts, Esc/typing
behaves. Worth reporting upstream (jcv/pi-ghost-text) so the patch can be dropped.

## pi-interactive-subagents — now a fork, no local patch

The Windows/psmux fixes (Git Bash instead of WSL, killed-pane detection, per-session pane ids, LF checkout, split guard, mid-turn `/subagent`) are committed in
https://github.com/AfroPK/pi-interactive-subagents (commit 7d69925), which `settings.json` installs.
`pi update --extensions` pulls the fork, so nothing needs reapplying. Model/thinking overrides for the
bundled agents live in `~/.pi/agent/agents/{scout,researcher,worker}.md` (DeepSeek v4.1 flash, `xhigh`).
