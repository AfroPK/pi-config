---
name: game-ui
description: Juicy game UI in LOVE 11.4 - hover lift/tilt/wobble, pop on events, drag-to-reorder slots, tooltips, a step-by-step scoring show, animated screen transitions and an animated background shader, using the tested UI kit in the love2d template. Use for any game screen, menu, HUD, shop or scoring display.
---

# Game UI that feels alive (LOVE)

A scoring roguelike lives or dies on its UI: every element reacts, scoring is a show, and screens flow into each
other. The kit for this is in the love2d template (tested on LOVE 11.4; a full demo with a scripted self-test is
in `demo/` here). Don't hand-roll UI code - compose screens from these parts.

| Module (template) | Use it for |
|---|---|
| `src/lib/anim.lua` | `anim.spring(x)` values with overshoot (`target`, `spring_update`, `kick`); `anim.queue()` timelines (`add(dur, on_start, on_update)`, `wait`, `call`, `busy`); `anim.sway` idle motion |
| `src/lib/ui.lua` | `ui.button{...}`, `ui.slots{...}` (drag to reorder, `on_reorder`), hover lift + tilt + idle sway, `ui.pop(w)` on events, `.tip` tooltips, `ui.draw/draw_slots/draw_tooltip`, `enabled` flag |
| `src/lib/scene.lua` | `scene.add(name, {enter, update, draw, mousepressed, ...})`, `scene.go(name, params)` with a diagonal wipe; input is blocked during the wipe |
| `shaders/background.glsl` | slow swirl in 3 palette colours, banded so it reads as pixel art (`time`, `size`, `col_a/b/c`) |
| `shaders/crt.glsl` | final CRT pass over the upscaled frame |

## Run the demo first
```
cd __PI_HOME__/.pi/agent/skills/game-ui/demo
cp -r ../../love2d/template/src ../../love2d/template/shaders .     # refresh the kit copies
timeout 90 __PI_HOME__/love2d/lovec.exe . --selftest              # SELFTEST PASS; screenshots shot_1..5.png
```
It shows every pattern below in ~250 lines of `main.lua`: badges you hover and drag, a SCORE button that plays the
scoring show, a SHOP button with the wipe. Copy patterns from it.

## Rules
1. **Logic decides, UI shows.** Compute the full result first (scoring engine, Ayo rules), then queue the steps
   that reveal it (`anim.queue`). The UI never changes game state; it only calls back (`on_click`, `on_reorder`).
2. **Everything interactive is juicy:** hover = lift 2 px + scale 1.08 + slight tilt; click/fire = `ui.pop`;
   idle items sway a little each with its own phase. Shadows stay on the ground while things lift.
3. **Scoring show:** one queue step per modifier/event in slot order (0.3-0.4 s each): `ui.pop(item)`, a floating
   label (`+5`, `+2 mult`, `x2 mult`) in the item's colour, the points/mult readouts jump; then the total counts up
   fast and **snaps** to the exact number; screen shake grows with the total. Let players speed it up
   (`queue:update(dt, 2)`) once they've seen it.
4. **Reordering matters** when order changes scoring: use `ui.slots`, and re-run the scoring preview after `on_reorder`.
5. **Tooltips from data:** `.tip` comes from the same table the effect uses (name + effect text), never written twice.
6. **Screens:** one scene per screen (`run_start`, `round`, `scoring` overlay, `shop`, `game_over`), switched with
   `scene.go`; pass state in `params`, never through globals.
7. **Readable at 480x270:** 8 px font (bitmap font from Aseprite for the final look), numbers in strong colours
   (points blue, mult red, money yellow - pick once and keep), panels darker than the background, max ~4 colours
   per element, everything aligned to whole pixels.
8. **Settings screen** is part of every game's menu: display mode, scaling, volume, back - built with `ui.button` and
   `settings.lua` (see the love2d template's main.lua for the working pattern). Labels show the current value.
9. **Disable what's off-screen:** set `enabled = false` on buttons of inactive screens (scene `enter` is a good place).

## Prove it
- Logic of springs/queues: `luajit __PI_HOME__/.pi/agent/skills/game-ui/anim_test.lua` (10 checks).
- Each screen gets a scripted self-test like the demo's: drive a virtual mouse frame by frame (`ui.update(dt, mx, my)`,
  `ui.mousepressed`, `scene.mousepressed`), assert state (order after a drag, totals, current scene), and capture
  screenshots at the key moments; then look at them (directly, or with `look` images=[...]).
- Use a fixed `dt = 1/60` in self-test mode so scripts are frame-exact.
