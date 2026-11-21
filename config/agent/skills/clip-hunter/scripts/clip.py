#!/usr/bin/env python3
"""clip-hunter: find the moments worth clipping in a long stream, then cut them.

Standard library only. External programs: ffmpeg, ffprobe, yt-dlp (for URLs).
Optional: mlx-whisper or faster-whisper (speech), earshot (sound-event hints).

Pipeline:  doctor -> fetch -> scan -> transcribe -> frames -> [earshot] -> cut
Every step reads and writes one working folder (--dir).
"""
from __future__ import annotations

import argparse
import bisect
import collections
import glob
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys

REACTION = re.compile(
    r"(\blu+l+\b|\bkekw?\b|omegalul|\blma+o+\b|\brofl\b|\bwtf\b|\bomg\b|\bno way\b|\bclip\b|\bclip it\b|"
    r"\bpog\w*\b|\bbruh+\b|\bholy\b|\bhaha+\b|\bahah+\w*|ахах+\w*|хаха+\w*|\bлол\b|\bкек\w*|\bор+у*\b|"
    r"\bжесть\b|\bклип\w*|\bчто\s*за\b|😂|🤣|💀|😱|🔥)",
    re.I,
)
EXCLAIM = re.compile(
    r"(\bno way\b|\boh my god\b|\bwhat the\b|\bholy\b|\blet'?s go\b|\bare you kidding\b|\bi can'?t believe\b|"
    r"\bwow\b|\bwhat\?|\bнифига\b|\bничего себе\b|\bда ладно\b|\bблин\b|\bчто\s+за\b|\bкак\s+так\b|\bпогнали\b)",
    re.I,
)
MLX_REPOS = {"large-v3-turbo": "mlx-community/whisper-large-v3-turbo"}
DEFAULT_QUERIES = ["people laughing loudly", "a person screaming in surprise", "a loud explosion in a video game"]


# ---------------------------------------------------------------------------------------- helpers
def die(msg):
    print(f"clip-hunter: error: {msg}", file=sys.stderr)
    sys.exit(1)


def run(cmd, cwd=None, capture=True):
    r = subprocess.run(cmd, cwd=cwd, text=True, capture_output=capture)
    if r.returncode != 0:
        tail = (r.stderr or "")[-1500:] if capture else ""
        die(f"{cmd[0]} failed (exit {r.returncode})\n{tail}")
    return r


def need(tool):
    if not shutil.which(tool):
        die(f"{tool} not found on PATH. Run: clip.py doctor")


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def probe(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
             "-of", "json", path])
    d = json.loads(r.stdout)
    out = {"duration": float(d.get("format", {}).get("duration") or 0)}
    for s in d.get("streams", []):
        if s.get("codec_type") == "video" and "width" not in out:
            out.update(width=s["width"], height=s["height"])
    return out


def source(wd):
    s = read_json(os.path.join(wd, "source.json"))
    if not s:
        die(f"no source.json in {wd}. Run fetch first.")
    return s


def candidates(wd):
    c = read_json(os.path.join(wd, "candidates.json"))
    if not c:
        die(f"no candidates.json in {wd}. Run scan first.")
    return c


def pick(cands, ids):
    if not ids:
        return cands
    wanted = set(ids.split(","))
    found = [c for c in cands if c["id"] in wanted]
    missing = wanted - {c["id"] for c in found}
    if missing:
        die(f"unknown candidate id(s): {', '.join(sorted(missing))}")
    return found


def ytdlp_auth(src):
    return ["--cookies-from-browser", src["cookies_from_browser"]] if src.get("cookies_from_browser") else []


def section(src, start, end, height, out, accurate):
    """Write [start, end] of a remote source to `out` without downloading the whole stream."""
    cmd = ["yt-dlp", "--no-playlist", "--force-overwrites", "--download-sections", f"*{start:.2f}-{end:.2f}",
           "-f", f"bv*[height<={height}]+ba/b[height<={height}]/b", "--merge-output-format", "mp4", "-o", out]
    if accurate:
        cmd.append("--force-keyframes-at-cuts")
    run(cmd + ytdlp_auth(src) + [src["url"]])
    if not os.path.exists(out):
        die(f"yt-dlp did not produce {out}")


