---
name: love2d
description: Building games with LOVE 11.4 (Lua/LuaJIT) on this PC - project template, pixel-perfect scaling, scenes, tweens, particles, shaders, saving, self-tests and packaging, with API pitfalls. Use for any LOVE / love2d game work, together with game-dev.
---

# LOVE 11.4 games

LOVE 11.4 is at `__PI_HOME__/love2d/` (`lovec.exe` = console build: prints `print()` output and Lua errors).
Everything below was run on this exact build.

## Start from the template (don't write the skeleton from scratch)
```
cp -r __PI_HOME__/.pi/agent/skills/love2d/template/. <game-folder>/
cd <game-folder>
timeout 60 __PI_HOME__/love2d/lovec.exe . --selftest   # must print [selftest] SELFTEST PASS, exit 0
timeout 60 luajit tests/run.lua                             # pure-logic tests, no window
```
Then change `t.identity` / `t.window.title` in `conf.lua` and replace the demo in `main.lua`.

| Template file | What it gives you |
|---|---|
| `conf.lua` | window 1280x720 resizable, identity (save-folder name), unused modules off |
| `main.lua` | callbacks wired to a scene state, `--selftest` mode, demo of every piece below |
| `src/lib/scaler.lua` | virtual resolution (480x270) drawn to a canvas; mode `pixel` (whole-number scale, default) or `fill` (fractional, no borders); `finish(shader, backdrop)` draws a backdrop behind the borders; `to_virtual(x, y)` maps mouse coords |
| `src/lib/settings.lua` | player settings (fullscreen, scaling, volume, vsync): `load/apply/set`, saved in the save folder; `window_locked` for test runs |
| `src/lib/tween.lua` | `tween.to(obj, secs, {k = v}, "outBack", on_done)` + easings (outQuad, outCubic, inOutQuad, outBack, outElastic) |
| `src/lib/sprite.lua` | Aseprite exports: `sprite.strip(png, frame_w, fps)` + `sprite.update/draw` for horizontal-strip animations; `sprite.nine(png, border)` + `sprite.draw_nine(p, x, y, w, h)` for 9-slice panels |
| `src/lib/anim.lua`, `src/lib/ui.lua`, `src/lib/scene.lua`, `shaders/background.glsl` | the juicy UI kit: springs, timelines, buttons, drag slots, tooltips, scene wipes, animated background (see the game-ui skill) |
| `src/lib/save.lua` | `save.write(name, table)` / `save.read(name)` in the save folder (sandboxed load) |
| `src/lib/log.lua` | `log.info(tag, msg)` to stdout and `logs/run.log` (grep it to prove a feature ran) |
| `shaders/crt.glsl` | light CRT pass (scanlines, vignette, colour fringe) for the final upscale |
| `tests/run.lua` | tiny test runner for modules without `love.*` calls |

## Display rules (every game)
- **Start fullscreen** (borderless `desktop` mode, set in `conf.lua`); players switch in the game's **Settings menu**
  (Display: Fullscreen/Windowed, Scaling: Pixel-perfect/Fill screen, Volume). Alt+Enter is only an extra shortcut.
  Never rely on a keyboard shortcut as the only way to change display settings.
- **Default scaling is pixel-perfect**; borders are filled with the animated background (`scaler.finish(crt, backdrop)`),
  never plain black. Fill screen is the player's choice (uneven pixels).
- `--selftest` and `--windowed` runs stay windowed and never change the real window mode (`conf.lua` reads `arg`,
  `settings.window_locked`); self-tests save settings to their own file. Keep both rules when you change these files.
- All UI lives inside the virtual canvas, so nothing can be cut off at any resolution.

## Architecture
- **Logic in pure Lua, LOVE only at the edges.** Rules, scoring, shop, RNG use and save shapes live in `src/` modules
  with no `love.*` calls, so `luajit tests/run.lua` tests them in milliseconds. `main.lua` and scene files only read
  input, call logic, and draw.
- **Scenes:** one table per scene with `enter`, `update(dt)`, `draw()`, `mousepressed(x, y)`, `keypressed(key)`;
  `main.lua` forwards callbacks to the current scene. Keep game state in one table you can save.
- **Draw in virtual pixels** (480x270 is 16:9 and scales cleanly to 1080p/1440p). Fonts, sprites and UI are sized
  for the virtual canvas; never draw directly at window resolution.
- **Animate state, don't block:** input -> logic result -> queue of animations (tweens, timers) -> draw from the
  animated values. Logic never waits for an animation; input is ignored while the queue is playing if needed.

## API facts and pitfalls (each one has bitten local models)
- Colours are **0-1** in 11.x (`setColor(1, 0.5, 0, 1)`), not 0-255. Reset with `setColor(1, 1, 1, 1)` before drawing images.
- `love.graphics.rectangle(mode, x, y, w, h, rx, ry)` - mode ("fill"/"line") is the FIRST argument; same for `circle`, `polygon`.
- Module functions use `.` (`love.graphics.draw(img)`); object methods use `:` (`img:getWidth()`, `ps:emit(10)`, `shader:send(...)`).
- `love.graphics.setDefaultFilter("nearest", "nearest")` must run **before** creating images, canvases and fonts.
- `love.load(args)` receives the command-line args after the game path (use them for `--selftest`, `--seed 42`).
- Files: `love.filesystem` reads the game folder and writes ONLY to the save folder
  `%APPDATA%/LOVE/<identity>/` (fused exe: `%APPDATA%/<identity>/`). `require` uses dots: `require("src.rules.ayo")`.
- `love.graphics.captureScreenshot("x.png")` saves at the **end of the frame** to the save folder: quit a few frames later.
- `love.graphics.newShader` uses LOVE's GLSL: entry point `vec4 effect(vec4 color, Image tex, vec2 uv, vec2 px)`,
  `Texel()` not `texture2D()`, `extern` for uniforms; `shader:send` fails for an unused `extern` (the compiler strips it).
- Random: `love.math.newRandomGenerator(seed)` per run for reproducible runs; never `math.random` in game logic
  (unseeded, shared). Store the seed in the save so a run can be replayed.
- Lua 5.1 / LuaJIT: no `//` integer division (`math.floor(a / b)`), bit ops via `bit.band` etc., `#t` is wrong on
  tables with holes, every variable `local` (a typo silently makes a global).
- Clamp `dt` (`math.min(dt, 1/20)`) so a window drag doesn't teleport animations.
- Text: `love.graphics.newFont(8)` works at small sizes; crisp pixel fonts come from `love.graphics.newImageFont(path, glyphs)`
  (draw them in Aseprite). Use `printf(text, x, y, width, "center")` for alignment.

## Prove it works
1. `luajit tests/run.lua` for logic (add a test per rule, score formula and shop/modifier effect).
2. `timeout 60 __PI_HOME__/love2d/lovec.exe . --selftest`: the self-test drives the real game for N frames with
   scripted input, asserts on state, writes `selftest.png` and logs `SELFTEST PASS`/`FAIL`, then exits 0/1. Extend
   it with each feature; read the console for Lua errors.
3. Look at the screenshot: `look` with `images=["__PI_HOME__/AppData/Roaming/LOVE/<identity>/selftest.png"]`
   (or view it directly if you can see images).

## Ship it
```
"/c/Program Files/7-Zip/7z.exe" a -tzip build/game.love conf.lua main.lua src shaders assets -xr!tests
cat __PI_HOME__/love2d/love.exe build/game.love > build/Game.exe       # fused exe
cp __PI_HOME__/love2d/*.dll __PI_HOME__/love2d/license.txt build/  # ship the DLLs next to it
```
