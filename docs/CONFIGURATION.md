# Configuration reference

All paths below refer to the installed layout unless prefixed with `config/`, which refers to this repository.

## Core settings

Source: `config/agent/settings.json` → `~/.pi/agent/settings.json`.

| Setting | Captured value | Effect |
|---|---|---|
| `theme` | `dark` | Built-in dark UI theme; no custom theme files |
| `defaultProvider` | `openrouter` | Startup provider |
| `defaultModel` | `deepseek/deepseek-v4.1-flash-1017` | Startup cloud model |
| `defaultThinkingLevel` | `medium` | Startup reasoning level |
| `thinkingBudgets` | 1024 / 2048 / 4096 / 16384 | Minimal / low / medium / high token budgets |
| `compaction.enabled` | `true` | Automatic compaction |
| `compaction.reserveTokens` | 16384 | Default free-context reserve |
| `compaction.keepRecentTokens` | 6000 | Default unsummarized recent context |
| Swift compaction override | 10240 / 10000 | Reserve/recent tokens for `qwen27/swift27-xs-64k` |
| `shellPath` | Scoop Git Bash under the home directory | Shell used by Pi's bash tool; installer rewrites the home prefix |
| `packages` | 10 npm declarations | Pi-managed extensions/resources |
| `extensions` | `-builtin:mcp` | Disables built-in MCP because `pi-mcp-adapter` supplies `/mcp` |
| `skills` | `!**/.agents/skills/**` | Excludes nested `.agents` skill trees from discovery |
| `lastChangelogVersion` | `1.6.0` | UI changelog state |
| Extension changelog state | pi-mcp-adapter 7.0.1, pi-skillful 0.5.2 | Prevents already-seen changelogs from repeating |

### Scoped model cycle

`enabledModels` contains these entries in order:

1. `openrouter/deepseek/deepseek-v4.1-flash-1017`
2. `openrouter/moonshotai/kimi-k3.1-pro`
3. `openrouter/qwen/qwen3.8-flash`
4. `openrouter/z-ai/glm-5.3-flash`
5. `qwen3.8-flash-next-gyro-s` (local Strata)
6. `qwen3.6-iq3-local` (local executor)
7. `qwen27/swift27-xs-64k` (local fallback planner)
8. `claude-cli/claude-fable-5-2`
9. `claude-cli/claude-opus-5-5`
10. `claude-cli/claude-sonnet-5-5`
11. `claude-cli/claude-haiku-5-5`

The first seven are configured directly or through OpenRouter. The last four are registered by the local `claude-cli` extension and require its external dependencies.

## Model providers

Source: `config/agent/models.json`.

| Provider | Endpoint | Model(s) | Context/output | Credential |
|---|---|---|---|---|
| `openrouter` | Built-in OpenRouter | Scoped built-in models | Catalog-defined | Pi `/login` or `OPENROUTER_API_KEY` |
| `omnirouter` | `localhost:20128/v1` | Claude round-robin, Laguna, Gemini, Kimi, Jarvis, Ultron, Vision, combos | Endpoint-defined | `${OMNIROUTER_API_KEY}` |
| `strata` | `127.0.0.1:8080/v1` | `qwen3.8-flash-next-gyro-s`; text + image | 65,536 / 32,768 | dummy `local` |
| `qwen27` | `127.0.0.1:8080/v1` | `swift27-xs-64k`; text | 49,152 / 32,768 | dummy `local` |
| `qwen36iq3` | `127.0.0.1:8080/v1` | `qwen3.6-iq3-local`; text | 131,072 / 16,384 | dummy `local` |
| `kaggle` | Captured temporary Cloudflare tunnel | `qwen27-q6-mtp` | 131,072 / 16,384 | `${KAGGLE_API_KEY}` |
| `kaggle-strata` | Captured temporary Cloudflare tunnel | `gyro-s` | 65,536 / 16,384 | `${KAGGLE_STRATA_API_KEY}` |

The local model costs are set to zero. Compatibility settings include the exact reasoning format, token fields, chat-template arguments, thinking-level maps, and streaming behavior used by each endpoint. OpenRouter's GLM 5.3 Flash override requests FP8/BF16, price sorting, and fallbacks.

**Kaggle tunnel URLs are ephemeral.** Do not expect the captured URLs to remain valid. Run `kaggle-set` or `kaggle-strata-set` after each notebook restart.

## MCP configuration

Sources: `config/agent/mcp.json` and `mcp-adapter.json`.

| Server | Type/source | Setup requirement |
|---|---|---|
| `context7` | `npx -y @upstash/context7-mcp` | Node/npm network access |
| `firecrawl` | `npx -y firecrawl-mcp@3.30.0` | Self-hosted Firecrawl at the configured LAN URL; search/scrape exposed directly |
| `aseprite` | Local Python module in `~/aseprite-mcp` | Repository, Python venv, Aseprite |
| `davinci-resolve` | Local Python bridge in `~/davinci-mcp-bridge` | Bridge code, venv, DaVinci Resolve/CursorBridge |
| `retrodiffusion` | HTTPS MCP | `${RD_API_KEY}` |
| `browse` | `~/.local/bin/browse.exe mcp` | Browse executable |

