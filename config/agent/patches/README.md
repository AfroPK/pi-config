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

## pi-interactive-subagents 3.7.2 — psmux split can hijack/kill the parent pi pane

**Symptom:** with many subagent panes open (≈11 at 220 columns, fewer in a narrow window), a new
spawn types its launch command into the main pi pane and later kills it.

**Cause:** psmux (the Windows `tmux`) does not fail `split-window` when there is no room; it exits 0
and prints the *target* pane id. The extension trusted that id as the new subagent pane.

**Fix:** `createSurfaceSplit()` in `pi-extension/subagents/tmux.ts` lists pane ids before the split
and throws a clear "no space left to split" error if the returned id already existed.

**Second fix in the same patch:** `/subagent` typed while the parent is mid-turn failed with
"Agent is already processing" (bare `sendUserMessage`). It now uses `deliverAs: "steer"` when
`!ctx.isIdle()`. Verified 2026-11-22: scout spawned ~5 s after `/subagent` during a 25 s bash call.

**Also required on this PC:** the clone must keep LF line endings (the agent frontmatter parser only
matches `\n`). `core.autocrlf=false` and `core.eol=lf` are set in the clone's local git config.

**After a `pi update` / reinstall**, reapply:

```bash
cd ~/.pi/agent/git/github.com/amosblomqvist/pi-interactive-subagents
git config core.autocrlf false && git config core.eol lf
git apply __PI_HOME__/.pi/agent/patches/pi-interactive-subagents-windows.patch
```

Model/thinking overrides for the bundled agents live in `~/.pi/agent/agents/{scout,researcher,worker}.md`
(DeepSeek v4.1 flash, `thinking: xhigh`) and survive updates.
