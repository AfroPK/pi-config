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
| Swift/Ornith compaction override | 10240 / 10000 | Reserve/recent tokens for `qwen27/swift27-xs-64k` and `hipfire/ornith-1.5-9b.mq6` |
| `hideThinkingBlock` | `false` | Thinking blocks are shown |
| `shellPath` | Scoop Git Bash under the home directory | Shell used by Pi's bash tool; installer rewrites the home prefix |
| `packages` | 13 npm declarations (adds `@gwynnnplaine/pi-discord-presence`, `pi-antigravity-acp-provider`, `@capdiem/pi-todo`) plus the `AfroPK/pi-interactive-subagents` git fork | Pi-managed extensions/resources |
| `extensions` | `-builtin:mcp` | Disables built-in MCP because `pi-mcp-adapter` supplies `/mcp` |
| `skills` | `!**/.agents/skills/**` | Excludes nested `.agents` skill trees from discovery |
| `lastChangelogVersion` | `1.6.0` | UI changelog state |
| Extension changelog state | pi-mcp-adapter 7.0.1, pi-skillful 0.5.3 | Prevents already-seen changelogs from repeating |

### Scoped model cycle

`enabledModels` contains these entries in order:

1. `openrouter/deepseek/deepseek-v4.1-flash-1017`
2. `openrouter/moonshotai/kimi-k3.1-pro`
3. `openrouter/qwen/qwen3.8-flash`
4. `openrouter/z-ai/glm-5.3-flash`
5. `qwen3.8-flash-next-gyro-s` (local Strata)
6. `qwen3.6-iq3-local` (local executor)
7. `hipfire/ornith-1.5-9b.mq6` (local, Hipfire)
8. `qwen27/swift27-xs-64k` (local fallback planner)
9. `inkling/inkling2-mini-113k` (local, Unsloth llama.cpp build)
10. `claude-cli/claude-fable-5-2`
11. `claude-cli/claude-opus-5-5`
12. `claude-cli/claude-sonnet-5-5`
13. `claude-cli/claude-haiku-5-5`
14. `antigravity-acp/gemini-3.8-flash`
15. `antigravity-acp/gemini-4-argon`
16. `antigravity-acp/gemini-4-hydrogen`
17. `antigravity-acp/gemini-4-neon`

