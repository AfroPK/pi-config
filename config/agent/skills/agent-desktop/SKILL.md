---
name: agent-desktop
description: Drive Freddy's Windows desktop (see and operate native apps) with the agent-desktop CLI from vercel-labs - click buttons, fill forms, read UI state, navigate menus, type, press shortcuts, launch/close/move windows, clipboard, notifications, screenshots of app windows. Use for ANY computer-use / desktop GUI automation task instead of pyautogui, PowerShell SendKeys, AutoHotkey, nircmd or screenshot-and-guess coordinates.
---

# Desktop control: agent-desktop (always)

`agent-desktop` (v1.3.x, global npm install, on PATH) reads and operates Windows apps through
UI Automation. Run it with the `bash` tool. Every command prints one JSON envelope
(`ok`, `data` or `error`). It is a tool, not an agent: you run the observe → act → verify loop.

**It is THE tool for driving the desktop.** Do not use pyautogui, pywinauto, PowerShell
`SendKeys`/`System.Windows.Forms`, AutoHotkey, nircmd, or "take a screenshot and click
coordinates" unless agent-desktop has demonstrably failed for that exact step and Freddy agreed.
Exceptions: web pages → the browser tools (`browse` MCP / `browser_*`); DaVinci Resolve → its
MCP server (davinci-resolve skill); Aseprite → its MCP server.

## First use in a session (mandatory)

```bash
agent-desktop status                  # platform, permissions, supported surfaces
agent-desktop skills get desktop      # the loop, refs, verification, retry rules
agent-desktop skills get platform     # Windows specifics
```
These guides are compiled into the binary and match its version: they win over this file.
Flags for one command: `agent-desktop <command> --help`.
Deeper references: `agent-desktop skills get desktop workflows` (also `commands-observation`,
`commands-interaction`, `commands-system`), and
`agent-desktop skills get agent-desktop-windows references/troubleshooting.md`.

## The loop

```bash
agent-desktop list-apps                                         # running apps by process name
agent-desktop snapshot --app Notepad.exe -i --compact           # small app: full interactive tree
agent-desktop snapshot --skeleton --app slack.exe -i --compact  # dense app: map first...
agent-desktop snapshot --root @s8f3k2p9:e3 -i --compact         # ...then drill one region
agent-desktop click @s8f3k2p9:e12                               # act on a qualified ref
agent-desktop snapshot --root @s8f3k2p9:e3 -i --compact         # verify by re-reading
```
- `--app` takes the process name from `list-apps` (`WindowsTerminal.exe`; `.exe` optional), not a window title.
- UWP/Store apps (Calculator, Settings, Photos...) show in `list-apps` only as `ApplicationFrameHost.exe`, which has no
  drivable window. Run `list-windows` and use its `app_name` (e.g. `CalculatorApp.exe`) with `--app`. `close-app`
  cannot find them: close by clicking the window's `Close` button ref instead.
- `delivered_unverified` on a click is normal (many buttons expose no readback): verify with a fresh snapshot.
- Refs are `@<snapshot_id>:e<N>`, valid for one snapshot. Bash needs no quoting; PowerShell does (`'@s..:e1'`).
- `STALE_REF` / `SNAPSHOT_NOT_FOUND` → fresh snapshot. `AMBIGUOUS_TARGET` → pick a unique control or `--window-id`.
- Retry only when `disposition.retry` is `safe` (`not_delivered`). Otherwise read live state first; a repeat may click/type twice.
- Use `wait` after async steps, never a fixed sleep.
- bash-guard never prompts for a command that runs agent-desktop (its hard blocks on `rm -r`, `sudo`,
  `shutdown`... still apply), so keep each call to agent-desktop plus output filtering only.
- Keep context small:
  - search with `find`: `agent-desktop find --app CalculatorApp.exe --role button --name Equals`
  - filter with jq: `agent-desktop snapshot --app X -i | jq -c '[.. | objects | select(.ref_id) | {name,role,ref_id}]'`
  - or `| head -c 20000`, or drill with `--root`.
  - If you save output, write it to the working directory (`> snap.json`) and read it with `jq`.

## Windows rules that bite

- Headless (default) does not move the mouse or steal focus. **Prefer it.** `type`, `right-click`,
  `double-click`, `focus`, hover, drag, mouse-* need the global `--headed` flag. Use `set-value`
  instead of `type` when possible. Use `--headed` only for steps that need physical input, and
  say so; never switch to headed just to recover from a headless failure.
- Minimized windows are not drivable: `restore --app <name>` then re-snapshot. Avoid `focus-window`
  unless needed (it steals Freddy's foreground).
- `launch` takes an absolute exe path or a bare System32 name (`notepad`), not a display name.
- Chromium/Electron apps read thin at first: pass a larger `--timeout-ms` to `snapshot`.
- Blocked shortcuts (`alt+f4`, `win+r`, `alt+tab`...) need `--force`: confirm with Freddy first.
- Elevated (admin) windows cannot be driven from a non-elevated shell.

## Safety

- Snapshots, screenshots and clipboard output can contain private content: never paste them
  into commits, logs or web uploads.
- Confirm with Freddy before anything destructive or outward-facing via the GUI: deleting,
  sending messages/emails, purchases, submitting forms, closing apps with unsaved work
  (`close-app --force`).
- Secrets: `set-value --stdin` / `clipboard-set --stdin`, never in arguments.
