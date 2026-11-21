"""DuoFecta reaction thumbnail: Freddy + Kelly saber cutouts over a zoomed,
Gaussian-blurred thumbnail of the video being reacted to.

Usage:
  python -I duofecta_thumb.py SHOT1 SHOT2 YOUTUBE_URL [--out FILE]
         [--zoom Z] [--focus X,Y] [--blur S] [--bg IMAGE]
         [--left-x PX] [--right-x PX] [--no-autoswap]

SHOT1/SHOT2: the two host screenshots (red glow = Freddy = left,
blue glow = Kelly = right; order is fixed automatically from the glow).
Writes a 1280x720 JPG plus <name>_layers/ (bg.png, cutouts, source thumb).
All style numbers live in style.json next to this script.
"""
import argparse, io, json, os, re, sys, urllib.parse, urllib.request
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
STYLE = json.load(open(os.path.join(HERE, "style.json")))
W, H = STYLE["size"]


# ---------------------------------------------------------------- background
def video_id(url):
    m = re.search(r"(?:v=|youtu\.be/|shorts/|live/|embed/)([A-Za-z0-9_-]{11})", url)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return url
    raise SystemExit(f"can't find a YouTube video id in {url!r}")


def fetch_thumb(vid):
    for name in ("maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg"):
        try:
            data = urllib.request.urlopen(f"https://i.ytimg.com/vi/{vid}/{name}", timeout=20).read()
        except Exception:
            continue
        im = Image.open(io.BytesIO(data)).convert("RGB")
        if name != "maxresdefault.jpg":
            im = crop_letterbox(im)
        return im, name
    raise SystemExit(f"no thumbnail found for video {vid}")


def video_title(vid):
    """'Artist - Title' from YouTube oEmbed (no key), cleaned like Freddy's
    file names: drop (Official Video), [MV], | extras, hashtags."""
    try:
        q = urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}", safe="")
        d = json.loads(urllib.request.urlopen(f"https://www.youtube.com/oembed?url={q}&format=json", timeout=20).read())
    except Exception:
        return None
    t = d.get("title", "")
    t = re.split(r"\s[|｜]\s", t)[0]
    t = re.sub(r"\s*[\(\[][^\)\]]*(official|video|audio|lyric|visuali[sz]er|mv|m/v|4k|hd)[^\)\]]*[\)\]]", "", t, flags=re.I)
    t = re.sub(r"\s*#\S+", "", t).strip(" -")
    t = re.sub(r"\s+M/?V$", "", t, flags=re.I)
    t = re.sub(r"['\u2018\u2019\"]([^'\u2018\u2019\"]+)['\u2018\u2019\"]", r"\1", t)
    if " - " not in t and d.get("author_name"):
        author = re.sub(r"\s*(VEVO|- Topic|Official)$", "", d["author_name"], flags=re.I).strip()
        t = f"{author} - {t}"
    return t or None


def safe_name(s):
    return re.sub(r'[<>:"/\\|?*‪‬]', "", s).strip(" .")[:120] or "thumbnail"


def crop_letterbox(im):
    """sd/hq thumbnails are 4:3 with black bars around a 16:9 picture."""
    a = np.asarray(im).astype(np.int16).max(axis=2)
    rows = np.nonzero(a.mean(axis=1) > 12)[0]
    return im.crop((0, rows[0], im.width, rows[-1] + 1)) if len(rows) else im


def find_focus(im):
    """Source point the zoom centres on: centroid of the biggest faces (YuNet),
    else the frame centre."""
    try:
        import cv2
        model = os.path.join(HERE, "..", "models", "face_detection_yunet_2023mar.onnx")
        bgr = np.ascontiguousarray(np.asarray(im)[..., ::-1])
        det = cv2.FaceDetectorYN.create(model, "", (im.width, im.height), 0.75)
        _, faces = det.detect(bgr)
    except Exception as e:  # cv2 missing / model missing
        print(f"face detection unavailable ({e}); using centre", file=sys.stderr)
        faces = None
    if faces is not None and len(faces):
        faces = sorted(faces.tolist(), key=lambda r: -r[2] * r[3])
        big = faces[0][2] * faces[0][3]
        keep = [f for f in faces if f[2] * f[3] >= 0.35 * big]  # same-size faces = a group
        cx = np.mean([f[0] + f[2] / 2 for f in keep]) / im.width
        cy = np.mean([f[1] + f[3] / 2 for f in keep]) / im.height
        fh = np.mean([f[3] for f in keep]) * W / im.width  # face height at 1280 wide
        return cx, cy, f"{len(keep)} face(s)", (len(keep), fh)
    return 0.5, 0.5, "centre (no face)", None


def auto_zoom(faces):
    """Single face/duo: zoom so the face is ~face_target_px tall (clamped);
    groups (3+ faces) and no-face images use the default zoom."""
    z = STYLE["zoom"]
    if faces and faces[0] <= 2:
        lo, hi = STYLE["zoom_range"]
        z = min(max(STYLE["face_target_px"] / faces[1], lo), hi)
    return round(z, 2)


