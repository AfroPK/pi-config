---
name: duofecta-thumbnail
description: Make a DuoFecta YouTube reaction thumbnail (1280x720) in the channel's exact style - Freddy + Kelly saber cutouts over a zoomed, Gaussian-blurred (10) copy of the reacted-to video's thumbnail. Use when Freddy gives two host screenshots and a YouTube link and asks for a thumbnail.
---

# DuoFecta thumbnail

Inputs: **two host screenshots** (Freddy = red glow, Kelly = blue glow; any
order) and **the YouTube link of the video being reacted to**. Nothing else is
needed. The script pulls that video's thumbnail itself.

Scripts live next to this file: `~/.pi/agent/skills/duofecta-thumbnail/scripts/`.

## Steps

1. Get the two screenshot paths. If Freddy says "the screenshots" with no
   path, list the newest with `ls -t ~/Pictures/Screenshots | head` and
   confirm which two.
2. Run:

   ```bash
   python -I ~/.pi/agent/skills/duofecta-thumbnail/scripts/duofecta_thumb.py "SHOT1.png" "SHOT2.png" "YOUTUBE_URL"
   ```

   - Output: `D:\DuoFecta\Thumbnail\<Artist> - <Title>.png` (Freddy's thumbnail
     folder; name taken from the video's YouTube title, e.g. `LISA - Tarantino.png`;
     never overwrites, adds ` (2)`). `--name "Skepta - Pandoras Box"` to set the
     name, `--out FILE` for a full path. Layers for hand edits (blurred `bg.png`,
     both `<shot>_core.png` cutouts, the source thumbnail) go to
     `D:\DuoFecta\Thumbnail\_layers\<name>\`.
   - It prints JSON: which shot went left/right, the focus point, zoom, blur.
3. Check the cutouts (numeric + vision checker from the saber-cutout skill):

   ```bash
   python -I ~/.pi/agent/skills/saber-cutout/scripts/check_cutout.py "<layers>/<shot1>_core.png" "<layers>/<shot2>_core.png"
   ```

   If your model can view images, also `read` the output PNG and check:
   - Freddy (locs) is on the left and in front, Kelly (cap) on the right.
   - The artist's face (or main subject) of the background shows in the gap
     between the two heads, not hidden behind a head. If not, re-run with
     `--focus` / `--zoom` (below).
4. Report the PNG path, the `_layers` folder and the checker verdict.

## Style (measured from 10+ published thumbnails, see scripts/style.json)

| element | rule |
|---|---|
| canvas | 1280x720, no text, no logo |
| background | the reacted-to video's YouTube thumbnail (maxres), zoomed ~2.2x, Gaussian blur sigma 10 px (`--blur`) |
| zoom centre | the subject's face (YuNet face detection; several same-size faces = their centroid) placed at (50%, 42%) of the frame; no face → plain centre zoom |
| zoom amount | 1-2 faces: zoom so the face is ~200 px tall, clamped 1.9-3.2x; groups / no face: 2.2x |
| hosts | saber-cutout **core** mode (white saber line + thin tinted fringe, outer glow removed) |
| host size | each screenshot scaled so its full height = 720, top at y=0 |
| host x | screenshot centre at x≈350 (Freddy) and x≈900 (Kelly) |
| layering | background → Kelly → Freddy (Freddy in front) |

## Tweaks

- `--focus X,Y`: point of the source thumbnail (0-1) to centre on, e.g.
  `--focus 0.62,0.3` when face detection picked the wrong person or missed an
  animated face.
- `--zoom Z`: 1.9-3.2 typical; higher = tighter on the face.
- `--left-x PX` / `--right-x PX`: move a host (screenshot centre x). Published
  range: Freddy 345-385, Kelly 865-956.
- `--bg IMAGE`: use another image (e.g. a video frame) instead of the YouTube
  thumbnail; the URL argument is then ignored (pass any text).
- `--no-autoswap`: keep the given order even if the glow colours say otherwise.

## Troubleshooting

- "image centre is not inside the outline": the outline has a gap or the
  person isn't centred in the screenshot. Ask Freddy for a re-crop.
- Leftover arcs/text in a cutout: see the saber-cutout skill's
  Troubleshooting (e.g. `--barrier 210`). The thumbnail script uses the
  defaults, so after a custom cutout, composite it by hand over the `_layers` bg.png.
- Screenshots must be raw OBS frames (host on black, white outline +
  red/blue glow), one host each.
- maxres thumbnails don't exist for some videos; the script falls back to
  sd/hq and crops their letterbox bars.
- Needs numpy + Pillow; face detection needs `opencv-python-headless` 5.x and
  `models/face_detection_yunet_2023mar.onnx`. Without cv2 it centre-zooms and
  says so on stderr.
