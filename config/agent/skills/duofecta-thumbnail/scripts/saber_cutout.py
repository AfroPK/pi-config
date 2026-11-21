"""Cut a person out of a black background while keeping the white "saber"
outline (and optionally its colored outer glow).

Usage:
  python -I saber_cutout.py IMG [IMG ...] [--out DIR] [--mode core|glow]
         [--glow-color RRGGBB] [--barrier 190] [--glow-radius 45]

Writes <name>_core.png / <name>_glow.png (RGBA) plus <name>_..._preview.jpg
(composited over a checkerboard) into --out.
"""
import argparse
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def L(mask):
    return Image.fromarray((mask * 255).astype(np.uint8))


def cutout(src, out_dir, mode, glow_hex, barrier_min, glow_r, band=14):
    a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = a.shape
    mx, mn = a.max(axis=2), a.min(axis=2)

    # 1. Barrier = the bright white saber outline (all channels high). A 5px
    #    opening first drops thin lower-third lines/arcs so they can't act as walls.
    bimg = (L(mn > barrier_min).filter(ImageFilter.MinFilter(5))
            .filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MaxFilter(5)))

    # 2. Flood the person from the image centre; interior = that region plus the
    #    barrier (outline band, teeth/earbud highlights). Flooding from the centre
    #    instead of the frame edges means props that cut the outline where it
    #    meets the frame (mic arms) can't let the background leak in.
    sat = (mx > 80) & ((mx - mn) > 0.6 * mx)
    fill = bimg.copy()
    if fill.getpixel((W // 2, H // 2)) == 0:
        ImageDraw.floodfill(fill, (W // 2, H // 2), 128, thresh=0)
    # Keep only barrier pixels within --band px of the flooded body: thick bright
    # arcs/text attached to the outline extend further out and get dropped.
    body = np.asarray(fill) == 128
    near_body = np.asarray(L(body).filter(ImageFilter.MaxFilter(2 * band + 1))) > 0
    interior = body | ((np.asarray(fill) != 0) & near_body)

    # Opening strips thin stray lines/text touching the outline, then keep only
    # the blob connected to the image centre (the person)
    m = L(interior).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
    cx, cy = W // 2, H // 2
    if m.getpixel((cx, cy)) == 0:
        raise SystemExit(f"{src}: image centre is not inside the outline; "
                         "the outline may have a gap (try a lower --barrier)")
    ImageDraw.floodfill(m, (cx, cy), 77, thresh=0)
    interior = np.asarray(m) == 77

    inner_a = np.asarray(L(interior).filter(ImageFilter.MinFilter(3))
                         .filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255

    if mode == "core":
        # keep only the white core plus its thin whitish anti-aliased fringe
        fringe = np.asarray(L(interior).filter(ImageFilter.MaxFilter(5))) > 0
        glow_a = np.where(fringe, np.clip((mn - 120) / 100.0, 0, 1), 0)
    else:
        # Cleanup pass: background arcs/lines/text are thin and brighter than
        # the smooth glow under them, so outside the person take the per-channel
        # min of the pixel and its median-filtered neighbourhood. Smooth glow is
        # unchanged (median ~= pixel); thin bright strokes drop to the glow level.
        med = np.asarray(Image.fromarray(a.astype(np.uint8))
                         .filter(ImageFilter.MedianFilter(9))).astype(np.float32)
        ext = ~(np.asarray(L(interior).filter(ImageFilter.MaxFilter(5))) > 0)
        a = np.where(ext[..., None], np.minimum(a, med), a)
        mx = a.max(axis=2)
        near = np.asarray(L(interior).filter(ImageFilter.BoxBlur(glow_r))) > 0
        very_near = np.asarray(L(interior).filter(ImageFilter.BoxBlur(6))) > 0
        if glow_hex:
            g = np.array([int(glow_hex[i:i + 2], 16) for i in (0, 2, 4)], np.float32)
        else:
            # auto: median color of saturated pixels in the ring around the outline
            ring = near & ~very_near & sat
            g = np.median(a[ring], axis=0) if ring.sum() > 50 else np.array([255, 255, 255], np.float32)
        gn = g / max(np.linalg.norm(g), 1e-3)
        proj = a @ gn
        resid = np.linalg.norm(a - proj[..., None] * gn[None, None, :], axis=2)
        glow_a = np.clip((mx - 14.0) / (255 - 14.0), 0, 1)
        hue_ok = np.clip(1.0 - (resid - 0.25 * proj) / 40.0, 0, 1)
        glow_a = np.where(very_near, glow_a, glow_a * hue_ok)
        glow_a = np.where(near, glow_a, 0)
        fade = np.asarray(L(near).filter(ImageFilter.GaussianBlur(8))).astype(np.float32) / 255
        glow_a *= fade
        # second cleanup: smooth leftover arc ridges out of the glow alpha
        ga_med = np.asarray(L(glow_a).filter(ImageFilter.MedianFilter(7))).astype(np.float32) / 255
        glow_a = np.where(ext, np.minimum(glow_a, ga_med + 0.02), glow_a)

    alpha = np.maximum(inner_a, glow_a)
    # un-premultiply edge/glow pixels (they were composited over black)
    safe = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.where(inner_a[..., None] > 0.99, a, np.clip(a / safe, 0, 255))

    base = os.path.splitext(os.path.basename(src))[0]
    out = os.path.join(out_dir, f"{base}_{mode}.png")
    Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), "RGBA").save(out)

    chk = np.indices((H, W)).sum(0) // 16 % 2
    bg = np.where(chk[..., None] == 1, [90, 90, 90], [60, 60, 60]).astype(np.float32)
    comp = rgb * alpha[..., None] + bg * (1 - alpha[..., None])
    prev = os.path.join(out_dir, f"{base}_{mode}_preview.jpg")
    Image.fromarray(comp.astype(np.uint8)).save(prev, quality=85)
    print(f"{out}\n{prev}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("images", nargs="+")
    p.add_argument("--out", default=os.path.expanduser(r"~\Pictures\saber-cutouts"))
    p.add_argument("--mode", choices=["core", "glow"], default="core")
    p.add_argument("--glow-color", default=None, help="RRGGBB; auto-detected if omitted")
    p.add_argument("--barrier", type=int, default=190)
    p.add_argument("--glow-radius", type=int, default=45)
    args = p.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for img in args.images:
        cutout(img, args.out, args.mode, args.glow_color, args.barrier, args.glow_radius)

