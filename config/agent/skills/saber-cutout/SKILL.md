---
name: saber-cutout
description: Remove the background from DuoFecta-style host frames (person with a white "saber" outline and colored glow on a black background with arcs/text) and export transparent PNGs. Use when Freddy gives a screenshot/frame path and asks to remove the background, cut someone out, keep the saber outline, or drop the outer glow.
---

# Saber cutout

Turns a frame like "host on black, white saber outline, red/blue outer glow,
thin gray arcs + lower-third text" into a transparent PNG.

**Default output = core only**: person + white saber core, colored outer glow
removed. This is what Freddy prefers. Use `--mode glow` only when he asks to
keep the glow.

Scripts live next to this file: `~/.pi/agent/skills/saber-cutout/scripts/`.
Run them with `python -I` (numpy + Pillow are installed).

## Steps

1. Get the image paths. Freddy gives them as file paths (often in
   `~/Pictures`, `~/Downloads` or a screenshot folder). If he says "the
   screenshot" with no path, list the newest images with
   `ls -t ~/Pictures/Screenshots | head` and confirm which one.
2. Cut out all images in one call:

   ```bash
   python -I ~/.pi/agent/skills/saber-cutout/scripts/saber_cutout.py IMG1 IMG2 ... [--mode core|glow] [--out DIR]
   ```

   - Output defaults to `__PI_HOME__\Pictures\saber-cutouts\`: one
     `<name>_core.png` (or `_glow.png`) plus `<name>_core_preview.jpg` over a
     dark checkerboard. The script prints both paths.
3. **Check every result before delivering** (you may not be able to see
   images, so use the checker):

   ```bash
   python -I ~/.pi/agent/skills/saber-cutout/scripts/check_cutout.py OUT1_core.png OUT2_core.png ...
   ```

   - Numeric checks: centre must be opaque, 5-85% opaque overall, and the
     left/right/top edges mostly transparent (opaque edges = background leak).
   - Then a vision model looks at each `_preview.jpg` and answers
     `CUT: yes/no` (person sliced off / missing parts) and `JUNK: yes/no`
     (leftover text, arcs, lines, black blocks). Default is OpenRouter
     `google/gemma-4-26b-a4b-it` (~2 s, ~$0.04 per 1000 images, key from
     `~/.pi/agent/auth.json`). If OpenRouter fails it falls back to the HomeLab
     Gemma E2B (weaker: it often calls the intended glow line "JUNK", so
     ignore that complaint from it); if both fail, the numeric checks still run. Override with
     `--model <openrouter id>`.
   - Exit 0 = all PASS. On FAIL, apply **Troubleshooting** and re-run. The
     VLM got about 9 of 10 test previews right: it reliably spots text, arcs,
     black blocks and a sliced-off head, but once in a while flags a clean
     cutout or misses a straight cut down the side. Trust a specific reason,
     and don't loop more than twice on one image. If your own model can view
     images, also read the previews with the `read` tool.
4. Rename the PNGs only if Freddy names the people/files (e.g. `host1`,
   `host2`): `mv OUT_core.png host1.png` (keep the same folder). Run the
   checker before renaming, since it finds the preview by name.
5. Report the final PNG paths and the folder
   `__PI_HOME__\Pictures\saber-cutouts\`, plus the checker verdict.

## How it works (for tuning)

- The bright white outline (all RGB > `--barrier`, default 190) acts as a wall,
  after a 5px opening strips thin lines/arcs so they can't act as walls.
  Flood-fill from the image centre marks the person (plus the outline band).
  A 9px morphological opening + "connected to image centre" step strips thin
  arcs/text touching the outline. Centre-flood (not edge-flood) means props
  like mic arms that break the outline at the frame edge don't leak background in.
- Glow mode: alpha from pixel brightness, un-premultiplied off black; far from
  the outline only pixels matching the glow hue survive (auto-detected, or
  `--glow-color RRGGBB`). `--glow-radius` (default 45) caps glow width.
- Glow-mode cleanup pass: outside the person, each pixel becomes
  min(pixel, 9px median), so thin bright arcs/lines/text drop to the smooth
  glow under them; then the glow alpha gets the same treatment (7px median)
  to flatten leftover ridges. Core mode is unaffected.

## Troubleshooting

- **"image centre is not inside the outline"** or the person is missing: the
  outline has a gap or is dimmer. Retry with `--barrier 160` (or lower).
- **Background arcs/lines survive**: raise `--barrier` (e.g. 210) so gray arcs
  stop acting as walls.
- Thick bright arcs touching the outline are handled by the band step: only
  barrier pixels within 14px of the flooded body are kept (`band` in `cutout()`).
- **Lower-third text inside the outline** (e.g. "LISA" over a sleeve) survives
  the cutout. Paint it out afterwards with a short Python script: find
  bright/red-tinted pixels in that corner, then blend a vertical interpolation
  of the rows above/below in under a feathered (dilate 9 + blur 3) text mask.
  Don't make it transparent.
- **Person isn't centered** (centre pixel lands on background): crop the image
  so the person covers the centre, or tell Freddy; the script assumes it.
- An ML background remover (fal.ai BiRefNet) was tested and did worse here
  (misses black clothing on black, grabs the arcs), so don't reach for one
  unless the outline approach fails outright.
