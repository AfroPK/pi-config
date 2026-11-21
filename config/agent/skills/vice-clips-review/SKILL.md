---
name: vice-clips-review
description: Run Freddy's Vice Clips GTA 6 clip factory from the PC - pull clips waiting for review, keep/drop them by number, send candidates to review early, read the schedule and the factory log, and explain the ntfy phone alerts. Use when Freddy says things like "pull the clips", "keep 1 3", "drop 2", "send the next batch now", "send the Kai clip", "what's scheduled", "is anything posting today", "how long until the next batch", "what does this alert mean", or mentions Vice Clips, vcreview, the clip factory, review batches or Content Rewards links.
---

# Vice Clips review

Freddy's clip factory runs on its own on the HomeLab server (`ssh homelab`, folder `~/gta-factory`). It records approved
GTA 6 streamers, harvests the most-viewed viewer-made Twitch clips, renders vertical clips, vetoes bad ones,
ranks the rest and sends the best to **review**. Nothing is ever posted unless Freddy keeps it. Kept clips are scheduled
through Zernio to YouTube, Instagram and TikTok (@vcclipsgg / "Vice Clips"), 3 a day at 11:00, 15:30 and 20:00 New York time.

Your job: run the review commands Freddy asks for, report the output plainly, and stay inside the rules below.

## The one tool

Every command goes through one script on the PC. It talks to the HomeLab over ssh (no password needed):

```
python __PI_HOME__/vice-clips/vcreview.py <command>
```

Use `python`, never `python3` (Windows). Always run it and show Freddy the real output. Never guess results.

| Freddy says | Run |
|---|---|
| "pull the clips" / "what's to review" | `vcreview.py pull`. It downloads the review clips into `__PI_HOME__/vice-clips/review/pending` as `01 ….mp4`, `02 ….mp4`, opens the folder and prints a numbered list. Show him the list. |
| "keep 1 3" / "I like 1 and 3" | `vcreview.py decide 1 3`. Keeps 1 and 3 and **drops every other clip from that pull**. This is the normal answer to a review. |
| "keep 2 but don't drop the others yet" | `vcreview.py keep 2` (only keeps; the others stay in review) |
| "drop 4" | `vcreview.py drop 4` |
| "drop all of them" | `vcreview.py decide` with no numbers (drops every clip from the last pull) |
| "what's scheduled" / "is anything posting today" | `vcreview.py list` (shows review, approved, scheduled with times, published with links) |
| "what's waiting" / "how good are the candidates" | `vcreview.py candidates` (ranked clips waiting for a review batch, best first, with their ids) |
| "send the next batch now" | `vcreview.py send`, then `vcreview.py pull` |
| "send all 4 now" / "send the best 3" | `vcreview.py send --top 4`, then `vcreview.py pull` |
| "send the Kai clip" | `vcreview.py candidates`, find the matching id, `vcreview.py send <id>`, then `vcreview.py pull` |
| "when is the next batch" / "will it send anything" / "why didn't it send" | `vcreview.py next`. Repeat its answer in plain words. **Don't work out batch times or the cap yourself.** |
| "is it working" / "what's it doing" | `vcreview.py status` and `vcreview.py log 30` |

Numbers always refer to the **last `pull`**. If Freddy gives numbers and you have not pulled in this conversation,
they still refer to the folder he is looking at (`review/pending/index.json`), so run `decide` directly and do not re-pull
first (a new pull renumbers the clips). If `decide` says a number is not valid, show him the error and ask.

## How the factory decides (so you can answer questions)

- **Rank** = vision model's viral score (1-10) + up to 2 for chat/audio excitement + up to 4 for Twitch viewer-clip views.
  Only clips with rank >= 7 (`min_rank`) go to review. Viewer-made Twitch clips usually rank 7-11; live cuts 4-7.
- **Review batches**: every 6 hours, at most **5 clips per rolling 24 h**. A phone alert "N new clips to review" comes
  with each batch. Candidates that are never sent expire after 24 h. `send` (no number) respects the cap.
  `send --top N` and `send <id>` ignore it, and those clips count toward the next 24 h, so the next batch can be smaller or empty.
