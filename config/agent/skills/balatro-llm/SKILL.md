---
name: balatro-llm
description: Start Balatro and let the model THIS session is running on play it live, at 4x game speed, through BalatroLLM (github.com/coder/balatrollm) + the BalatroBot mod. Use when Freddy says "play Balatro", "drive Balatro", "let <model> play Balatro", "balatrollm", "BalatroBench run", or asks how the current model plays Balatro; also to check on or stop a running game.
---

# Balatro with the current session's model

Everything is installed; do not reinstall.

- BalatroLLM clone + venv: `__PI_HOME__/balatrollm` (runs and logs land there)
- Launcher: `__PI_HOME__/balatrollm-runner/play_balatro.py`
- Balatro: `F:/SteamLibrary/steamapps/common/Balatro` with lovely (`winmm.dll`), Steamodded and the BalatroBot mod in `%APPDATA%/Balatro/Mods`

Always run the launcher with the balatrollm venv Python:

```bash
PY=__PI_HOME__/balatrollm/.venv/Scripts/python.exe
R=__PI_HOME__/balatrollm-runner/play_balatro.py
```

## 1. Work out your own model id

The game must be played by the model this session runs on. Pass it with `--model`:

| Harness | What to pass |
|---|---|
| Pi | `auto` works (read from the live Pi session). Or `provider/model` as Pi shows it, e.g. `claude-cli/claude-opus-5-5`, `openrouter/deepseek/deepseek-v4.1-flash-1017`, `inkling/inkling2-mini-113k` |
| Claude Code CLI / Claude Desktop (Code) | your model id from your system prompt, e.g. `claude-opus-5-5` (runs on the Claude subscription through Pi's claude-cli shim, started automatically). `auto` also works in Claude Code |
| opencode | the `provider/model` of this session, e.g. `openrouter/moonshotai/kimi-k3.1-pro`, `llamaswap/qwen3.6-iq3-local` |
| Hermes | the model of this session, e.g. `openrouter/deepseek/deepseek-v4.1-flash-1017`, `llamaswap/qwen3.8-flash-next-gyro-s` |

Check before launching (prints endpoint, never the key):

```bash
$PY $R resolve --model <id or auto>
$PY $R models          # every model the launcher can map
```

Keys and endpoints are read from Pi `models.json`/`auth.json`, opencode `opencode.jsonc`/`auth.json`, Hermes `config.yaml`/`.env`. Any `vendor/model` slug falls back to OpenRouter. Not usable: `antigravity-acp/*` (ACP, no OpenAI API); say so and offer an OpenRouter Gemini instead. Local models (`127.0.0.1:8080`) need llama-swap running; the launcher stops with a clear message if the endpoint is down. The model must support tool calling.

## 2. Start a game (4x speed by default)

```bash
$PY $R play --model <id>                       # 4x speed, full animations, audio on, seed AAAAAAA, Red deck, White stake
$PY $R play --model <id> --seed 7LB2WVPK --deck BLUE --stake RED
$PY $R play --model <id> --views               # live overlay: http://localhost:12345/views/task.html and /views/responses.html
$PY $R play --model <id> --dry-run             # show the task only
```

Other speeds only if Freddy asks: `--speed 1` (real time), `--speed 2|3`, `--fast` (BalatroBot fast mode, 10x). `--mute` turns audio off.

`play` returns immediately: it launches balatrollm in the background, which opens the Balatro window and plays until the run is won or lost (at 4x the pace is set mostly by how fast the model answers). Do not wait in a loop for it; tell Freddy it is running.

## 3. Check on it / stop it

```bash
$PY $R status    # RUNNING or finished, log tail, latest run files
$PY $R stop      # ends balatrollm and the Balatro it started
```

Only one game at a time (port 12346). Run artifacts: `__PI_HOME__/balatrollm/runs/v*/<strategy>/<vendor>/<model>/<time>_<deck>_<stake>_<seed>/` with `run.log`, `responses.jsonl` (the model's reasoning per move), `gamestates.jsonl`, `stats.json`, `screenshots/`. To report how it went, read `stats.json` or the last lines of `responses.jsonl`.

## Troubleshooting

- `ERROR` right after `STARTED`: read `run.log` in the newest run folder; the LLM error is at the end.
- Claude models fail with a cache_control/ttl 400: the launcher strips balatrollm's cache markers for Claude runs (`run_balatrollm.py`); make sure play went through the launcher, not `balatrollm.exe` directly.
- "Balatro executable not found": set `BALATROBOT_LOVE_PATH` (Balatro.exe) and `BALATROBOT_LOVELY_PATH` (winmm.dll / version.dll). On Windows balatrobot uses LOVE_PATH, not BALATRO_PATH.
- Update: `cd __PI_HOME__/balatrollm && git pull && ~/.local/bin/uv.exe sync --no-dev` (Hermes' bundled `uv` does not run from Git Bash).
