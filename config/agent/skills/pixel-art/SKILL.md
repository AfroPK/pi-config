---
name: pixel-art
description: Making game pixel art with the Aseprite MCP server and getting it into LOVE - palette, sizes for a 480x270 game, drawing with text rows, animation, 9-slice UI panels, bitmap fonts, export conventions and checks. Use whenever a task needs sprites, tiles, icons, UI art or animations.
---

# Pixel art with Aseprite -> LOVE

The `aseprite` MCP server (reach its tools through the `mcp` tool: `mcp({"search": "...", "server": "aseprite"})`,
then call them) runs Aseprite headless on `.aseprite` files. Read its built-in guide first:
`aseprite_animation_workflow_guide` (use_case "idle", "walk", ...).

## Fixed decisions (keep them for the whole game)
- **Palette:** one palette for every asset. Pick with `aseprite_list_palette_presets`, apply with
  `aseprite_apply_palette_preset`, and write the hex list into `assets/PALETTE.md`. Warm wood/earth tones plus 2-3
  bright accents suit a board game; never introduce a colour that isn't in the palette.
- **Sizes for the 480x270 virtual screen** (see the love2d skill), drawn at 1x, never scaled in Aseprite:
  | Asset | Size |
  |---|---|
  | seeds / small tokens | 6x6 to 8x8 |
  | board pits | 24x24 to 32x32 |
  | item / modifier icons | 24x24 |
  | cards or tall item frames | 32x44 to 48x64 |
  | characters / opponent portraits | 32x32 to 48x48 |
  | UI panels (9-slice source) | 12x12 or 16x16, border 4 |
  | bitmap font glyphs | 5x7 or 6x8 |
- **Outline and light:** 1px dark outline (darkest palette colour, not pure black), light from the top-left, 3-step
  shading ramp per material (shadow, base, highlight), at most 1-2 highlight pixels.

## Detailed art: the `generate_image` tool
Hand-placing pixels gives simple sprites. For detailed pieces (seeds, carved pits, item art, panels) use
`generate_image` (SDXL + pixel-art LoRA in ComfyUI). It handles the GPU itself: your model is unloaded during the
call and reloads on your next turn. Cost: ~1 min for the first image of a call, ~35 s per extra image, plus your
reload. So:
1. **Batch:** all related images in ONE call (all seed types, all pit variants). Don't call it in a loop.
2. **Prompt = subject only** (shape, material, colours, viewpoint, "on a flat solid background"); the house style is
   added for you. Pass the same `palette` (assets/palette.png) every time so all art shares one palette.
3. **Results per image:** `<name>.png` (1024 px, fake pixel art), `<name>_px.png` (real sprite at `pixel_size`, subject
   cut out to transparency and scaled to fill it), `<name>_px_preview.png` (8x, for looking), `<name>.json` (prompt +
   seed: reuse the seed to regenerate or vary). `keep_background: true` for tiles/backgrounds.
4. **Check before using:** view the preview (or `look` it). Typical misses: busy background around the subject
   (re-prompt "flat solid background, nothing else"), wrong colours (name them; pass a palette), a drop shadow left
   under the subject (erase it in cleanup). Regenerate at most twice, then clean up what you have.
5. **Clean up in Aseprite** (`aseprite_import_image_as_layer` the `_px` file): fix the outline and stray pixels with
   the read_rows/draw_rows loop, remove leftover shadow, then export as below. Keep the `.json` next to the art.

## Drawing loop
1. **Silhouette** with `aseprite_draw_rows` (rows of characters + a colour legend). Write the whole shape at once;
   keep it symmetric where it should be.
2. **Shade** by `aseprite_read_rows` -> change only the characters that must change -> `aseprite_draw_rows` again.
3. **Outline** with `aseprite_outline_cel` (or include it in draw_rows' `outline`).
4. **Check with text tools first:** `aseprite_lint_sprite`, `aseprite_get_bounds` (centred? touching the edge?),
   `aseprite_get_color_stats` (palette only?). Then look: `aseprite_view_sprite` if you can see images; otherwise
   export a PNG and call `look` with a concrete question ("is it a round green slime with a dark outline?").
5. Fix one thing at a time, re-check.

## Animation
- Idle: 2-6 frames, 1-2 px of movement (squash/stretch), loop seamlessly. Hop/capture effects: 4-8 frames.
- Build frames by copying the previous frame's rows and changing only what moves; keep the outline and size
  constant (`aseprite_compare_frames`, `aseprite_audit_animation` catch drift and jitter).
- Tag each animation (`idle`, `hop`, `capture`) and set frame durations in Aseprite, then mirror the fps in code.

## Export conventions (what the game code expects)
- Source files: `art/<name>.aseprite` (kept in the repo). Exports: `assets/<name>_<tag>.png`.
- One **horizontal strip per animation tag**, all frames the same width:
  `aseprite_export_spritesheet(filename="art/slime.aseprite", output_filename="assets/slime_idle.png",
  sheet_type="horizontal", tag_name="idle")`. Load with `sprite.strip("assets/slime_idle.png", 32, 8)`
  (love2d template, `src/lib/sprite.lua`). No JSON needed.
- Still images: `assets/<name>.png` at 1x. UI panels: `assets/panel_<style>.png` + border size in code
  (`sprite.nine(png, 4)`).
- **Bitmap font:** draw the glyphs in one row with a 1px column of a separator colour (one not used in glyphs)
  before the first glyph and between all glyphs - LOVE reads the separator from the top-left pixel. Export to
  `assets/font.png`, load with `love.graphics.newImageFont("assets/font.png", " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?+-x%")`
  (the glyph string must match the image exactly, in order).
- Never scale art in the export; the game's scaler does whole-number upscaling.

## Done means
The PNG exists at the expected path and size (`file assets/x.png` or `aseprite_get_sprite_info`), uses only palette
colours, loads in the game's self-test without errors, and you (or `look`) checked the in-game screenshot.