The adapter limits output to 16,384 bytes, disables namespace proxy tools, exposes Firecrawl search/scrape directly with an allowlist, and lazy-starts DaVinci Resolve with `get_resolve_status` and `get_current_page` direct. Other tools follow the adapter's normal exposure rules.

OAuth state and MCP caches/logs are deliberately excluded.

## Pi packages

Declared in `settings.json`; exact installed dependency trees are locked in `config/agent/npm/package-lock.json`.

| Package | Captured version | Purpose |
|---|---:|---|
| `@juanibiapina/pi-plan` | 0.3.1 | Read-only plan mode |
| `pi-paster` | 0.2.3 | Turn pasted image paths into attachments |
| `pi-mcp-adapter` | 7.0.1 | MCP connection/lifecycle/tool-exposure adapter |
| `@oresk/pi-remote-tools` | 0.2.1 | `ssh-read`, `ssh-write`, `ssh-edit`, `ssh-bash` |
| `pi-ssh` | 0.4.0 | Local model with remote SSH workspace execution |
| `pi-token-speed` | 0.13.1 | Sliding-window tokens/second display |
| `pi-skillful` | 0.5.2 | Skill invocation and visibility improvements |
| `pi-loop-police` | 1.14.1 | Detect/interrupt thinking and tool-call loops |
| `pi-ghost-text` | 0.1.2 + local patch | Inline and next-prompt ghost suggestions |
| `@lanlance/pi-btw` | 0.2.0 | Side questions in an overlay while the main agent runs |

`@shog-lab/pi-toolkit` 0.6.1 is also present in the npm manifest/lockfile as a supporting dependency. `skillful-install.json` records its last reported version.

The installer uses `npm ci --ignore-scripts --legacy-peer-deps` rather than an unpinned update. Legacy peer resolution is required because Pi supplies host packages at runtime and the managed packages declare different compatible host ranges. Running `pi update --extensions` later may move versions allowed by semver ranges.

## Local extensions

Source: `config/agent/extensions/`; Pi auto-discovers this directory.

| Extension | Main behavior | Dependencies/notes |
|---|---|---|
| `ask-guard.ts` | Guardrails around question/confirmation flows | Local test in `agent/tests/` |
| `ask-user-question.ts` | Structured interactive questions | Used by global workflow instructions |
| `custom-header.ts` | Custom Pi header | UI customization |
| `imagegen.ts` | `generate_image` through ComfyUI SDXL + pixel-art LoRA | ComfyUI, ImageMagick, llama-swap GPU handoff |
| `look.ts` | Vision answers and real-browser page measurements | Chrome, global Playwright, OpenRouter or custom vision endpoint |
| `bash-guard/` | Shell-aware destructive-command confirmation and subagent hard blocks | `shell-quote`; tests included; local behavior changes documented |
| `browser/` | Opt-in Playwright browser navigation, JS, console/network, forms, screenshots | `playwright-core`; `/browser on`; persistent profile excluded |
| `claude-cli/` | Claude subscription models through official CLI and DirectSDK shim | Claude Code, Hermes venv/plugin; log excluded |
| `prompt-snippets/` | Toggleable prepend/append prompt snippets | Alt+S or `/snippets`; six snippets included |
| `web-fetch/` | Readable web/PDF extraction | Readability, linkedom, Turndown, unpdf lockfile |
| `web-search/` | Google Custom Search with Firecrawl fallback | Optional Google credentials; example auth only |

Old `.bak` variants, browser profiles, dependency directories, and `claude-cli/shim.log` are not captured.

## Global instructions and small preferences

- `AGENTS.md`: global engineering role, skill-loading rules, verification requirements, Windows tool conventions, safety rules, and Git behavior.
- `keybindings.json`: maps `app.clipboard.pasteImage` to `alt+v`.
- `prompt-suggestions.json`: ghost text model `openrouter/qwen/qwen3.8-flash`, mode `both`.
- `trust.json`: trusts `D:\AIWorkspace` for project-level configuration. Review this on a new machine; it does not create that workspace.
- `environment.md` (under `.pi`, not the agent directory): fixed facts about the original PC, tool paths, and ports. Edit it when the target machine differs.

No `SYSTEM.md`, `APPEND_SYSTEM.md`, custom `prompts/`, or custom `themes/` existed in the agent directory at capture time.

## Skills

All 31 active directories are in `config/agent/skills/`:

