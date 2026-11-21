# External services and dependencies

Copying `~/.pi` is only one part of reproducing this setup. This page lists every external dependency identified during the audit and the boundary between captured configuration and separately installed software.

## Dependency matrix

| Integration | Captured here | Must be installed/configured separately |
|---|---|---|
| OpenRouter | Scoped models, defaults, GLM routing override | Pi `/login` or `OPENROUTER_API_KEY`; funded/available models |
| OmniRoute | Endpoint and model aliases in `models.json` | `omniroute` 3.8.54, its router/application configuration, upstream provider credentials |
| llama-swap / llama.cpp | Exact config and launcher flags | Windows binaries, ROCm runtime/builds, GGUF models on `E:\models` |
| Strata | Engine JSON and standalone launcher | `C:\Strata` engine, Python environment, packs/profiles/MTP data, models and ROCm libraries |
| Kaggle | Provider definitions and update/check scripts | Running notebooks, fresh tunnel URLs/keys, notebook source from the separate Kaggle project |
| Context7 MCP | npx declaration | Network/npm access |
| Firecrawl MCP | Pinned server package and LAN endpoint | Firecrawl server at `192.168.0.117:3002`, or change to another server |
| Aseprite MCP | Python command/environment | Aseprite, `aseprite-mcp` checkout and venv |
| DaVinci Resolve MCP | Python bridge command | DaVinci Resolve, CursorBridge, local bridge source and venv |
| Retro Diffusion MCP | Remote URL/header template | Account and `RD_API_KEY` |
| Browse MCP | Executable invocation | `browse.exe` installed at `~/.local/bin/browse.exe` |
| `look` | Extension and model defaults | Chrome, global Playwright 1.65.1, OpenRouter key or custom vision server |
| `browser_*` | Extension and lockfile | `npx playwright install chromium`; optional browser logins |
| `generate_image` | ComfyUI workflow and post-processing | ComfyUI, SDXL/VAE/LoRA assets, ImageMagick, Python environment |
| Claude CLI provider | Provider extension and shim | Official Claude Code login, Hermes, DirectSDK plugin and its venv |
| pi-loop | Launcher and `pi-local/env` | Clone `https://github.com/AfroPK/pi-loop` to `~/pi-loop` |
| pi-durable | Launcher | Separate `~/pi-durable-agent` supervisor installation and `~/.pi-durable` state directory |
| agent-desktop | Skill and bash-guard integration | Global `agent-desktop` 1.3.1 and its own prerequisites |
| PDF skill | Scripts and `requirements.txt` | Recreate its venv and install PyMuPDF |
| Media skills | Prompts/scripts/configuration | FFmpeg, yt-dlp, DaVinci, provider accounts and tool-specific dependencies as documented per skill |

## Local models

The original machine is a Ryzen 7 5700X with 32 GB RAM and an AMD RX 6750 XT 12 GB (RDNA2/gfx1031). The captured flags are tuned for that hardware; do not assume they fit another GPU.

### Detailed installation source

Start with the captured skill:

- [Local LLM/ROCm setup guide](../config/agent/skills/local-llm-rocm/SKILL.md)
- [Model notes](../config/agent/skills/local-llm-rocm/models.md)
- [Prompt/model templates](../config/agent/skills/local-llm-rocm/templates.md)

Those documents contain the working ROCm build recipe, measured performance tuning, context/VRAM checks, llama-swap setup, and provider wiring. They are more authoritative for the engine build than this overview.

### Required model artifacts

The following paths are referenced by `config/machine/llama-swap/config.yaml` and the standalone launchers:

```text
E:\models\ukisai\Swift-1.5-Qwen3.8-27B-GSQ-RCO-GGUF\
  Swift-1.5-Qwen3.8-27B-GSQ-RCO-IQ2_XS-mtp.gguf

E:\models\unsloth\Qwen3.6-35B-A3B-GGUF\
  Qwen3.6-35B-A3B-UD-IQ3_XXS.gguf

C:\Strata\models\gyro-Gyro-S\
  Qwen3.8-Flash-Next-Gyro-S-TQ1_0.gguf

C:\Strata\models\
  mmproj-Qwen3.8-Flash-Next-BF16.gguf
```

Also required are the Strata pack, expert profile, MTP runtime data, tokenizer, ROCm library directory, and tuning file referenced by `strata-gyro-gyro-s.json`. These large/generated artifacts are not in this repository.

### llama.cpp builds

The captured llama-swap macros reference:

```text
~\llama-mainline\b11869-rocm-th102\llama-server.exe
~\llama-mainline\b12445-rocm-th102\llama-server.exe
```

Use the ROCm build process in the local-LLM skill. The original setup combines specific llama.cpp builds with TheRock/ROCm runtime DLLs for gfx1031. A generic CUDA, Vulkan, or CPU binary will not reproduce the measured behavior.

### Install the captured machine files

