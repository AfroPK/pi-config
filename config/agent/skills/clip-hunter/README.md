# clip-hunter

An agent skill that finds the best moments in long streams and cuts them into 9:16 Shorts with subtitles. It runs on your own machine.

Agents can't watch five hours of video, so clip-hunter narrows the search with cheap signals, and the agent only looks at the moments that matter:

1. **Chat spikes.** Where the audience reacted (YouTube live chat replay, or a Twitch export).
2. **Loudness.** Compared with the last few minutes of the same stream, so a loud streamer doesn't flag everything.
3. **Captions.** Exclamations like "no way" or "oh my god".
4. **Whisper.** Only on shortlisted windows, not the whole stream.
5. **Frames.** One image sheet per moment, which the agent reads.
6. **[Earshot](https://github.com/Leonxlnx/earshot), optional.** Sound-event hints such as laughter or screams.

For URLs it downloads audio and chat first, then only the video sections it needs.

## Install

```bash
npx skills add levizdev/clip-hunter -g -a claude-code
```

Or copy `skills/clip-hunter` into `~/.claude/skills/`.

Requirements:

```bash
brew install ffmpeg yt-dlp          # macOS. ffmpeg must include libass
pip install mlx-whisper             # Apple Silicon
pip install faster-whisper          # any other machine
```

Optional sound hints:

```bash
uv tool install "earshot[mcp] @ git+https://github.com/Leonxlnx/earshot"
earshot doctor --fetch              # downloads about 1.1 GB of models
```

Check the setup with `python3 skills/clip-hunter/scripts/clip.py doctor`.

## Use

Ask your agent in plain words:

> Find the 5 best moments in this stream and make Shorts with subtitles: <link>. I have the streamer's permission.

Or run the steps yourself:

```bash
CLIP=skills/clip-hunter/scripts/clip.py
python3 $CLIP fetch "https://youtube.com/watch?v=..." --dir work
python3 $CLIP scan --dir work --top 20
python3 $CLIP transcribe --dir work --ids c01,c02,c03
python3 $CLIP frames --dir work --ids c01,c02,c03
python3 $CLIP cut --dir work --id c01 --hook "No way"
```

## Use it responsibly

Only clip footage you have the right to use: your own, a streamer's clipping program, or written permission.

clip-hunter deliberately has no speed-up, pitch-shift or mirror options. They don't grant any rights, and YouTube's [Shorts update of October 1, 2026](https://support.google.com/youtube/blog/470890423/prioritizing-original-content-on-shorts?hl=en) reduces the reach of re-uploads that add nothing of your own and asks creators to bring their own voice rather than minor technical edits. Add something of your own instead: `cut --commentary voice.m4a` lowers the original audio under your voice.

Downloading is subject to each platform's terms. You are responsible for how you use this tool.

## Test

```bash
python3 tests/e2e.py
```

Generates a 12-minute fake stream with three real moments and two decoys, then checks the ranking and the final clips. It needs only ffmpeg.

## Limits

- It finds moments the audience reacted to, so quiet, clever moments can be missed.
- Without chat, ranking relies on audio and is much noisier.
- Facecam position is set manually for each stream.

## Licence

[MIT](LICENSE). Built on [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org), [Whisper](https://github.com/openai/whisper) and optionally [Earshot](https://github.com/Leonxlnx/earshot).