The first nine are configured directly or through OpenRouter. The `claude-cli` entries are registered by the local `claude-cli` extension and require its external dependencies. The `antigravity-acp` entries come from the `pi-antigravity-acp-provider` package (preferences in `agent/antigravity-acp-provider/config.json`, set to `permissions: "yolo"` so `pi-bridge` MCP calls run without Antigravity confirmation prompts while Pi's own guards handle safety; its `sessions.json` is not captured) and need a signed-in Antigravity install. Setting Windows User env var `AGY_ACP_BIN` to `agy.exe` (1.5+) enables both streamed model thinking blocks (`agent_thought_chunk`) and direct `pi-bridge` Pi tools (`mcp_pi-bridge_pi_*`) via the local `pi-antigravity-acp-provider-native-agy.patch` and `antigravity-prefer-pi-tools.ts`.

## Model providers

Source: `config/agent/models.json`.

| Provider | Endpoint | Model(s) | Context/output | Credential |
|---|---|---|---|---|
| `openrouter` | Built-in OpenRouter | Scoped built-in models | Catalog-defined | Pi `/login` or `OPENROUTER_API_KEY` |
| `omnirouter` | `localhost:20128/v1` | Claude round-robin, Laguna, Gemini, Kimi, Jarvis, Ultron, Vision, combos | Endpoint-defined | `${OMNIROUTER_API_KEY}` |
| `strata` | `127.0.0.1:8080/v1` | `qwen3.8-flash-next-gyro-s`; text + image | 65,536 / 32,768 | dummy `local` |
| `qwen27` | `127.0.0.1:8080/v1` | `swift27-xs-64k`; text | 49,152 / 32,768 | dummy `local` |
| `qwen36iq3` | `127.0.0.1:8080/v1` | `qwen3.6-iq3-local`; text | 131,072 / 16,384 | dummy `local` |
| `hipfire` | `127.0.0.1:8080/v1` | `ornith-1.5-9b.mq6`; text | 73,728 / 16,384 | dummy `local` |
| `inkling` | `127.0.0.1:8080/v1` | `inkling2-mini-113k`; text | 98,304 / 16,384 | dummy `local` |
| `kaggle` | Captured temporary Cloudflare tunnel | `qwen27-q6-mtp` | 131,072 / 16,384 | `${KAGGLE_API_KEY}` |
| `kaggle-strata` | Captured temporary Cloudflare tunnel | `qwen3.8-flash-next-coder-iq1_m` (or `gyro-s` when set) | 131,072 / 16,384 | `${KAGGLE_STRATA_API_KEY}` |

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

Declared in `settings.json`; exact installed dependency trees are locked in `config/agent/npm/package-lock.json`. Packages with local patches are exact-pinned in both `settings.json` and `npm/package.json` so `pi update --extensions` skips them instead of overwriting local modifications.

| Package | Captured version | Purpose |
|---|---:|---|
| `@juanibiapina/pi-plan` | 0.3.1 | Read-only plan mode |
| `pi-paster` | 0.2.3 | Turn pasted image paths into attachments |
| `pi-mcp-adapter` | 7.0.1 | MCP connection/lifecycle/tool-exposure adapter |
| `@oresk/pi-remote-tools` | 0.2.1 | `ssh-read`, `ssh-write`, `ssh-edit`, `ssh-bash` |
| `pi-ssh` | 0.4.0 | Local model with remote SSH workspace execution |
| `pi-token-speed` | 0.13.1 | Sliding-window tokens/second display |
| `pi-skillful` | 0.5.2 | Skill invocation and visibility improvements |
| `pi-loop-police` | `1.14.1` (pinned + patched) | Detect/interrupt thinking and tool-call loops |
| `pi-ghost-text` | `0.1.2` (pinned + patched) | Inline and next-prompt ghost suggestions |
| `@lanlance/pi-btw` | `0.2.0` (pinned + patched) | Side questions in an overlay while the main agent runs |
| `@gwynnnplaine/pi-discord-presence` | 0.1.1 | Discord Rich Presence: live activity, project · model, session timer; `/presence on\|off\|status` |
| `pi-antigravity-acp-provider` | `0.1.22` (pinned + patched) | Antigravity ACP provider with native `agy` CLI support |
| `git:github.com/AfroPK/pi-interactive-subagents` | 3.7.2 fork (`0d0dd21`) | Async subagents in tmux (psmux) panes: `subagent`, `subagent_message`, `subagents_list`, `/subagent` |

`@shog-lab/pi-toolkit` 0.6.1 is also present in the npm manifest/lockfile as a supporting dependency. `skillful-install.json` records its last reported version.

The installer uses `npm ci --ignore-scripts --legacy-peer-deps` rather than an unpinned update. Legacy peer resolution is required because Pi supplies host packages at runtime and the managed packages declare different compatible host ranges. Running `pi update --extensions` later updates unpinned npm packages and git packages while leaving the four pinned packages untouched.

## Local extensions

Source: `config/agent/extensions/`; Pi auto-discovers this directory. Local extensions import `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` directly rather than deprecated `@mariozechner/*` / `@sinclair/typebox` aliases.

| Extension | Main behavior | Dependencies/notes |
|---|---|---|
| `antigravity-prefer-pi-tools.ts` | Steers `antigravity-acp` models to route tool calls through Pi's `pi-bridge` MCP server (`mcp_pi-bridge_pi_*` under native `agy.exe`, `call_mcp_tool` under `agy_acp_server`); `/antigravity-pi-tools [on\|off]` | Provider-scoped (zero tokens on other models); local test in `agent/tests/` |
| `ask-guard.ts` | Guardrails around question/confirmation flows | Local test in `agent/tests/` |
| `ask-user-question.ts` | Structured interactive questions | Used by global workflow instructions; TUI-guarded for non-TUI modes |
| `dictate/` | Voice dictation: `alt+m` start/stop, `alt+n` cancel; `/dictate-check` | Adapted from amosblomqvist/pi-dictate; ffmpeg capture from the Focusrite, transcribed by HomeLab faster-whisper `http://192.168.0.117:8020` (`DICTATE_*` env vars override) |
| `custom-header.ts` | Custom Pi header | UI customization; uses `tui.editor.deleteToLineEnd` keyhint |
| `imagegen.ts` | `generate_image` through ComfyUI SDXL + pixel-art LoRA | ComfyUI, ImageMagick, llama-swap GPU handoff |
| `look.ts` | Vision answers and real-browser page measurements | Chrome, global Playwright, OpenRouter or custom vision endpoint |
| `patch-guard.ts` | Checks local package patches & `loop-police.json` on `session_start`; `/patch-status`, `/patch-apply` | Uses `agent/patches/manage-patches.mjs` and `patches-manifest.json` |
| `bash-guard/` | Shell-aware destructive-command confirmation and subagent hard blocks | `shell-quote`; tests included; local behavior changes documented |
| `browser/` | Opt-in Playwright browser navigation, JS, console/network, forms, screenshots | `playwright-core`; `/browser on`; persistent profile excluded |
| `claude-cli/` | Claude subscription models through official CLI and DirectSDK shim | Claude Code, Hermes venv/plugin; log excluded |
| `prompt-snippets/` | Toggleable prepend/append prompt snippets | Alt+S or `/snippets`; six snippets included |
| `web-fetch/` | Readable web/PDF extraction | Readability, linkedom, Turndown, unpdf lockfile |
| `web-search/` | Google Custom Search with Firecrawl fallback | Optional Google credentials; example auth only |

Old `.bak` variants, transient `*.lock` files (such as `skillful-install.json.lock`), browser profiles, dependency directories, and `claude-cli/shim.log` are not captured.

## Global instructions and small preferences

- `AGENTS.md`: global engineering role, skill-loading rules, verification requirements, Windows tool conventions, safety rules, and Git behavior.
- `keybindings.json`: maps `app.clipboard.pasteImage` to `alt+v`.
- `prompt-suggestions.json`: ghost text model `openrouter/qwen/qwen3.8-flash`, mode `both`.
- `trust.json`: trusts `D:\AIWorkspace` for project-level configuration. Review this on a new machine; it does not create that workspace.
- `environment.md` (under `.pi`, not the agent directory): fixed facts about the original PC, tool paths, and ports. Edit it when the target machine differs.

No `SYSTEM.md`, `APPEND_SYSTEM.md`, custom `prompts/`, or custom `themes/` existed in the agent directory at capture time.

## Skills

All 33 active directories are in `config/agent/skills/`:

- **Agent/workflow:** `afropk-github-repo`, `agent-desktop`, `analyze-sessions`, `local-spec`, `node-project`, `python-project`, `spec-writer`, `web-debug`, `web-design`.
- **Games/art:** `animated-sprites`, `ayo-rules`, `balatro-llm`, `game-dev`, `game-ui`, `love2d`, `love2d-core`, `pixel-art`, `pixel-art-animator`, `roguelike-design`, `threejs-gltf-loading`, `threejs-materials-lighting`, `threejs-scene-setup`.
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

The role prompts are appended with `--append-system-prompt`; they do not replace Pi's base system prompt. These launchers intentionally use `--no-skills` for tightly scoped local-model contexts and invoke Pi's official CLI bundle entrypoint (`dist\bundle\cli.js`). `environment.md` supplies machine facts.

## Other launchers and helpers

- `pi-update.cmd` / `pi-update.ps1`: safe update wrapper that backs up settings, models, keybindings, npm manifests, and `loop-police.json`, runs `pi update`, reapplies/verifies local package patches, and runs `verify-pi-compat.mjs`.
- `pi-models.cmd`: menu/dispatcher for Strata, Qwen3.6, plan/review/exec, fallback planner, loop, and Kaggle.
- `pi-strata.cmd`, `pi-qwen36.cmd`, `pi-ornith.cmd`, `pi-inkling.cmd`: call `ensure-server.ps1` and start Pi with role-specific local prompts (`pi-inkling.cmd` defaults to `--thinking minimal`).
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
- `hipfire-test/serve-ornith.cmd`: Hipfire server for Ornith 1.5 9B MQ6 (MTP K=2, 72K), started by llama-swap. Hipfire itself, its ROCm path and the model are external;
- the `inkling2-mini-113k` llama-swap entry needs Unsloth's ROCm gfx103X llama.cpp prebuilt (`rocm-unsloth-b12675` macro) plus the `dspark-Inkling-2-Mini-Q8_0.gguf` speculative drafter (`q4_1` KV cache, `-b 512 -ub 32`, `--reasoning-effort minimal`), which are not captured;
- `pi-local/env`: pi-loop role model, swap ID, tools, thinking, and timeout settings.

The model binaries and engines are external. The included `local-llm-rocm` skill contains the detailed build/download/tuning guide and measured hardware notes.

## Local package patches and update protection

Four npm packages carry local patches inside `agent/npm/node_modules/`. Rather than relying on ad-hoc edits that an update or reinstall would erase, `config/agent/patches/` tracks unified diffs, checksum markers, and runtime config:

- `pi-ghost-text@0.1.2`: `pi-ghost-text-fake-cursor.patch` (skips Pi >= 1.6 `FAKE_CURSOR` APC markers without mutating line arrays) and `pi-ghost-text-after-turn.patch` (after-turn suggestions on empty input without flashing `NONE`); `render.patched.ts` is kept for reference.
- `pi-loop-police@1.14.1`: `pi-loop-police-local.patch` (defers recovery until `agent_settled` and adds `EXEMPT_PROVIDERS` bypass) plus `pi-loop-police.config.json` (restores `extensions/loop-police.json` with `EXEMPT_PROVIDERS: "antigravity-acp"` and sanitized `HOOK_LOG`).
- `pi-antigravity-acp-provider@0.1.22`: `pi-antigravity-acp-provider-native-agy.patch` (supports native `agy 1.5+` CLI `acp --dangerously-skip-permissions` and enables HTTP `pi-bridge` MCP tools alongside streamed thinking blocks) and `pi-antigravity-acp-provider-continuation-steer.patch` (attaches mid-turn steering/custom messages such as `subagent_result` and `subagent_question` onto resolved `pi-bridge` MCP tool results instead of skipping them, with prompt-replay fallback for permission-only continuations).
- `@lanlance/pi-btw@0.2.0`: `pi-btw-model-runtime.patch` (passes parent `modelRuntime` to `/btw` side sessions so extension-registered providers resolve).

`patches-manifest.json` records patch descriptors, required code markers, and normalized SHA-256 hashes; `manage-patches.mjs` (`status` / `check` / `apply`) uses `git apply --ignore-whitespace --check` and refuses blind overwrites if upstream code conflicts. At runtime, `extensions/patch-guard.ts` verifies markers on `session_start` and provides `/patch-status` and `/patch-apply`.

## Interactive subagents

`pi-interactive-subagents` spawns subagents in tmux panes and steers each result back into the main session. On this PC `tmux` is psmux 3.4.0, so **start Pi inside it** or every spawn fails with "tmux is required":

```bash
tmux new -A -s pi pi
```

Agent definitions in `config/agent/agents/` override the three bundled agents (global beats bundled and survives `pi update`). All three run `openrouter/deepseek/deepseek-v4.1-flash-1017` with `thinking: xhigh`; Pi clamps that to the model's top level, `max`.

| Agent | Tools | Role |
|---|---|---|
| `scout` | `read`, `grep`, `find`, `ls` | Read-only codebase recon |
| `researcher` | `web_search`, `web_fetch`, `safe_bash` | Web research with sources (uses the local `web-search`/`web-fetch` extensions) |
| `worker` | `read`, `write`, `edit`, `bash`, `web_search`, `web_fetch`, may spawn `scout`/`researcher` | General implementer |

Pi installs it from Freddy's fork [AfroPK/pi-interactive-subagents](https://github.com/AfroPK/pi-interactive-subagents) (upstream: amosblomqvist/pi-interactive-subagents, `c3e8b53`). The fork commits these fixes, so `pi update --extensions` keeps them:

- **Git Bash, not WSL.** Subagents are launched by typing a bash command into a new pane, whose shell is PowerShell. There a bare `bash` is `C:\Windows\System32\bash.exe` (WSL; Git Bash is not on the system PATH), which strips the backslashes from the script path (`/bin/bash: C:UsersFreddy...sh: No such file or directory`). The subagent hangs at "starting" and its pane never closes. The fork resolves Git Bash (`PI_SUBAGENT_BASH`, Pi's `shellPath`, standard installs) and types `& '<git bash>' '<script>'`.
- **`subagent_stop` tool.** The orchestrator can stop a running subagent by name: the pane closes, the last progress message is returned immediately, and the session stays resumable with `subagent_message`. It no longer needs to kill panes with bash.
- **Pane-close resume block.** A subagent whose pane was closed from outside (user, crash) is marked stopped in the name registry, and `subagent_message` refuses to resume it unless the call passes `userRequested: true` — i.e. only when the user asked. `subagent_stop` does not set this mark, so deliberate stops stay freely resumable.
- **Job Objects on stop (koffi).** Windows does not end child processes with their parent, and parent/child links break when an intermediate process exits. Each pane's shell is assigned to a Windows Job Object at creation (via `koffi`, held by the parent Pi process); every process it spawns joins automatically, and stopping the subagent terminates the job — including tool processes orphaned *before* the stop. Verified live: a `sleep` orphaned by killing its parent bash was ended by the orchestrator's `subagent_stop`. Falls back to `taskkill /T` if koffi is unavailable.
- **Killed panes.** Upstream only finished a watch when the subagent printed its done sentinel, so a pane closed by the user or the orchestrator left a ghost "active" entry in the widget forever. The fork checks every poll that the pane still exists and, after two misses, reports "Stopped: the subagent's pane was closed" to the orchestrator.
- **Per-session pane ids.** psmux numbers panes per session (`%1` exists in every session), so pane lookups use `list-panes -s` on the parent's session, not `list-panes -a`.
- **Line endings.** `.gitattributes` forces LF. With `core.autocrlf` the agent `.md` files otherwise check out as CRLF, the frontmatter parser only matches LF, and every agent is "not found".
- **psmux split.** When a window has no room for another pane, psmux's `split-window` exits 0 and prints the *target* pane id instead of failing. Upstream then types the subagent command into the parent Pi pane and later kills it. The fork rejects any pane id that already existed.
- **`/subagent` mid-turn.** Upstream calls `sendUserMessage` without `deliverAs`, so `/subagent` typed while the agent is busy errors with "Agent is already processing". The fork steers it in.

To pull upstream changes: `git fetch upstream && git merge upstream/main` in a clone of the fork, re-run the tests, push, then `pi update git:github.com/AfroPK/pi-interactive-subagents`.

Verified 2026-11-22 on psmux: unit tests 150/150 and integration 10/10 on the fork, lifecycle integration tests 7/7 on DeepSeek, surface tests 6/7 (PowerShell 5.1 writes the test's file as UTF-16), plus live scout, researcher and worker runs.

## Discord presence

`@gwynnnplaine/pi-discord-presence` runs with its built-in defaults (Discord app id `1520833162148712580`); there is no `~/.pi/agent/discord-presence.json`. It only acts in interactive TUI sessions and shows filenames and the project name, so use `/presence off` or a per-project `.pi/discord-presence.json` with `{ "enabled": false }` for private repos.

**Discord must not run as administrator.** Pi talks to Discord over the `\\.\pipe\discord-ipc-0` named pipe, and Windows refuses a normal-rights process access to an elevated app's pipe (`EPERM`, surfaced as "Could not connect to Discord client"). Discord has no run-as-admin flag here and its Run-key autostart is unelevated, so this only happens when it is launched from an elevated terminal or app. Fix: quit it from the tray and start it normally. Verified 2026-11-22: pipe connect `EPERM` while elevated, `connect OK` after a normal restart, and the Pi card appeared in Discord.

## Git Bash aliases

The captured file includes active aliases for `pi-models`, `pi-strata`, `pi-stop`, `pi-durable`, `pi-plan`, `pi-exec`, and `pi-pe`. It also preserves historical aliases for `pi-bonsai`, `pi-qwen38`, `pi-antiloop`, and several Qwen27 variants whose `.cmd` files are no longer active. Remove those historical lines on a clean machine if you prefer a strict working-only alias set; they were retained to document the actual shell setup faithfully.
