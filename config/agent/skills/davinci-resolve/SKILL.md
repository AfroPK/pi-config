---
name: davinci-resolve
description: Drive DaVinci Resolve (free 21.0.3.7) on FStation through the davinci-resolve MCP server - editing, timelines, media pool, renders, DuoFecta episodes. Use for any request to control, inspect, or edit in DaVinci Resolve.
---

# DaVinci Resolve (free edition) via MCP

Resolve runs on **this PC** (FStation, Win11). All detail lives in the repo `AfroPK/davinci-resolve-mcp`
(private), cloned at `__PI_HOME__/code/davinci-resolve-mcp`.
**Read its `docs/limits.md` before promising anything.** This skill is the quick reference.

## Topology (local, no network hop)

```
Resolve -- CursorBridge (in-app, http://127.0.0.1:9876) -- resolve_mcp_bridge.py (stdio MCP, 162 tools)
                                                                 `- Pi server "davinci-resolve" (pi-mcp-adapter)
```

- Two tools are direct: `get_resolve_status`, `get_current_page`.
- Everything else goes through the `mcp` proxy tool:
  - find: `mcp({"search": "timeline", "server": "davinci-resolve"})`
  - schema: `mcp({"describe": "insert_to_timeline"})`
  - call: `mcp({"tool": "insert_to_timeline", "args": {...}})`
- Full 162-tool schema: `data/tools-davinci-resolve-free.json` in the repo.
- The Hermes-side gateway `:38453` / `scripts/mcpcall.py` is **not** needed here.

## The session gate (always check first)

1. Freddy must click **`Workspace > Scripts > CursorBridge`** after **every** Resolve launch.
   The free edition refuses external scripting and there is no headless start. Until then every tool returns
   `Cannot reach the CursorBridge inside DaVinci Resolve`. Ask him to click it; don't debug.
2. Verify: `get_resolve_status` → `{"connected": true, "version": "21.0.3.7"}`.
   Without MCP: `curl -s http://127.0.0.1:9876/status`.
3. Call `get_current_page` before **any** mutating call. It must be `"edit"` (or another real page).
   `null` means Resolve is at the Project Manager or behind a modal: reads work, **every write fails**.
   Ask Freddy to open a project. Don't debug tool arguments.

## Rules

- **One driver at a time.** Resolve is stateful (`load_project` changes what every later call sees).
  Make sure Claude Code, Hermes or another agent is not driving Resolve at the same time.
- **Never send ESC** at Resolve's Project Manager. It quits 21.0.3 and kills the bridge.
- **Verify writes by reading back.** Several tools report success/failure incorrectly.
- Confirm with Freddy before destructive calls (`delete_project`, `delete_timeline_clips`, `delete_media_pool_clips`,
  `reset_all_grades`, ...) and before `start_rendering`.

## Hard limits (measured; do not promise these)

- **No transition tool.** Workaround: author an OTIO with `Transition.1` items and `import_timeline_from_file`
  (the DuoFecta template does this). Otherwise Freddy drags it by hand.
- **No audio-channel expansion tool.** Workaround: OTIO `Channels[].Source Track ID`, or insert the clip on a
  timeline that already has A1-A4 (Resolve spreads the OBS tracks itself).
- **No Adjustment Clips / Edit-page effects** (e.g. the `CopyRightBlur` effect) through tools. Manual, or the DRT
  route below.
- **No keyframes**, no authoring Fusion node internals.
- **`get_clip_properties` is broken** (`Unknown GET endpoint`): transforms are not readable. Use
  `get_current_video_item` for metadata.
- **`insert_to_timeline`**: `start_frame`/`end_frame` are only honoured when **both** are passed; `end_frame` is
  exclusive and unclamped; unknown keys are silently dropped.
- **`set_pool_clip_property`**: return value unreliable; `In`/`Out` need timecode strings (`"00:00:09:00"`), not
  frame numbers. Verify with `get_media_pool` / `get_clip_info`.
- **`set_timeline_setting`** returns false on empty timelines; check `get_timeline_info`.
- 21.0.3's `fusionscript.dll` crashes Python 3.11/3.12 on load; only `C:/Python314` loads it.
- Pinned to Resolve **21.0.3**: 21.1 free breaks the in-app Python bridge. Never upgrade.

## DuoFecta episodes

**Use the template; do not hand-build episodes.** Spec + evidence: `docs/duofecta-template.md` (rules measured from
105 projects, 82 of them StreamPC reaction episodes).

1. Ask for: the recording (`\streampc\Users\Freddy\Videos\<stamp>.mkv`, usually the newest), `"<ARTIST> - <TRACK>"`,
   the comment screenshot(s) he'll reference, and any copyright ranges.
2. Build. Git Bash mangles the UNC path, so run it through PowerShell:
   ```
   powershell -NoProfile -Command "python __PI_HOME__\code\davinci-resolve-mcp\scripts\duofecta_build.py '<mkv>' --name '<name>' --shot '<png>' --copyright-from-track 3 --out 'D:\DuoFecta\_build'"
   ```
   - The copyright cover goes wherever A3 (music) has sound. Never mute or cut A3.
   - Re-edits of an existing cut: `--in-frame --length-frames --shot-frame --shot-zoom --shot-tilt`.
   - Output: `<name>.otio` + `<name>.plan.json`. Check the plan for `fallback` / `NO CUE FOUND` and tell Freddy.
   - **Default cover = blur 100** (it passed YouTube; the card was partially blocked, blur 25 was blocked).
     Blur route (`--copyright-style blur`): import the OTIO → `export_timeline` to a DRT →
     `python __PI_HOME__/code/davinci-resolve-mcp/scripts/copyright_blur_preset.py apply <base.drt> <out.drt> --plan <plan.json> --blur 100`
     → `import_timeline_from_file <out.drt>`. This adds CopyRightBlur Adjustment Clips on a "Copyright Blur" track
     above V1. Details: `docs/duofecta-template.md`.
3. MCP sequence: `create_project` → `import_timeline_from_file` (timelineName `Timeline 1`) → verify clips with
   `get_timeline_clips` → `set_render_format` mp4/H264 → `set_render_settings` from `plan.render` →
   `add_render_job` → `save_project`. **Start rendering only when Freddy says so.**

What the template encodes: head cut on "What's up guys, welcome back..."; tail cut 1.25 s after the last
"Goodbye, guys"; 60 f `Cross Dissolve` + `Cross Fade -3 dB`; YouTube-comment screenshots on V2 at the word "put" of
"I'm gonna put you up here", 5 s, top-centre ~1300 px wide; copyright covers per above.

## Docs map (`__PI_HOME__/code/davinci-resolve-mcp`)

`docs/limits.md` (read first) · `docs/operation.md` · `docs/architecture.md` · `docs/duofecta-template.md` ·
`docs/duofecta-style.md` · `docs/other-agents.md` · `data/tools-davinci-resolve-free.json`
