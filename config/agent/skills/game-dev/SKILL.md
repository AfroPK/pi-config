---
name: game-dev
description: How to build games that run, feel good and look polished - browser HTML5 canvas games (default) or LOVE 2D (Lua) games. Use for any game, game prototype, interactive toy or simulation with a game loop.
---

# Game development

## Pick the platform
- **Default: a browser game** - one `index.html` with `<canvas>` + inline JS. Runs anywhere, needs no install, easy to check.
- **LOVE 2D (Lua)** only when asked, or when the user names LOVE/Lua; then also read the love2d skill and start from its template. LOVE 11.4 is at `__PI_HOME__/love2d/` (`lovec.exe` = console build that prints errors). Run a game: `timeout 15 __PI_HOME__/love2d/lovec.exe <game-folder>`. There is no `lua` command; plain LuaJIT is `luajit` (no LOVE APIs, no luasocket).
- Three.js / other engines only when asked (3D, physics); load them from a pinned CDN URL.

## Architecture (both platforms)
- One state object (`game`) holds everything; a scene/state machine: `menu -> playing -> paused -> gameover -> menu`.
- Fixed-timestep update, variable render:
  ```js
  const STEP = 1/60; let acc = 0, last = performance.now();
  function frame(now) { acc += Math.min(0.25, (now - last) / 1000); last = now;
    while (acc >= STEP) { update(STEP); acc -= STEP; } render(acc / STEP); requestAnimationFrame(frame); }
  ```
  (LOVE: accumulate `dt` in `love.update` the same way.)
- Input is collected into a state (`keys.left`, `pointer.x`) by event handlers and read in `update`; never move things inside event handlers. Support keyboard AND mouse/touch where it makes sense.
- Game logic in pure functions (`step(state, input, dt)`, `collides(a, b)`), so it can be tested without a window.
- Canvas: size it to the window with `devicePixelRatio` for crisp drawing; letterbox a fixed logical resolution (e.g. 960x540) and scale it.

## Sprites and pixel art (Aseprite MCP)
When a game needs real sprites (characters, items, tiles, animations) instead of drawn shapes, use the `aseprite` MCP server (search its tools through the `mcp` tool, e.g. `mcp({"search": "draw_rows", "server": "aseprite"})`). It runs Aseprite headless and saves `.aseprite` files you can export.
- Small sizes: 16x16 or 32x32 characters, one fixed palette (`list_palette_presets`, then `apply_palette_preset`), 1px dark outline.
- Draw with `draw_rows` (rows of characters + a colour legend) and edit by `read_rows` -> change characters -> `draw_rows`; it keeps shapes consistent between animation frames.
- Check with the text tools first (`lint_sprite`, `get_bounds`, `compare_frames`, `audit_animation`); then look at it (`view_sprite` if you can see images, otherwise export a PNG and call `look`).
- Export with `export_spritesheet` (PNG + JSON atlas) for the game and load it with nearest-neighbour scaling (`image-rendering: pixelated` / `ctx.imageSmoothingEnabled = false`; LOVE: `setDefaultFilter("nearest", "nearest")`).

## Make it look and feel good ("juice")
- Palette of 4-6 colours defined once; dark background, bright readable foreground; no pure primary red/green/blue.
- Draw with shapes, gradients and simple particles instead of missing image files; rounded rects, soft glows (`shadowBlur`), outlines.
- Motion: easing (`easeOutCubic`) for UI and spawns, screen shake on hits (small, decaying), hit-flash, particles on scoring/death, smooth camera.
- UI: big readable score (font from the web-design skill's stack), title screen with the controls listed, pause (P/Esc), game-over screen with score + "press Space to restart", best score in `localStorage` (LOVE: `love.filesystem`).
- Sound only if asked; then generate it with WebAudio (oscillators), not files.
- Difficulty ramps up over time; first 10 seconds are easy.

## Prove it works (a game is not "done" because it compiles)
1. Add a self-test: `?selftest` in the URL (browser) or `--selftest` arg (LOVE) runs the logic for N simulated seconds - synchronously, in a plain loop calling `update(STEP)`, not in real time - with scripted input, asserts invariants (score never negative, player stays in bounds, a game-over happens when it should), prints `SELFTEST PASS` or the failure, and exits/stops.
2. Browser: `timeout 30 "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --dump-dom "file:///C:/path/index.html?selftest" | grep -o "SELFTEST [A-Z]*.*"` (the self-test writes its result into the DOM, e.g. `document.body.dataset.selftest`, or a `<pre id=selftest>`).
   LOVE: `timeout 30 __PI_HOME__/love2d/lovec.exe <folder> --selftest` and read the console output; any Lua error text means it is broken.
3. Unit-test the pure logic (collisions, scoring, level generation) separately: Node (`node --test`) for JS, `luajit tests.lua` for Lua logic that has no LOVE calls.
4. Browser games: if the `look` tool is available, call it with `page=` the game file to check the title screen renders (not blank, readable, nothing cut off). For a LOVE game, save a screenshot with `love.graphics.captureScreenshot` in the self-test and pass it as `images=`.
5. Final message: controls, how to run, what the self-test covers.