After reviewing paths:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -SkipPackages -SkipPiInstall -IncludeMachineIntegrations
```

This installs configuration only; it does not download models or engines. Then start llama-swap with `C:\llama-swap\start-llama-swap.bat` or invoke a Pi launcher that calls `ensure-server.ps1`.

Expected model aliases:

| Purpose | llama-swap ID | Pi model |
|---|---|---|
| Plan/review/default local | `qwen3.8-flash-next-gyro-gyro-s` | `strata/qwen3.8-flash-next-gyro-s` |
| Execute | `qwen3.6-iq3-local` | `qwen36iq3/qwen3.6-iq3-local` |
| Fallback planner | `swift27-xs-64k` | `qwen27/swift27-xs-64k` |

Port 8080 is deliberately dedicated to llama-swap on the original PC. Do not bind another service there.

## pi-loop

The captured launcher expects:

```powershell
git clone https://github.com/AfroPK/pi-loop.git "$HOME\pi-loop"
```

Original audited revision: `1749f69`. To reproduce exactly, inspect and check out that commit if it remains available:

```powershell
git -C "$HOME\pi-loop" checkout 1749f69
```

Follow that repository's own Windows setup instructions. Its role assignments are captured in `config/machine/pi-local/env`, installed to `~/.config/pi-local/env` when `-IncludeMachineIntegrations` is used. Updating pi-loop may require reviewing changes rather than remaining on the audited revision.

## pi-durable-agent

`pi-durable.cmd` expects `~/pi-durable-agent/supervise.ts`; task state belongs in `~/.pi-durable/tasks`. The source directory had no Git metadata during the audit, so this repository cannot name an upstream or exact revision. Copy/install that separate supervisor before using `pi-durable`; the wrapper alone is not the durable implementation.

The hub and laptop-link scripts similarly depend on separately installed local services. Read each script before running it on a new machine.

## Aseprite MCP

Original checkout:

- Source: `https://github.com/diivi/aseprite-mcp`
- Audited revision: `a89b205`
- Expected path: `~/aseprite-mcp`
- Python module: `aseprite_mcp`
- Interpreter: `~/aseprite-mcp/.venv/Scripts/python.exe`

Clone the source, follow its dependencies/install instructions, and create the venv at that path. Install Aseprite itself and ensure its MCP integration is enabled as required by the upstream project. The captured [pixel-art skill](../config/agent/skills/pixel-art/SKILL.md) documents how Pi uses it.

## DaVinci Resolve MCP

The bridge is expected at `~/davinci-mcp-bridge`, with:

```text
venv/Scripts/python.exe
src/resolve_mcp_bridge.py
```

The original directory had no Git metadata, so its source is not reproducible from this snapshot alone. Install/copy that bridge, create its venv, then follow [the captured DaVinci skill](../config/agent/skills/davinci-resolve/SKILL.md). DaVinci Resolve and CursorBridge must be running and connected for Resolve tools to work.

## Firecrawl and web search

The captured MCP and web-search fallback use a self-hosted Firecrawl instance at `192.168.0.117:3002`. This is a LAN service, not software embedded in the backup. Options:

1. Run Firecrawl at that address, or update `FIRECRAWL_API_URL`/`PI_FIRECRAWL_URL` to the replacement server.
2. Configure a hosted Firecrawl service and its credential using environment interpolation.
3. Configure Google Custom Search for the local `web_search` extension; it then takes precedence over Firecrawl for that tool.

The direct `firecrawl_search`/`firecrawl_scrape` MCP tools still need the MCP server's configured endpoint even when Google backs the custom `web_search` tool.

## Vision and browser tools

### `look`

Install Chrome and the captured global Playwright version (the standard installer handles Playwright). Authenticate OpenRouter through Pi. Defaults:

```text
PI_VISION_URL=https://openrouter.ai/api/v1/chat/completions
PI_VISION_MODEL=anthropic/claude-haiku-5.5
```

Both can be overridden. Using a hosted vision model may incur cost and sends the supplied image/screenshot to that provider.

### `browser`

Run this once after restoring packages:

```powershell
cd "$HOME\.pi\agent\extensions\browser"
npx playwright install chromium
```

Enable tools per session with `/browser on`. The persistent `.profile` directory is intentionally excluded because it contains cookies and login state.

## ComfyUI image generation

Original ComfyUI checkout:

- Source: `https://github.com/Comfy-Org/ComfyUI`
- Audited revision: `38457751`
- Default directory: `D:/AIWorkspace/ComfyUI` (override with `PI_COMFY_DIR`)
- Server: `127.0.0.1:8188`

Required workflow assets:

- `sd_xl_base_1.0.safetensors` checkpoint;
- `pixel-art-xl.safetensors` LoRA;
- `sdxl_vae_fp16_fix.safetensors` VAE.

Install them in ComfyUI's normal model directories. Install ImageMagick at the path in `imagegen.ts`, or update the `MAGICK` constant. The extension unloads llama-swap's model to free VRAM, runs ComfyUI, and frees/restores GPU capacity afterward. It also references llama-swap at `PI_SWAP_URL` (default `http://127.0.0.1:8080`). Test this manually; no image generation or GPU process control is run by repository tests.

## Claude CLI / Hermes

The `claude-cli` extension expects:

- official `claude` CLI, signed in (`claude auth status`);
- Hermes at `%LOCALAPPDATA%\hermes`;
- Hermes's Python venv;
- plugin `plugins/claude-subscription-directsdk` with its DirectSDK client and local `config.yaml` settings.

Overrides supported by the extension:

```text
PI_CLAUDE_CLI_PYTHON
CLAUDE_CLI_DIRECTSDK_DIR
PI_CLAUDE_CLI_PORT
```

The local shim listens on port 18766 by default and exits after idle. No prompts, replies, credentials, or shim logs are captured. After a Hermes plugin update, run `/claude-cli restart` in Pi.

## Other global tools

`config/global-npm-packages.json` records the complete global npm set at capture time: Pi, agent-desktop, Playwright, OmniRoute, Photoshop MCP, vidLens MCP, Supergateway, OpenCode, Hyperframes, TypeScript/ts-node, yarn, and npm. Only Pi, agent-desktop, and Playwright are installed by default. Use `-InstallAllGlobalPackages` if the wider toolset is wanted.

Python, LOVE/LuaJIT, FFmpeg, yt-dlp, cloud/remote CLIs, and media/application dependencies remain subject to each included skill's own instructions. Installing every optional tool is not necessary for core Pi operation.