- **Agent/workflow:** `agent-desktop`, `analyze-sessions`, `local-spec`, `node-project`, `python-project`, `spec-writer`, `web-debug`, `web-design`.
- **Games/art:** `animated-sprites`, `ayo-rules`, `game-dev`, `game-ui`, `love2d`, `love2d-core`, `pixel-art`, `pixel-art-animator`, `roguelike-design`, `threejs-gltf-loading`, `threejs-materials-lighting`, `threejs-scene-setup`.
- **Local AI:** `local-llm-rocm`.
- **Media/content:** `clip-factory`, `clip-hunter`, `davinci-resolve`, `duofecta-thumbnail`, `gta-reel-editor`, `saber-cutout`, `vice-clips-review`, `youtube-transcript`.
- **Documents/platform:** `apple-emoji-windows`, `pdf-reader`.

Supporting scripts, Lua reference implementations/tests, LOVE templates, Three.js license notices, and the DuoFecta face-detection ONNX asset are included. `pdf-reader/.venv`, Python bytecode, and other generated dependencies are excluded; rebuild them using the included requirements file.

## Planner / reviewer / executor workflow

Sources: `config/pi/planner.md`, `reviewer.md`, `executor.md`, role-specific local notes, and launchers.

| Command | Model/level | Behavior |
|---|---|---|
| `pi-plan "task"` | Strata Gyro-S, medium | Limited tools; writes one scoped `PLAN.md`; can consume `PLAN.next.md` |
| `pi-plan-swift` | Swift 27B, medium | Fallback planner |
| `pi-review` | Fresh Strata session, medium | Checks plan and appends corrections |
| `pi-exec` | Qwen3.6 IQ3, low | Requires `PLAN.md`; full implementation tools except configured exclusions |
| `pi-pe "task"` | Above sequence | Saves task, runs non-interactive plan/review, then executor |
| `pi-loop TASK.md` | Same role assignments | External pi-loop unattended workflow; optional code review |

The role prompts are appended with `--append-system-prompt`; they do not replace Pi's base system prompt. These launchers intentionally use `--no-skills` for tightly scoped local-model contexts. `environment.md` supplies machine facts.

## Other launchers and helpers

- `pi-models.cmd`: menu/dispatcher for Strata, Qwen3.6, plan/review/exec, fallback planner, loop, and Kaggle.
- `pi-strata.cmd`, `pi-qwen36.cmd`: call `ensure-server.ps1` and start Pi with role-specific local prompts.
- `pi-kaggle.cmd`, `pi-kaggle-strata.cmd`: use remote Kaggle providers.
- `ensure-server.ps1`: ensures llama-swap listens on port 8080, requests the required alias, and waits for health.
- `pi-stop.cmd`: local-model cleanup helper. Review before using on a shared machine.
- `kaggle-set.*`, `kaggle-strata-set.*`, `kaggle-check.ps1`: rotate/test ephemeral tunnel configuration.
- `pi-durable.cmd`, `durable-hub.*`, `dsh-hub.*`, `laptop-link.*`: wrappers around separately installed durable/hub tooling.
- `comfyui.cmd`, `vision-check.ps1`: local image/vision helpers.
- `pi-models.sh`: captured shell helper; the maintained Windows entry point is `pi-models.cmd`.

These files are captured as active source, including their historical comments. Comments mentioning removed models/launchers are history, not a promise those removed components are present.

## Local model configuration

`config/machine/` contains:

- `llama-swap/config.yaml`: model aliases, exact ROCm llama.cpp flags, macros, ports, and swap behavior;
- `llama-swap/start-llama-swap.bat` and `kill-tree.ps1`: startup and process-tree cleanup;
- `Strata/strata-gyro-gyro-s.json`: engine, model, expert cache, speculative decoding, vision, VRAM/RAM tuning;
- `Strata/start-strata-pi.bat`: standalone Strata starter;
- `llama/start-qwen36-iq3.bat`: 128K Qwen3.6 MoE configuration;
- `llama/start-swift27-xs-64k.bat`: 48K Swift 27B fallback configuration (legacy 64K alias retained);
- `pi-local/env`: pi-loop role model, swap ID, tools, thinking, and timeout settings.

The model binaries and engines are external. The included `local-llm-rocm` skill contains the detailed build/download/tuning guide and measured hardware notes.

## Ghost-text patch

`config/agent/patches/` preserves two diffs, the patched `render.ts`, and a README. Pi 1.6.0's fake-cursor APC markers prevented `pi-ghost-text` 0.1.2 from rendering suggestions. The patch skips those markers and avoids mutating the render lines.

The installer copies `render.patched.ts` over the installed package after `npm ci`. Reapply it after reinstalling/upgrading that package; first compare the new upstream renderer rather than blindly overwriting a different version.

## Git Bash aliases

The captured file includes active aliases for `pi-models`, `pi-strata`, `pi-stop`, `pi-durable`, `pi-plan`, `pi-exec`, and `pi-pe`. It also preserves historical aliases for `pi-bonsai`, `pi-qwen38`, `pi-antiloop`, and several Qwen27 variants whose `.cmd` files are no longer active. Remove those historical lines on a clean machine if you prefer a strict working-only alias set; they were retained to document the actual shell setup faithfully.