# ---------------------------------------------------------------------------------------- parsers
def load_chat(path):
    """Return sorted [(seconds, text)]. Reads yt-dlp live_chat JSONL, TwitchDownloader JSON, or [{t, text}]."""
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    out = []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = None
    if isinstance(data, dict) and "comments" in data:
        for c in data["comments"]:
            msg = c.get("message", {})
            out.append((float(c["content_offset_seconds"]), msg.get("body", "") if isinstance(msg, dict) else str(msg)))
    elif isinstance(data, list):
        for c in data:
            out.append((float(c.get("t", c.get("time", 0))), str(c.get("text", c.get("message", "")))))
    else:
        for line in raw.splitlines():
            line = line.strip()
            if line:
                try:
                    out.extend(_ytchat_line(json.loads(line)))
                except (json.JSONDecodeError, ValueError, TypeError, KeyError):
                    continue
    return sorted((t, m) for t, m in out if t >= 0)


def _ytchat_line(d):
    act = d.get("replayChatItemAction")
    if not act:
        return []
    t = int(act["videoOffsetTimeMsec"]) / 1000
    res = []
    for a in act.get("actions", []):
        item = a.get("addChatItemAction", {}).get("item", {})
        rend = item.get("liveChatTextMessageRenderer") or item.get("liveChatPaidMessageRenderer")
        if not rend:
            continue
        parts = []
        for run_ in rend.get("message", {}).get("runs", []):
            if "text" in run_:
                parts.append(run_["text"])
            elif "emoji" in run_:
                shortcuts = run_["emoji"].get("shortcuts") or [run_["emoji"].get("emojiId", "")]
                parts.append(shortcuts[0])
        res.append((t, " ".join(parts)))
    return res


def _spread(text, start, end):
    words = text.split()
    if not words:
        return []
    step = max(end - start, 0.05) / len(words)
    return [{"w": w, "s": round(start + i * step, 3), "e": round(start + (i + 1) * step, 3)} for i, w in enumerate(words)]


def load_captions(path):
    """Return sorted [{start, end, text, words:[{w,s,e}]}] from json3, vtt or srt."""
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    return _json3(raw) if path.endswith(".json3") or raw.lstrip().startswith("{") else _cues(raw)


def _json3(raw):
    segs = []
    for ev in json.loads(raw).get("events", []):
        if "segs" not in ev:
            continue
        start = ev.get("tStartMs", 0) / 1000
        dur = ev.get("dDurationMs", 0) / 1000
        pieces = [s for s in ev["segs"] if s.get("utf8", "").strip()]
        if not pieces:
            continue
        end = start + dur
        text = " ".join(s["utf8"].strip() for s in pieces)
        if len(pieces) == 1:
            words = _spread(text, start, end)
        else:
            times = [start + s.get("tOffsetMs", 0) / 1000 for s in pieces] + [end]
            words = [{"w": s["utf8"].strip(), "s": round(times[i], 3), "e": round(times[i + 1], 3)}
                     for i, s in enumerate(pieces)]
        segs.append({"start": start, "end": end, "text": text, "words": words})
    return sorted(segs, key=lambda s: s["start"])


def _stamp(s):
    p = s.replace(",", ".").split(":")
    return sum(float(x) * 60 ** i for i, x in enumerate(reversed(p)))


def _cues(raw):
    segs, last = [], None
    pat = re.compile(r"((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)")
    for block in re.split(r"\n\s*\n", raw.replace("\r", "")):
        lines = block.strip().split("\n")
        idx = next((i for i, x in enumerate(lines) if pat.search(x)), None)
        if idx is None:
            continue
        m = pat.search(lines[idx])
        texts = [re.sub(r"<[^>]+>", "", x).strip() for x in lines[idx + 1:]]
        texts = [x for x in texts if x]
        if not texts or texts[-1] == last:  # auto captions repeat the previous line
            continue
        last = texts[-1]
        start, end = _stamp(m.group(1)), _stamp(m.group(2))
        segs.append({"start": start, "end": end, "text": last, "words": _spread(last, start, end)})
    return segs


def loudness(path):
    """RMS level in dB for every second of audio."""
    af = ("aresample=16000,asetnsamples=n=16000:p=0,astats=metadata=1:reset=1,"
          "ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-")
    r = run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-vn", "-ac", "1", "-ar", "16000",
             "-af", af, "-f", "null", "-"])
    out = []
    for m in re.finditer(r"RMS_level=(\S+)", r.stdout):
        try:
            v = float(m.group(1))
        except ValueError:
            v = -70.0
        out.append(max(v, -70.0) if not math.isinf(v) else -70.0)
    return out


