"""Check saber cutout PNGs without needing a vision-capable agent model.

Usage:
  python -I check_cutout.py PNG [PNG ...] [--no-vlm] [--model ID]

Per PNG prints numeric alpha checks, then (unless --no-vlm) asks a vision
model about the matching _preview.jpg: OpenRouter google/gemma-4-26b-a4b-it
(key from ~/.pi/agent/auth.json, ~2 s, ~$0.04 per 1000 images), falling back
to the HomeLab Gemma 4 E2B (http://192.168.0.117:8095) if OpenRouter fails.
Exit 0 = all PASS, 1 = something looks wrong.
"""
import argparse
import base64
import json
import os
import re
import sys
import urllib.request

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it"
HOMELAB_URL = "http://192.168.0.117:8095/v1/chat/completions"
# Benchmarked 2026-11-02 on 11 good/bad previews x3 runs. Plain "VERDICT: PASS|FAIL"
# prompts made every cheap model pass everything; two yes/no questions work.
PROMPT = (
    "This image is a background-removal cutout of a podcast host. The diagonal dark-gray stripe pattern means "
    "TRANSPARENT. A thin white/colored glow line hugging the person's silhouette is intended. Look carefully and answer:\n"
    "1. CUT: Is part of the person sliced off by a straight horizontal or vertical edge, or is a big part of the "
    "head/body missing? yes/no\n"
    "2. JUNK: Apart from the person (and microphone gear attached to them), is there ANYTHING on the stripes: text, "
    "thin lines or arcs, solid black blocks? yes/no\n"
    "Reply with exactly two lines: 'CUT: yes|no - reason' and 'JUNK: yes|no - reason'."
)


def numeric(png):
    a = np.asarray(Image.open(png).convert("RGBA"))[:, :, 3] > 127
    H, W = a.shape
    problems = []
    cover = a.mean()
    if not a[H // 2, W // 2]:
        problems.append("image centre is transparent (person missing?)")
    if cover < 0.05:
        problems.append(f"only {cover:.1%} opaque (person mostly missing)")
    if cover > 0.85:
        problems.append(f"{cover:.1%} opaque (background not removed)")
    # Opaque pixels on the left/right/top edges usually mean background leaked in.
    # The bottom edge is normal (body continues out of frame).
    for name, edge in (("left", a[:, 0]), ("right", a[:, -1]), ("top", a[0, :])):
        if edge.mean() > 0.25:
            problems.append(f"{edge.mean():.0%} of the {name} edge is opaque (background leak?)")
    print(f"  opaque {cover:.1%}, centre {'opaque' if a[H // 2, W // 2] else 'TRANSPARENT'}")
    for p in problems:
        print(f"  WARN {p}")
    return not problems


def ask(url, body, headers):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=90) as r:
        return (json.load(r)["choices"][0]["message"]["content"] or "").strip()


def vlm(preview, model):
    img = base64.b64encode(open(preview, "rb").read()).decode()
    msgs = [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}},
        {"type": "text", "text": PROMPT}]}]
    text, src = "", ""
    try:
        key = json.load(open(os.path.expanduser("~/.pi/agent/auth.json")))["openrouter"]["key"]
        text = ask(OPENROUTER_URL, {"model": model, "messages": msgs, "max_tokens": 300, "temperature": 0},
                   {"Authorization": f"Bearer {key}"})
        src = model
    except Exception as e:
        print(f"  OpenRouter failed ({e}); trying HomeLab VLM")
    if "CUT:" not in text.upper():
        text = ask(HOMELAB_URL, {"messages": msgs, "max_tokens": 300, "temperature": 0,
                                 "chat_template_kwargs": {"enable_thinking": False}}, {})
        src = "homelab-gemma-e2b"
    print(f"  VLM ({src}): " + text.replace("\n", "\n       "))
    u = text.upper()
    if "CUT:" not in u:
        raise ValueError("VLM reply had no CUT:/JUNK: lines")
    return not re.search(r"(CUT|JUNK):\W*YES", u)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("pngs", nargs="+")
    p.add_argument("--no-vlm", action="store_true")
    p.add_argument("--model", default=OPENROUTER_MODEL, help="OpenRouter vision model id")
    args = p.parse_args()
    ok = True
    for png in args.pngs:
        print(png)
        good = numeric(png)
        preview = os.path.splitext(png)[0] + "_preview.jpg"
        if not args.no_vlm and os.path.exists(preview):
            try:
                good = vlm(preview, args.model) and good
            except Exception as e:  # no VLM reachable: numeric checks still count
                print(f"  VLM unavailable ({e}); numeric checks only")
        print("  PASS" if good else "  FAIL")
        ok = ok and good
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