def make_background(src, zoom, focus, blur, face=True):
    """Fill the frame with the source scaled `zoom` x, put the focus point at
    STYLE.focus_target (clamped so no edge shows), then Gaussian blur."""
    src = src.resize((W, round(W * src.height / src.width)), Image.LANCZOS)
    if src.height < H:
        src = src.resize((round(H * src.width / src.height), H), Image.LANCZOS)
    sw, sh = round(src.width * zoom), round(src.height * zoom)
    big = src.resize((sw, sh), Image.LANCZOS)
    tx, ty = STYLE["focus_target"] if face else (0.5, 0.5)
    x0 = min(max(focus[0] * sw - tx * W, 0), sw - W)
    y0 = min(max(focus[1] * sh - ty * H, 0), sh - H)
    bg = big.crop((round(x0), round(y0), round(x0) + W, round(y0) + H))
    return bg.filter(ImageFilter.GaussianBlur(blur))


# ---------------------------------------------------------------- hosts
def cutout(shot, workdir):
    import saber_cutout
    saber_cutout.cutout(shot, workdir, "core", None, 190, 45)
    base = os.path.splitext(os.path.basename(shot))[0]
    return Image.open(os.path.join(workdir, f"{base}_core.png")).convert("RGBA")


def glow_side(shot):
    """'left' if the glow is red/pink (Freddy), 'right' if blue (Kelly), None if unclear."""
    a = np.asarray(Image.open(shot).convert("RGB")).astype(np.int16)
    r, b = a[..., 0], a[..., 2]
    sat = (a.max(axis=2) > 90) & (a.max(axis=2) - a.min(axis=2) > 60)
    red, blue = (sat & (r > b + 40)).sum(), (sat & (b > r + 40)).sum()
    if max(red, blue) < 500 or min(red, blue) > 0.5 * max(red, blue):
        return None
    return "left" if red > blue else "right"


def place(canvas, cut, centre_x):
    """Screenshot height -> frame height, top at y=0, screenshot centre at centre_x."""
    s = H * STYLE["host_height_mult"] / cut.height
    c = cut.resize((round(cut.width * s), round(cut.height * s)), Image.LANCZOS)
    x = round(centre_x - c.width / 2)
    l = max(0, -x)
    c = c.crop((l, 0, min(c.width, W - x), min(c.height, H)))
    canvas.alpha_composite(c, (x + l, 0))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("shot1"); p.add_argument("shot2"); p.add_argument("url")
    p.add_argument("--out", help="full output path (default: STYLE out_dir / '<Artist> - <Title>.png')")
    p.add_argument("--name", help="file name without extension, e.g. 'Skepta - Pandoras Box'")
    p.add_argument("--zoom", type=float, default=None, help="default: auto from face size")
    p.add_argument("--focus", help="X,Y (0-1) point of the source thumbnail to centre on")
    p.add_argument("--blur", type=float, default=STYLE["blur_sigma"])
    p.add_argument("--bg", help="background image to use instead of the YouTube thumbnail")
    p.add_argument("--left-x", type=float, default=STYLE["left_centre_x"])
    p.add_argument("--right-x", type=float, default=STYLE["right_centre_x"])
    p.add_argument("--no-autoswap", action="store_true")
    a = p.parse_args()

    left, right = a.shot1, a.shot2
    if not a.no_autoswap:
        s1, s2 = glow_side(left), glow_side(right)
        if s1 == "right" or s2 == "left":
            left, right = right, left
            print("note: swapped the shots (blue-glow host goes on the right)", file=sys.stderr)

    vid = None if a.bg else video_id(a.url)
    src, thumb_from = (Image.open(a.bg).convert("RGB"), a.bg) if a.bg else fetch_thumb(vid)
    if a.focus:
        fx, fy = map(float, a.focus.split(",")); focus_from = "manual"; faces = None
    else:
        fx, fy, focus_from, faces = find_focus(src)
    if a.zoom is None:
        a.zoom = auto_zoom(faces if not a.focus else None)

    if a.out:
        out = os.path.abspath(a.out)
    else:
        name = a.name or (video_title(vid) if vid else None) or f"duofecta_{vid or 'thumb'}"
        out_dir = os.path.expanduser(STYLE["out_dir"])
        out = os.path.join(out_dir, safe_name(name) + ".png")
        n = 2
        while os.path.exists(out):  # never overwrite a finished thumbnail
            out = os.path.join(out_dir, f"{safe_name(name)} ({n}).png"); n += 1
    os.makedirs(os.path.dirname(out), exist_ok=True)
    stem = os.path.splitext(os.path.basename(out))[0]
    layers = os.path.join(os.path.dirname(out), "_layers", stem)
    os.makedirs(layers, exist_ok=True)

    bg = make_background(src, a.zoom, (fx, fy), a.blur, face=focus_from != "centre (no face)")
    L, R = cutout(left, layers), cutout(right, layers)
    canvas = bg.convert("RGBA")
    place(canvas, R, a.right_x)   # Kelly behind
    place(canvas, L, a.left_x)    # Freddy in front
    if out.lower().endswith((".jpg", ".jpeg")):
        canvas.convert("RGB").save(out, quality=95)
    else:
        canvas.convert("RGB").save(out)
    bg.save(os.path.join(layers, "bg.png"))
    src.save(os.path.join(layers, "source_thumb.jpg"), quality=95)
    print(json.dumps({"out": out, "layers": layers, "thumb": thumb_from, "left": left, "right": right,
                      "focus": [round(fx, 3), round(fy, 3)], "focus_from": focus_from,
                      "zoom": a.zoom, "blur": a.blur}, indent=1))


if __name__ == "__main__":
    main()