# ---------------------------------------------------------------------------------------- scoring
def rolling_z(xs, win=600, floor=1.0):
    """Robust z-score of each value against the median of the surrounding `win` seconds."""
    n, half = len(xs), win // 2
    window, meds, left, right = [], [0.0] * n, 0, 0
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        while right < hi:
            bisect.insort(window, xs[right])
            right += 1
        while left < lo:
            del window[bisect.bisect_left(window, xs[left])]
            left += 1
        meds[i] = window[len(window) // 2]
    res = [x - m for x, m in zip(xs, meds)]
    scale = max(1.4826 * statistics.median(abs(r) for r in res), floor) if res else floor
    return [r / scale for r in res]


def moving(xs, width, mode="mean"):
    prefix = [0.0]
    for x in xs:
        prefix.append(prefix[-1] + x)
    half, n, out = width // 2, len(xs), []
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        total = prefix[hi] - prefix[lo]
        out.append(total if mode == "sum" else total / (hi - lo))
    return out


def snap(start, end, segs, max_len):
    if segs:
        inside = [s for s in segs if s["start"] <= start < s["end"]]
        if inside:
            start = inside[0]["start"]
        near = [s for s in segs if s["start"] < end < s["end"] and s["end"] - end <= 4]
        if near:
            end = near[0]["end"]
    return start, min(end, start + max_len)


def write_transcript_txt(wd, segs):
    with open(os.path.join(wd, "transcript.txt"), "w", encoding="utf-8") as f:
        for s in segs:
            f.write(f"[{hms(s['start'])} | {s['start']:.1f}] {s['text']}\n")


def excerpt(segs, start, end):
    return " ".join(s["text"] for s in segs if s["end"] > start and s["start"] < end)


def confidence(chat_z, loud_z, has_chat):
    if has_chat:
        if chat_z >= 3 and loud_z >= 1.5:
            return "high"
        return "medium" if chat_z >= 3 else "low"
    return "medium" if loud_z >= 3 else "low"


def find_file(wd, patterns):
    for p in patterns:
        hits = sorted(glob.glob(os.path.join(glob.escape(wd), p)))
        if hits:
            return hits[0]
    return None


def cmd_scan(a):
    wd = a.dir
    src = source(wd)
    audio = src["audio"]
    chat_path = a.chat or find_file(wd, ["*.live_chat.json", "chat.json", "chat.*"])
    cap_path = a.captions or find_file(wd, ["*.json3", "*.vtt", "*.srt"])
    db = loudness(audio)
    if not db:
        die("could not read any audio levels")
    n = len(db)
    loud_z = rolling_z(moving(db, 3), a.baseline, floor=1.5)

    chat = load_chat(chat_path) if chat_path else []
    has_chat = len(chat) >= 50
    counts = [0.0] * n
    by_sec = collections.defaultdict(list)
    for t, text in chat:
        i = int(t) - a.chat_lag
        if 0 <= i < n:
            counts[i] += 1 + (2 if REACTION.search(text) else 0)
            by_sec[i].append(text)
    chat_z = rolling_z([math.sqrt(x) for x in moving(counts, 8, "sum")], a.baseline) if has_chat else [0.0] * n

    segs = load_captions(cap_path) if cap_path else []
    text_hit = [0.0] * n
    for s in segs:
        if EXCLAIM.search(s["text"]):
            for i in range(int(s["start"]), min(int(s["end"]) + 1, n)):
                text_hit[i] = 3.0

    weights = [(0.6 if has_chat else 0.0), 0.3, (0.1 if segs else 0.0)]
    total = sum(weights)
    wc, wa, wt = (w / total for w in weights)
    raw = [wc * min(max(c, -2), 8) + wa * min(max(l, -2), 6) + wt * t for c, l, t in zip(chat_z, loud_z, text_hit)]
    score = moving(raw, 5)

    lo = a.start or 0
    hi = min(a.end or n, n)
    order = sorted((i for i in range(int(lo), int(hi)) if score[i] >= a.min_score), key=lambda i: -score[i])
    peaks = []
    for i in order:
        if all(abs(i - p) >= a.min_gap for p in peaks):
            peaks.append(i)
        if len(peaks) == a.top:
            break

    cands = []
    for rank, p in enumerate(peaks, 1):
        start, end = snap(max(0, p - a.pre), min(n, p + a.post), segs, a.max_len)
        msgs = [m for i in range(max(0, p - 8), min(n, p + 8)) for m in by_sec.get(i, [])]
        common = collections.Counter(m.strip().lower() for m in msgs if m.strip()).most_common(5)
        c = {"id": f"c{rank:02d}", "peak": p, "peak_hms": hms(p), "start": round(start, 2), "end": round(end, 2),
             "score": round(score[p], 2), "confidence": confidence(chat_z[p], loud_z[p], has_chat),
             "chat_z": round(chat_z[p], 2), "loudness_z": round(loud_z[p], 2), "chat_messages": len(msgs),
             "top_chat": common, "transcript": excerpt(segs, start, end)}
        cands.append(c)
    write_json(os.path.join(wd, "candidates.json"), cands)
    if segs:
        write_json(os.path.join(wd, "transcript.json"), segs)
        write_transcript_txt(wd, segs)

    warnings = []
    if not has_chat:
        warnings.append(f"Chat missing or too small ({len(chat)} messages): ranking uses audio only, so expect noise.")
    if not segs:
        warnings.append("No captions found: run transcribe for candidate windows.")
    lines = [f"# Candidates: {src.get('title', '')}", ""] + [f"> {w}" for w in warnings] + [""]
    for c in cands:
        lines += [f"## {c['id']}  {c['peak_hms']}  score {c['score']}  {c['confidence']}",
                  f"window {c['start']}-{c['end']}s; chat z {c['chat_z']}, loudness z {c['loudness_z']}, "
                  f"{c['chat_messages']} messages",
                  f"top chat: {c['top_chat']}", f"transcript: {c['transcript'] or '(none yet)'}", ""]
    with open(os.path.join(wd, "candidates.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(json.dumps({"seconds_scanned": n, "chat_messages": len(chat), "caption_segments": len(segs),
                      "candidates": len(cands), "warnings": warnings,
                      "file": os.path.join(wd, "candidates.md")}, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------------------- fetch
def cmd_fetch(a):
    os.makedirs(a.dir, exist_ok=True)
    wd = a.dir
    if os.path.exists(a.source):
        need("ffprobe")
        path = os.path.abspath(a.source)
        src = {"kind": "file", "path": path, "audio": path, "title": os.path.basename(path), **probe(path)}
    else:
        need("yt-dlp")
        auth = ["--cookies-from-browser", a.cookies_from_browser] if a.cookies_from_browser else []
        info = json.loads(run(["yt-dlp", "-J", "--no-playlist"] + auth + [a.source]).stdout)
        lang = a.lang or info.get("language") or "en"
        out = os.path.join(wd, "audio.%(ext)s")
        base = ["yt-dlp", "--no-playlist", "--ignore-errors", "--no-progress", "--force-overwrites", "-o", out]
        subprocess.run(base + ["-f", "ba[ext=m4a]/ba/b", "--write-subs", "--write-auto-subs",
                               "--sub-format", "json3/vtt/best", "--sub-langs", f"{lang}-orig,{lang}"]
                       + auth + [a.source], check=False)
        # Chat comes last: a long replay can take a while and may not exist at all.
        subprocess.run(base + ["--skip-download", "--write-subs", "--sub-langs", "live_chat"]
                       + auth + [a.source], check=False)
        media = [p for p in glob.glob(os.path.join(glob.escape(wd), "audio.*"))
                 if not p.endswith((".json", ".json3", ".vtt", ".srt", ".part"))]
        if not media:
            die("yt-dlp did not download any audio")
        src = {"kind": "url", "url": a.source, "audio": os.path.abspath(media[0]), "title": info.get("title", ""),
               "channel": info.get("channel") or info.get("uploader"), "duration": info.get("duration"),
               "license": info.get("license"), "lang": lang}
        if a.cookies_from_browser:
            src["cookies_from_browser"] = a.cookies_from_browser
    write_json(os.path.join(wd, "source.json"), src)
    print(json.dumps(src, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------------------- transcribe
def remote_whisper_words(media, url, lang):
    """Local patch (Freddy, 2026-11-20): transcribe on the HomeLab whisper server instead of the CPU.
    That server (faster-whisper-server 0.0.2) returns only segment timings, so each segment's words are spread
    over it in proportion to their length - close enough for 3-word caption chunks."""
    import tempfile
    import urllib.request
    import uuid
    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    tmp.close()
    try:
        run(["ffmpeg", "-y", "-v", "error", "-i", media, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", tmp.name])
        with open(tmp.name, "rb") as f:
            audio = f.read()
    finally:
        os.remove(tmp.name)
    fields = {"model": "whisper-1", "response_format": "verbose_json", "timestamp_granularities[]": "word"}
    if lang:
        fields["language"] = lang
    b = uuid.uuid4().hex
    body = b"".join(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode() for k, v in fields.items())
    body += (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.mp3\"\r\n"
             "Content-Type: audio/mpeg\r\n\r\n").encode() + audio + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        with urllib.request.urlopen(req, timeout=1800) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        die(f"HomeLab whisper ({url}) failed: {e}. Is the HomeLab up? (CLIP_WHISPER_URL=local uses the CPU instead)")
    if data.get("words"):
        return [(w["word"].strip(), w["start"], w["end"]) for w in data["words"] if w["word"].strip()]
    out = []
    for s in data.get("segments", []):
        words = s["text"].split()
        if not words:
            continue
        total = sum(len(w) + 1 for w in words)
        t = s["start"]
        for w in words:
            d = (s["end"] - s["start"]) * (len(w) + 1) / total
            out.append((w, t, t + d))
            t += d
    return out


def whisper_words(wav, model, lang):
    url = os.environ.get("CLIP_WHISPER_URL", "http://192.168.0.117:8020/v1/audio/transcriptions")
    if url.lower() != "local":
        return remote_whisper_words(wav, url, lang)
    try:
        import mlx_whisper
        repo = model if "/" in model else MLX_REPOS.get(model, f"mlx-community/whisper-{model}-mlx")
        r = mlx_whisper.transcribe(wav, path_or_hf_repo=repo, word_timestamps=True, language=lang)
        return [(w["word"].strip(), w["start"], w["end"]) for s in r["segments"] for w in s.get("words", [])]
    except ImportError:
        pass
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        die("no speech engine. Install one: pip install mlx-whisper (Apple Silicon) or pip install faster-whisper")
    segments, _ = WhisperModel(model, device="cpu", compute_type="int8").transcribe(
        wav, word_timestamps=True, language=lang)
    return [(w.word.strip(), w.start, w.end) for s in segments for w in (s.words or [])]


def cmd_transcribe(a):
    need("ffmpeg")
    wd, src = a.dir, source(a.dir)
    if a.full:
        lang = a.lang or src.get("lang")
        words = [{"w": w, "s": round(s, 3), "e": round(e, 3)} for w, s, e in whisper_words(src["audio"], a.model, lang)]
        segs = [{"start": g[0]["s"], "end": g[-1]["e"], "text": " ".join(x["w"] for x in g), "words": g}
                for g in chunks(words, max_words=14, max_chars=90)]
        write_json(os.path.join(wd, "transcript.json"), segs)
        write_transcript_txt(wd, segs)
        print(json.dumps({"transcript": os.path.join(wd, "transcript.txt"), "words": len(words)}))
        return
    cands = candidates(wd)
    tdir = os.path.join(wd, "transcripts")
    os.makedirs(tdir, exist_ok=True)
    done = []
    for c in pick(cands, a.ids):
        start, end = max(0, c["start"] - 3), c["end"] + 3
        wav = os.path.join(tdir, f"{c['id']}.wav")
        run(["ffmpeg", "-y", "-v", "error", "-ss", str(start), "-t", str(end - start), "-i", src["audio"],
             "-vn", "-ac", "1", "-ar", "16000", wav])
        words = [{"w": w, "s": round(s + start, 3), "e": round(e + start, 3)}
                 for w, s, e in whisper_words(wav, a.model, a.lang or src.get("lang"))]
        os.remove(wav)
        c["transcript"] = " ".join(w["w"] for w in words)
        write_json(os.path.join(tdir, f"{c['id']}.json"), words)
        done.append(c["id"])
    write_json(os.path.join(wd, "candidates.json"), cands)
    print(json.dumps({"transcribed": done}))


def words_for(wd, cid, start, end):
    words = read_json(os.path.join(wd, "transcripts", f"{cid}.json")) if cid else None
    if words is None:
        words = [w for s in read_json(os.path.join(wd, "transcript.json"), []) for w in s["words"]]
    out = []
    for w in words:
        if w["e"] <= start or w["s"] >= end:
            continue
        # drop caption artefacts: speaker-change marks (>>) and sound tags like [смех] / [music]
        text = re.sub(r">>|\[[^\]]*\]", "", w["w"]).strip()
        if text:
            out.append(dict(w, w=text))
    return out


# ---------------------------------------------------------------------------------------- frames, earshot
def cmd_frames(a):
    need("ffmpeg")
    wd, src = a.dir, source(a.dir)
    out_dir = os.path.join(wd, "frames")
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for c in pick(candidates(wd), a.ids):
        dur = c["end"] - c["start"]
        sheet = os.path.join(out_dir, f"{c['id']}.jpg")
        vf = f"fps={a.count}/{dur:.3f},scale=480:-2,tile={a.count // 2}x2"
        if src["kind"] == "file":
            inp = ["-ss", str(c["start"]), "-t", str(dur), "-i", src["path"]]
        else:
            proxy = os.path.join(out_dir, f"{c['id']}.proxy.mp4")
            section(src, c["start"], c["end"], 360, proxy, accurate=False)
            inp = ["-i", proxy]
        run(["ffmpeg", "-y", "-v", "error"] + inp + ["-vf", vf, "-frames:v", "1", "-q:v", "4", sheet])
        if src["kind"] != "file":
            os.remove(proxy)
        made.append(sheet)
    print(json.dumps({"sheets": made}, indent=2))


def cmd_earshot(a):
    need("earshot")
    need("ffmpeg")
    wd, src = a.dir, source(a.dir)
    cands = candidates(wd)
    adir = os.path.join(wd, "earshot")
    os.makedirs(adir, exist_ok=True)
    chosen = pick(cands, a.ids)
    for c in chosen:
        run(["ffmpeg", "-y", "-v", "error", "-ss", str(c["start"]), "-t", str(c["end"] - c["start"]),
             "-i", src["audio"], "-vn", "-ac", "2", "-ar", "48000", os.path.join(adir, f"{c['id']}.wav")])
    by_id = {c["id"]: c for c in chosen}
    for c in chosen:
        c["earshot"] = {}
    for q in (a.query or DEFAULT_QUERIES):
        res_file = os.path.join(adir, "result.json")
        run(["earshot", "rank", q, adir, "--out", res_file])
        for r in read_json(res_file)["results"]:
            cid = os.path.splitext(r["name"])[0]
            if cid in by_id:
                by_id[cid]["earshot"][q] = {"z": r["z"], "verdict": r["verdict"]}
    write_json(os.path.join(wd, "candidates.json"), cands)
    print(json.dumps({c["id"]: c["earshot"] for c in chosen}, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------------------- cut
def ass_time(t):
    t = max(t, 0)
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs % 360000 // 6000:02d}:{cs % 6000 // 100:02d}.{cs % 100:02d}"


def ass_text(s):
    return s.replace("\\", "").replace("{", "(").replace("}", ")").upper()


def chunks(words, max_words=3, max_chars=18):
    group = []
    for w in words:
        too_long = len(" ".join(x["w"] for x in group + [w])) > max_chars
        gap = bool(group) and w["s"] - group[-1]["e"] > 0.7
        if group and (len(group) >= max_words or too_long or gap):
            yield group
            group = []
        group.append(w)
    if group:
        yield group


def build_ass(words, clip_start, clip_len, hook, font):
    head = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
            "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
            "MarginL, MarginR, MarginV, Encoding\n"
            f"Style: Sub,{font},88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,7,0,2,60,60,520,1\n"
            f"Style: Hook,{font},70,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,18,0,8,80,80,170,1\n"
            "\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    ev = []
    if hook:
        ev.append(f"Dialogue: 1,{ass_time(0)},{ass_time(min(3.5, clip_len))},Hook,,0,0,0,,{ass_text(hook)}")
    # One caption on screen at a time: a group ends when the next one starts, even if the
    # caption source gives the last word a long end time (YouTube captions often do).
    groups = list(chunks(words))
    last_end = 0.0
    for gi, group in enumerate(groups):
        nxt = groups[gi + 1][0]["s"] if gi + 1 < len(groups) else None
        for i, w in enumerate(group):
            if i + 1 < len(group):
                end_abs = group[i + 1]["s"]
            else:
                end_abs = min(w["e"], w["s"] + 1.2)
                if nxt is not None:
                    end_abs = nxt if nxt - end_abs < 0.25 else min(end_abs, nxt)
            start = max(w["s"] - clip_start, last_end)
            end = end_abs - clip_start
            if end <= start or end <= 0 or start >= clip_len:
                continue
            last_end = end
            parts = [("{\\c&H0035D4FF&}" + ass_text(x["w"]) + "{\\c&H00FFFFFF&}") if j == i else ass_text(x["w"])
                     for j, x in enumerate(group)]
            ev.append(f"Dialogue: 0,{ass_time(start)},{ass_time(min(end, clip_len))},Sub,,0,0,0,," + " ".join(parts))
    return head + "\n".join(ev) + "\n"


def video_filter(layout, w, h, facecam, crop_x):
    if layout == "fit":
        return ("[0:v]split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
                "boxblur=30:2[bg2];[fg]scale=1080:-2[fg2];[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")
    scaled = lambda ht: round(w * ht / h / 2) * 2  # noqa: E731
    if layout == "split":
        if not facecam:
            die("--layout split needs --facecam x,y,w,h")
        x, y, cw, ch = [float(v) for v in facecam.split(",")]
        if max(x, y, cw, ch) <= 1:
            x, cw, y, ch = x * w, cw * w, y * h, ch * h
        gw = scaled(1280)
        gx = int((gw - 1080) * crop_x)
        return (f"[0:v]split=2[a][b];[a]crop={int(cw)}:{int(ch)}:{int(x)}:{int(y)},"
                "scale=1080:640:force_original_aspect_ratio=increase,crop=1080:640[top];"
                f"[b]scale={gw}:1280,crop=1080:1280:{gx}:0[bottom];[top][bottom]vstack=inputs=2,setsar=1[v]")
    gw = scaled(1920)
    if gw < 1080:
        die("source is narrower than 9:16; use --layout fit")
    return f"[0:v]scale={gw}:1920,crop=1080:1920:{int((gw - 1080) * crop_x)}:0,setsar=1[v]"


def cmd_cut(a):
    need("ffmpeg")
    wd, src = a.dir, source(a.dir)
    c = next((x for x in candidates(wd) if x["id"] == a.id), None) if a.id else None
    if a.id and not c:
        die(f"unknown candidate id: {a.id}")
    start = a.start if a.start is not None else (c or {}).get("start")
    end = a.end if a.end is not None else (c or {}).get("end")
    if start is None or end is None or end <= start:
        die("need --id, or valid --start and --end")
    dur = end - start
    name = a.name or a.id or f"clip_{int(start)}"
    out_dir = os.path.abspath(os.path.join(wd, "clips"))
    os.makedirs(out_dir, exist_ok=True)
    if src["kind"] == "file":
        inp = ["-ss", str(start), "-t", str(dur), "-i", src["path"]]
        info = probe(src["path"])
    else:
        raw = os.path.join(out_dir, f"{name}.raw.mp4")
        section(src, start, end, 1080, raw, accurate=True)
        inp = ["-i", raw]
        info = probe(raw)
    if "width" not in info:
        die("source has no video stream")

    graph = video_filter(a.layout, info["width"], info["height"], a.facecam, a.crop_x)
    vout = "[v]"
    words = [] if a.no_subs else words_for(wd, a.id, start, end)
    if words or a.hook:
        ass = f"{name}.ass"
        with open(os.path.join(out_dir, ass), "w", encoding="utf-8") as f:
            f.write(build_ass(words, start, dur, a.hook, a.font))
        graph += f";[v]ass={ass}[vs]"
        vout = "[vs]"

    extra = []
    norm = "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"
    if a.commentary:
        extra = ["-i", os.path.abspath(a.commentary)]
        fmt = "aresample=48000,aformat=channel_layouts=stereo"
        graph += (f";[1:a]{fmt},asplit=2[sc][vo];[0:a]{fmt}[game];"
                  "[game][sc]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=400[duck];"
                  f"[duck][vo]amix=inputs=2:duration=first:normalize=0,{norm}[a]")
    else:
        graph += f";[0:a]{norm}[a]"

    out = os.path.join(out_dir, f"{name}.mp4")
    run(["ffmpeg", "-y", "-v", "error"] + inp + extra +
        ["-filter_complex", graph, "-map", vout, "-map", "[a]", "-t", str(dur),
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], cwd=out_dir)
    if src["kind"] != "file" and not a.keep_raw:
        os.remove(raw)
    check = os.path.join(out_dir, f"{name}.check.jpg")
    run(["ffmpeg", "-y", "-v", "error", "-i", out, "-vf", f"fps=6/{dur:.3f},scale=270:-2,tile=6x1",
         "-frames:v", "1", "-q:v", "4", check])
    p = probe(out)
    print(json.dumps({"clip": out, "check_sheet": check, "width": p.get("width"), "height": p.get("height"),
                      "duration": round(p["duration"], 2), "subtitle_words": len(words),
                      "has_commentary": bool(a.commentary)}, indent=2))


# ---------------------------------------------------------------------------------------- doctor
def cmd_doctor(_):
    report = {t: bool(shutil.which(t)) for t in ("ffmpeg", "ffprobe", "yt-dlp")}
    report["libass (subtitles)"] = False
    if report["ffmpeg"]:
        filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
        report["libass (subtitles)"] = bool(re.search(r"\bass\b", filters))
    for mod in ("mlx_whisper", "faster_whisper"):
        try:
            __import__(mod)
            report[mod] = True
        except ImportError:
            report[mod] = False
    report["earshot (optional)"] = bool(shutil.which("earshot"))
    report["ready"] = all(report[k] for k in ("ffmpeg", "ffprobe", "libass (subtitles)"))
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["ready"] else 1)


def main():
    ap = argparse.ArgumentParser(prog="clip.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor").set_defaults(fn=cmd_doctor)

    def add(name, fn):
        p = sub.add_parser(name)
        p.add_argument("--dir", required=True, help="working folder for this stream")
        p.set_defaults(fn=fn)
        return p

    p = add("fetch", cmd_fetch)
    p.add_argument("source", help="URL or local file")
    p.add_argument("--lang", help="caption language, e.g. en or ru")
    p.add_argument("--cookies-from-browser", help="only for login-gated sources; use a separate browser profile")

    p = add("scan", cmd_scan)
    p.add_argument("--chat", help="chat file, if not fetched automatically")
    p.add_argument("--captions", help="captions file, if not fetched automatically")
    p.add_argument("--top", type=int, default=20)
    p.add_argument("--min-score", type=float, default=1.0)
    p.add_argument("--min-gap", type=int, default=90, help="minimum seconds between two peaks")
    p.add_argument("--pre", type=int, default=25, help="seconds kept before a peak")
    p.add_argument("--post", type=int, default=12, help="seconds kept after a peak")
    p.add_argument("--max-len", type=int, default=59)
    p.add_argument("--chat-lag", type=int, default=10, help="seconds chat trails the moment it reacts to")
    p.add_argument("--baseline", type=int, default=600, help="seconds of context for the local baseline")
    p.add_argument("--start", type=int, help="scan only from this second")
    p.add_argument("--end", type=int, help="scan only up to this second")

    p = add("transcribe", cmd_transcribe)
    p.add_argument("--ids", help="comma-separated candidate ids (default all)")
    p.add_argument("--full", action="store_true", help="transcribe the whole source (for podcasts and interviews)")
    p.add_argument("--model", default="large-v3-turbo")
    p.add_argument("--lang")

    p = add("frames", cmd_frames)
    p.add_argument("--ids", help="comma-separated candidate ids (default all)")
    p.add_argument("--count", type=int, default=8, help="frames per sheet (even number)")

    p = add("earshot", cmd_earshot)
    p.add_argument("--ids", help="comma-separated candidate ids (default all)")
    p.add_argument("--query", action="append", help="sound to look for; repeatable")

    p = add("cut", cmd_cut)
    p.add_argument("--id", help="candidate id")
    p.add_argument("--start", type=float, help="override start, in source seconds")
    p.add_argument("--end", type=float, help="override end, in source seconds")
    p.add_argument("--name")
    p.add_argument("--layout", choices=["crop", "split", "fit"], default="crop")
    p.add_argument("--facecam", help="x,y,w,h in pixels or 0-1 fractions, for --layout split")
    p.add_argument("--crop-x", type=float, default=0.5, help="horizontal crop position, 0-1")
    p.add_argument("--hook", help="headline for the first seconds")
    p.add_argument("--commentary", help="your voice track; the original audio ducks under it")
    p.add_argument("--no-subs", action="store_true")
    p.add_argument("--font", default="Arial")
    p.add_argument("--keep-raw", action="store_true")

    a = ap.parse_args()
    if getattr(a, "dir", None):
        a.dir = os.path.abspath(a.dir)
    a.fn(a)


if __name__ == "__main__":
    main()