- **When is the next batch?** Always run `vcreview.py next` and pass on what it says (which batches send nothing and why,
  the first one that can send, and when candidates expire). Batches run every 6 h, but a batch sends nothing while the cap is full.
  Never say "the next batch will send clips" from the 6-hour rhythm alone. After any keep, drop or send, if you mention the
  next batch at all, run `next` first.
- A log line `review batch: 0 of N candidates` does **not** mean nothing was good enough. Usually the daily cap was
  already used up (5 sent in the last 24 h, counting ones Freddy asked for early). Only say "nothing cleared 7.0"
  when `candidates` shows no clip at 7.0 or above.
- **Which source to trust**: `vcreview.py list` is authoritative for post times (posts can be rescheduled, so old
  `SCHEDULED` log lines may show superseded times). `candidates` is authoritative for what is waiting. The factory log is a
  history; read the latest lines and the notes in it, and don't add up old lines yourself when a command already shows the state.
  Factory log times are **UTC**; posting slots in `list` carry their New York offset (-05:00).
- **Reading `status`**: the first line `approved: A  pending: P  rejected: R` counts **channels** (streamers), not clips.
  `pending` = streamers found by search that Freddy has not approved; they are never clipped. Each line after that is
  one approved streamer (`CAPTURING` = recording now, `idle` = not live or not playing GTA). The `clips: {...}` line counts
  clip states: `ready` = candidates, `review` = waiting for Freddy, `approved` = kept but not yet given a slot (the next
  10-minute run schedules them), `scheduled`, `published`.
- **Posting**: kept clips take the next free slot after the last scheduled post (3/day: 11:00, 15:30, 20:00 New York).
  `vcreview.py list` shows each clip's slot. Times in the factory are New York time (UTC-5 in winter).
- The factory pauses itself while Freddy's YouTube channel pipelines (African Folktales, Africa Explained, Deep Field Daily)
  are using the HomeLab. Log lines saying "channels busy" are normal.
- Log lines like "live but not gameplay right now" are normal: a streamer is on a webcam or a menu, and the factory looks again later.

## The phone alerts (ntfy topic vcclips-f8hsuohop8zf)

1. **"N new clips to review"**: run `pull`, Freddy watches the clips, then `decide <numbers>`.
2. **"Posted: <title>"**: the clip is live. The alert has the YouTube, Instagram and TikTok links and the campaign name.
   Freddy must **submit each link on Content Rewards (contentrewards.com/c/submissions → that campaign) within
   30 minutes**. That is how he gets paid. You cannot do this for him (no API, and it is his account). Remind him if he asks what to do.
3. **"Post failed: <title>"**: one or more platforms rejected the post. Run `vcreview.py log 50` and show the lines about that clip.
   Don't repost or reschedule on your own. Tell Freddy what failed and suggest he asks Claude, or checks the Zernio dashboard (zernio.com).

## Rules (do not break these)

- Only keep or drop what Freddy tells you to. Never keep a clip he did not name.
- Read-only by default: `pull`, `list`, `candidates`, `status` and `log` are always fine. `decide`, `keep`, `drop` and `send` only on his words.
- Do **not** ssh into the HomeLab to edit files, configs, `.env`, keys, `approved.json`, campaigns or timers. Do not
  change posting times, posts per day, `min_rank` or anything in `config.json`. Do not run `factory approve`, `campaign`,
  `post` or `reschedule.py`. If Freddy wants one of those changes, tell him it is a factory change and to ask Claude
  (or do it only if he explicitly tells you to and names the exact change).
- Never set `autopost`, `require_review false` or `GTA_UNATTENDED_POSTS`. Posting must always need his keep.
- Never run `pkill -f` over ssh (it kills your own ssh session). Never restart or stop services.
- Never type or print API keys, passwords or Content Rewards / Zernio logins.
- If a command fails (ssh error, timeout), show the error and stop. Don't improvise a workaround on the server.

## Example

Freddy: "pull them"
→ run `python __PI_HOME__/vice-clips/vcreview.py pull`, show the numbered list, say "watch them in review/pending, then tell me which to keep."

Freddy: "keep 1 3"
→ run `python __PI_HOME__/vice-clips/vcreview.py decide 1 3`, then say: "Kept 1 and 3 (titles), dropped the rest. They post
in the next free slots; run `vcreview.py list` to see the times. When the 'Posted' alert comes, submit the links on Content Rewards within 30 min."
