# Local patches for installed pi packages

All locally modified npm packages under `~/.pi/agent/npm/node_modules/` are tracked by
`patches-manifest.json` and managed with `manage-patches.mjs`.

```bash
# Check whether all patches and loop-police.json are intact (exit 0 = OK)
node ~/.pi/agent/patches/manage-patches.mjs check

# Reapply any missing patches safely with `git apply --check` (never overwrites conflicting upstream code)
node ~/.pi/agent/patches/manage-patches.mjs apply
```

At runtime, `~/.pi/agent/extensions/patch-guard.ts` checks these markers on `session_start`,
warns immediately if an update/reinstall wiped any patch, and exposes `/patch-status` and `/patch-apply`.
To update Pi or unpinned extensions safely, run `~/.pi/pi-update.cmd` (or `pi-update.ps1`), which
backs up state, runs `pi update`, reapplies compatible patches, and runs `verify-pi-compat.mjs`.

## 1. `pi-ghost-text@0.1.2`

Two patches are applied:

1. **`pi-ghost-text-fake-cursor.patch`** (also kept as `render.patched.ts`):
   - `pi-tui >= 1.6.0` wraps the focused editor cursor as
     `CURSOR_MARKER + FAKE_CURSOR_START (\x1b_pi:fc\x07) + grapheme + FAKE_CURSOR_END (\x1b_pi:/fc\x07)`
     and treats `render()` output arrays as read-only.
   - Patches `src/render.ts` to skip the optional `FAKE_CURSOR_START`/`FAKE_CURSOR_END` markers and
     return `[...lines]` copies instead of mutating in place.
2. **`pi-ghost-text-after-turn.patch`**:
   - Patches `src/client.ts`, `src/editor.ts`, and `src/normalize.ts` (`isNoneSentinelPrefix`) so
     after-turn ghost suggestions work on an empty input box, shrink cleanly on the first typed
     character, and do not flash partial `"NONE"` sentinels while streaming.

## 2. `pi-loop-police@1.14.1`

- **`pi-loop-police-local.patch`**:
  1. Defers loop recovery message delivery (`pendingRecovery` / `RECOVERY_LIMIT = 5` /
     `keepStateOnNextStart`) from `message_end` to `agent_settled` so Pi does not drop recovery
     prompts into an aborting run.
  2. Adds `EXEMPT_PROVIDERS` / `isExemptProvider(ctx)` across `agent_settled`, `message_update`,
     `message_end`, `context`, and `tool_call`, plus documentation in `README.md` and
     `skills/loop-police-help/SKILL.md`.
- **`pi-loop-police.config.json`** -> `extensions/loop-police.json`:
  - Preserves `"EXEMPT_PROVIDERS": "antigravity-acp"` and `"HOOK_LOG": "<home>/.pi/loop-police-detections.jsonl"`.
  - Tested by `~/.pi/agent/tests/loop-police-provider-exemption.test.mjs`.

## 3. `pi-antigravity-acp-provider@0.1.22`

- **`pi-antigravity-acp-provider-native-agy.patch`**:
  - Patches `src/acp/antigravity.ts`, `src/runtime.ts`, and `README.md` so `AGY_ACP_BIN` pointing
    to native `agy` / `agy.exe` (1.5+) launches `agy acp [--dangerously-skip-permissions]` when
    `permissions === "yolo"` and maps `wirePermissionMode` / `confirmedMode` cleanly.

## 4. `@lanlance/pi-btw@0.2.0`

- **`pi-btw-model-runtime.patch`**:
  - Patches `extensions/btw.ts` to pass `modelRuntime: (ctx.modelRegistry as any).runtime` into
    `createAgentSession()` so extension-registered providers (such as `claude-cli`) resolve inside `/btw`.

## 5. `pi-interactive-subagents` (fork, no local patch)

- Installed from `git:github.com/AfroPK/pi-interactive-subagents` (currently at `0d0dd21`), which
  includes the Windows/psmux fixes (`git`, `psmux`, per-pane job objects, absolute cwd handling).
- `pi update --extensions` pulls directly from the fork; model/thinking overrides live in
  `~/.pi/agent/agents/{scout,researcher,worker}.md` (keep LF line endings!).
