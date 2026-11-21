---
name: local-llm-rocm
description: Complete guide to running local LLMs on Freddy's PC (AMD RX 6750 XT 12 GB, RDNA2 gfx1031, Ryzen 7 5700X, 32 GB RAM, Windows 11) with llama.cpp on ROCm - building the working ROCm llama-server, the measured speed recipe (MTP, n-cpu-moe, KV quant, batch, load-mode), finding max context without VRAM spill, benchmarking, serving through llama-swap on :8080, and wiring models into Pi and opencode. Use for any task that installs, adds, downloads, benchmarks, retunes, debugs or serves a local model, a llama-server launcher, llama-swap, Strata/XeStrata, ROCm PyTorch/ComfyUI, or a local provider in Pi/opencode.
---

# Local LLMs on this PC (llama.cpp + ROCm, gfx1031)

Everything here was **measured on this machine** between 2026-10-10 and 2026-11-08. Per-model configs and numbers
are in `models.md`; copy-paste templates (launcher, llama-swap entry, Pi/opencode provider, bench script) in
`templates.md`. **Never invent flags or speeds**: start from a config in models.md, then measure (section 5).

| Part | Value |
|---|---|
| GPU | AMD Radeon RX 6750 XT, 12 GB (12272 MiB, ~11.3 GB usable with the desktop up), RDNA2 **gfx1031**, **no WMMA** (slow prefill on long prompts) |
| CPU / RAM | Ryzen 7 5700X 8C/16T, 32 GB RAM, page file 32 GB (commit limit ~64 GB) |
| Disks | models on `E:\models\<publisher>\<repo>\` (NVMe); Strata data must stay on C: |
| OS / shells | Windows 11; PowerShell + Git Bash. `cmd` can't find exes by name (stray `"` in PATH after `...\GitHub CLI"`) - **always use full exe paths in .bat/.cmd** |
| Endpoint | **llama-swap on http://127.0.0.1:8080** (OpenAI `/v1`), one model at a time, swapped by `model` name |

## 0. Quick start (the model is already set up)

1. Pick an alias from the table in `models.md` (e.g. `ornith9b-q8`, `swift27-xs-64k`, `qwen3.6-antiloop-local`).
2. Make sure llama-swap runs and the model is loaded:
   `powershell -NoProfile -File %USERPROFILE%\.pi\ensure-server.ps1 -Alias <alias>`
   (starts `C:\llama-swap\start-llama-swap.bat` if :8080 is free, kills a stand-alone server holding :8080, then
   GETs `/upstream/<alias>/health` which loads/swaps the model; up to 10 min for big ones).
3. Call `http://127.0.0.1:8080/v1/chat/completions` with `"model": "<alias>"`, any API key. Web UI + logs: http://127.0.0.1:8080/ui
4. Free the GPU (e.g. for ComfyUI or a game): `curl -X POST http://127.0.0.1:8080/api/models/unload`.
   **Never unload while a model is still loading** - llama-swap wedges in "starting" and must be restarted.

## 1. Pick the engine

| Engine | Path | Use for |
|---|---|---|
| **llama.cpp b11869 win-rocm + TheRock ROCm 10.2 DLLs** (default) | `__PI_HOME__\llama-mainline\b11869-rocm-th102\llama-server.exe` | every normal GGUF |
| PrismML llama.cpp fork, Vulkan | `__PI_HOME__\llama-prism\vulkan\llama-server.exe` | only PQ2_0 ternary GGUFs (Bonsai) + legacy Qwen3.8-35B entry |
| Strata (self-built HIP engine) | `C:\Strata` | Qwen3.8-Flash-Next **Gyro-S 125B MoE** (strongest local model, 64K) |
| XeStrata (SYCL port of Strata) | `C:\XeStrata` | same Gyro-S at 128K, slower |
| ROCm PyTorch (AMD multi-arch wheels) | `D:\AIWorkspace\ComfyUI\venv` | image/music generation |

Measured: **ROCm beats Vulkan on every model on this card.** Dense 27B: 157-162 pp / 35-39 tg (ROCm) vs 106-123 / 22-24
(Vulkan). MoE with experts in RAM: prompts 2.7x faster, a 32K prompt 62 s vs 339 s. Vulkan only fits a little more
context. vLLM (rocm-windows-rdna2) lost everywhere: 45 vs 62 tok/s decode, 232 vs 556 prefill, 16K max ctx. Don't use it.
Ollama/LM Studio: no MTP, no PQ2_0, worse placement control - don't use them either.

## 2. Build the ROCm llama-server (from scratch)

The official llama.cpp Windows ROCm release ships a ROCm 10.0 runtime that **lists no devices on gfx1031**. The fix
is to keep its binaries and swap in the TheRock ROCm 10.2 runtime, which does support gfx1030/gfx1031:

1. Download the `win-rocm` x64 zip of a llama.cpp release from github.com/ggml-org/llama.cpp/releases (b11869 is what
   runs here). Extract to `__PI_HOME__\llama-mainline\<build>-rocm` and keep that folder untouched.
2. Copy it to `<build>-rocm-th102`, then copy **everything** from TheRock's bin over it:
   `C:\Strata\engine\rocm\bin\*` -> `amdhip64_7.dll, amd_comgr.dll, hipblas.dll, libhipblaslt.dll,
   libtensilelite-host.dll, rocblas.dll, rocblas\library\ (gfx1030/gfx1031 Tensile .dat/.hsaco kernels),
   rocsolver.dll, rocm_kpack.dll, origami.dll, msvcp140*.dll, vcruntime140*.dll`.
   (Same files also live in `C:\Strata\.rocm-win\...\_rocm_sdk_core\bin`; TheRock 10.2.0a20260930.)
3. Verify: `llama-server.exe --list-devices` must print
   `ROCm0: AMD Radeon RX 6750 XT (12272 MiB, ...)`. Nothing listed = wrong/missing runtime DLLs.
4. Smoke test with a small GGUF (`--gpu-layers 99 --fit off`), check `timings` in the response.
5. When updating llama.cpp: build a new folder side by side, re-copy the DLLs, re-run a known config from models.md and
   compare tok/s before switching the `rocm` macro in llama-swap. Never overwrite the working build.

Do NOT set `HSA_OVERRIDE_GFX_VERSION` (Linux trick; not needed with these DLLs). PrismML's own HIP build does not see
gfx1031. Avalon (CUDA-oriented fork) needed VS 2019's 14.29 toolset + 2 patches and couldn't load Gyro-S - not used.

## 3. The speed recipe (apply in order, measure after each step)

1. **All on GPU if the weights fit**: `--gpu-layers 99 --fit off`. `--fit off` matters - auto-fit silently spills or
   under-uses VRAM. **Dense models must be 100% on GPU**: moving layers of a dense 27B to CPU dropped 35 -> 15 / 9.6 / 7.6 tok/s.
2. **MTP speculative decoding whenever the GGUF has an MTP/nextn head** (tensors `blk.N.nextn.*`; check with
   gguf-dump or the load log). Biggest single win, no extra draft model needed:
   `--spec-type draft-mtp --spec-draft-n-max 2`.
   - **n-max 2 is the sweet spot everywhere**: Ornith 9B 37.8 -> 53.3 (n1) -> **61.9 (n2)** -> 62.2 (n3);
     AntiLoop 30.6 -> 46.7; Bonsai 34.7 -> 48; Qwen3.8-27B 27-30 (n1) -> 35-39 (n2).
   - **n-max 1 collapses at depth** on AntiLoop (~14 tok/s past 60K). Use 2.
   - Healthy draft acceptance is ~78-90% (server log).
   - Unsloth GGUFs usually have **no** MTP head; look for `-mtp` files (ISTA-DASLab, ukisai Swift) or models that ship
     it (Ornith, Qwen3.6 AntiLoop by mradermacher, Qwen3.8-35B-A3B). No head -> no MTP flags.
3. **ngram prompt-lookup for rewrite-heavy work**: `--spec-type draft-mtp,ngram-simple --spec-ngram-simple-size-n 16
   --spec-ngram-simple-size-m 128`. File rewrites 38 -> 93 tok/s (Qwen3.8-35B), 60 -> 80 (Bonsai); fresh code unchanged,
   prose ~-9%. **It hurts Qwen3.8-27B/Swift** - don't add it there.
4. **MoE bigger than VRAM: `--n-cpu-moe N`** (expert weights of the first N layers in RAM, attention + rest on GPU).
   Sweep N downward until it spills (section 4), then step back up ~2 for desktop headroom. The edge is flaky
   (a lower N can spill while a higher one doesn't). Results: Qwen3.6 IQ3_XXS **16** (40 tok/s), Qwen3.6 Q4_K_M **28**,
   AntiLoop Q4_K_M + MTP **30** (28 = +2.5 tok/s but no headroom).
5. **With n-cpu-moe on ROCm: `--load-mode none`** (no mmap). Nemotron Bolt 10.9 -> 19.7 tok/s; with mmap RAM filled to
   0.1 GB free. **On ROCm do NOT use `--no-host`** (that flag is only for the Vulkan build, where without it the
   "CPU" experts land in pinned Vulkan_Host memory and stream over PCIe).
6. **`-b 2048 -ub 2048` for MoE/offload models**: Bolt prompts 172 -> 476 tok/s, Flint ~+55%. On all-VRAM dense models
   it costs VRAM and hurt (27B: ub 1024 worse) - leave the defaults there.
7. **KV cache quant buys context**: `--flash-attn on --cache-type-k q4_0 --cache-type-v q4_0` (q8_0 when it fits).
   q4_0 roughly doubles context; needle tests passed at 39K/57K (Strata), 95K (XeStrata), 97.8K (Kaggle).
8. `--threads 6` (8 was never better), `--parallel 1` (one slot gets all context), `--jinja` (chat template / tools).
9. Qwen3.6 MoE: `--cache-ram 0`. Qwen3.6 thinking control: `--reasoning on --reasoning-budget 8192`.
10. Sampling = the model card's (Qwen family: `--temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.0`). "Tips" like
    `repeat-penalty 1.1` or `-ngl 20` from videos/Reddit were slower or worse here - measure before adopting.

## 4. Max context without VRAM spill

**A spill doesn't crash. It silently drops decode to 1-13 tok/s.** Windows' driver pages VRAM into shared system memory.

- **Spill test**: start with `--fit off`, fill the context to ~85-90% with a real prompt, decode 256 tokens at that depth,
  and watch Task Manager -> Performance -> GPU -> **Shared GPU memory** (or perf counters). Idle baseline ~0.13-0.27 GB,
  ~0.4 GB with a model loaded; **~0.9-1.0 GB shared = spilled**. Shared memory right after load already predicts it.
- A config is only good if it is **clean on a repeat run** - near the edge the same config spills on one run and not
  the next (Swift IQ3_XXS 32K: 23.6 then 6.5 tok/s). Keep ~0.5 GB VRAM headroom.
- **dwm.exe takes VRAM.** Parsec's virtual display pushed dwm to 1.4-2.2 GB and made 64K configs spill (~1 tok/s).
  Fix used: disable both "Parsec Virtual Display Adapter" devices in Device Manager + reboot -> dwm 641 MB. dwm frees
  VRAM only on sign-out/reboot. **If speed suddenly drops: check dwm/other GPU users first**, then raise n-cpu-moe by 2
  or lower context. A crashed llama-server can keep 8+ GB of VRAM: `taskkill /IM llama-server.exe /F`.
- **RAM/commit matters for offload**: Qwen3.8-35B needs ~23 GB commit; a 16 GB page file made it page (20-35 tok/s).
  Offloaded 22 GB models need ~13 GB free RAM. Changing the page file is a system setting - **ask Freddy to do it**
  (SystemPropertiesPerformance.exe), never change it yourself.
- Measured maxima (no spill): Qwen3.8-27B IQ2_XS q8 40K / q4 64K (48K in use); IQ2_S q8 24K / q4 40K; Swift IQ3_XXS
  q4 22K; Ornith 9B Q8 q8 80K / q4 96K; Bonsai q4 96K; MoE models 128K with n-cpu-moe; Qwen3.8-35B 256K q4.
- Prefill slows with depth and RDNA2 has no WMMA: a 95K cold prompt took 15 min on XeStrata. **Read the server's
  prompt-progress log lines before calling something a hang.**

## 5. Benchmark properly

- Report: **decode tok/s short, decode at depth, prompt tok/s**, warm server, >= 2 runs. Take them from the `timings`
  block of llama-server's response (`predicted_per_second`, `prompt_per_second`). Template in `templates.md`.
- Put a unique prefix in each prompt (defeats the prompt cache). Test code, prose and a file rewrite separately -
  MTP/ngram gains differ by content.
- Between configs: `taskkill /IM llama-server.exe /F` before and after (Git Bash `$!` is NOT the Windows PID). A stale
  server made later configs falsely fail with `CUBLAS_STATUS_INTERNAL_ERROR` / 503.
- Strata prompt speed is bimodal from start to start (~420 or ~477 t/s): compare across several starts.
- Pi's token-speed readout includes time after tool calls, so it reads below real decode.
- **Speed is not quality.** Test the real agent role before switching anything: Qwen3.6 (all variants) and Ornith 9B
  are fast but ignore a planner prompt / loop as planners; they are fine as executors. Swift 27B loops least.
- Existing scripts: `__PI_HOME__\llama-prism\bench.py`, `sweep.ps1`, `bench_edit.py`, `bench_oai.py`,
  `llama-prism\antiloop-sweep\run1.sh`; `C:\Strata\bench-gyro.py`, `bench-ab.ps1`, `needle-gyro.py`.

## 6. Add a new model (checklist)

1. **Download**: `hf download <repo> <file> --local-dir E:\models\<publisher>\<repo>` or plain curl. The line is ~10 MB/s
   and a single connection saturates it; aria2c -x16 is not faster and needs `--disable-ipv6=true`. **Verify sha256**
   against the HF page.
2. **Size check**: weights + KV + ~1 GB compute must fit ~11.3 GB for all-VRAM. Dense > ~10.5 GB = tiny context only.
   MoE bigger than that -> n-cpu-moe. Check for an MTP head.
3. **Start from the closest config** in models.md (dense all-VRAM / small model / MoE offload) on a free port
   (not 8080; e.g. `--port 8091`), stop llama-swap's model first (unload).
4. **Tune**: MTP n2 -> n-cpu-moe sweep (MoE) -> context sweep with the spill test -> b/ub for MoE. Measure each step.
5. **Write a stand-alone launcher** `__PI_HOME__\llama\start-<name>.bat` with full exe path, `--alias <name>` and
   `REM` lines recording the sweep and the date (template in templates.md).
6. **Add to llama-swap** `C:\llama-swap\config.yaml` under `models:` with the same flags, `--port ${PORT}`, reusing the
   macros (`${rocm}`, `${prism}`, `${mtp2}`, `${qwen27-sampling}`). The model id = the alias clients use. llama-swap
   runs with `--watch-config`: saving may unload the running model, so don't edit it under someone's live session.
7. **Wire clients** (section 7), test with a real task, and back up every file first as `*.bak-<yyyymmdd>-<what>`.

## 7. Clients

### Pi (`~\.pi\agent\models.json`, `settings.json`, `~\.pi\pi-<name>.cmd`)
- Provider: `baseUrl http://127.0.0.1:8080/v1`, `api openai-completions`, `apiKey local`, model `id` = llama-swap
  alias, `contextWindow` = the real `--ctx-size`, `maxTokens` <= compaction reserve for small contexts.
- Thinking (Qwen family) - `thinkingFormat "chat-template"` with chatTemplateKwargs
  `enable_thinking {"$var":"thinking.enabled"}`, `preserve_thinking true`:
  - Qwen3.8-27B / Swift (template has reasoning_effort low/medium/xhigh, defaults to xhigh): add
    `reasoning_effort {"$var":"thinking.effort","omitWhenOff":true}` + thinkingLevelMap minimal/low->low,
    medium->medium, high/xhigh->xhigh. Server side `--chat-template-kwargs "{\"reasoning_effort\":\"medium\"}"`
    (xhigh sometimes ends blank; the template rejects "high").
  - On/off-only models (Qwen3.6, Qwen3.5-9B, Qwen3.8-35B, Ornith): `thinkingTokenBudgetField "thinking_budget_tokens"`,
    settings.json thinkingBudgets minimal 1024 / low 2048 / medium 4096 / high 16384.
  - Strata/XeStrata: `thinkingFormat "openai"` with `off -> none`.
  - Format `"qwen"` is ignored by llama-server (off still thought ~3K tokens). Don't use it.
  - **Every object value in chatTemplateKwargs needs `$var`**, otherwise Pi rejects the whole models.json and every
    local model vanishes. **Run `pi --list-models` after each edit.**
- settings.json: add to `enabledModels`; small contexts need `compaction.modelOverrides` (24K reserve 6144; 40K 10240;
  48K reserve 10240 + keepRecent 10000).
- Launcher `.cmd`: `ensure-server.ps1 -Alias <alias>` then the **full node path** to Pi's cli.js `--model provider/id`.
- Scripted runs: `pi ... -p "task" < /dev/null` - without `< /dev/null` a `-p` run waits on stdin forever.

### opencode (`~\.config\opencode\opencode.jsonc`)
Add an OpenAI-compatible provider pointing at llama-swap (template in templates.md):
`"npm": "@ai-sdk/openai-compatible"`, `options.baseURL "http://127.0.0.1:8080/v1"`, one entry per alias with
`limit.context` = real ctx-size. Run ensure-server.ps1 (or hit `/upstream/<alias>/health`) first so the first request
doesn't time out during the 35-50 s swap.

### Anything else
Any OpenAI-compatible client works against `http://127.0.0.1:8080/v1`; `GET /v1/models` lists all aliases.

## 8. Strata / XeStrata (Gyro-S 125B MoE)

- Strata, `C:\Strata`, engine 0.1.57 (v0.2.11) + **DFlash2 drafter** (`"drafting": "dflash2"`, pack in
  `C:\Strata\Strata-data\dflash2`): 64K q4_0, ~31-36 tok/s warm code decode, ~480 pp.
  Config `C:\Strata\strata-gyro-gyro-s.json`: `--max-context 65536 --kv q4_0 --vram-reserve-mib 1536`, env
  `STRATA_HIP_PROMPT_F16=1 STRATA_RESIDENT_HEADROOM_GIB=6 STRATA_RESIDENT_PIN=0 STRATA_HC_PERSIST=1 STRATA_SELECT_SIMT=1
  STRATA_ROCBLAS_TUNING=C:\Strata\tools\hip\gfx1031-rocblas-5.8.0.efafc1c1.txt`. Keep 7 default workers (don't set
  `--pool-workers`), headroom 6.
- Rebuild: `git pull` in C:\Strata, `set STRATA_HIP_ARCHS=gfx1030;gfx1031` + `tools\hip\build_windows.bat` (TheRock in
  `C:\Strata\.rocm-win`, VS Build Tools), unzip `dist\strata-windows-x64-hip.zip` over `engine`. Keep `engine.bak-*` +
  a git tag. Check `$LASTEXITCODE` - `cmd /c "x.bat & echo %errorlevel%"` reports 0 on failure.
- rocBLAS tuning table: build natively with `tools\hip\tune_rocblas_windows.bat` (~5 min); must match the exact rocBLAS
  version; WSL can't do it (no RDNA2).
- Data dir must be `C:\Strata\Strata-data` ("tokenizer is missing" = it got moved). Don't run `setup.py` casually: it
  rewrites configs, gathers models and pip-installs into whatever Python runs it - back up first.
- XeStrata 0.2.2 (`C:\XeStrata`, 128K, 19.6 tok/s, prefill ~102): needs 3 patches after each new release - TheRock
  `amdhip64_7.dll` on PATH/lib_dirs, `XESTRATA_AMD_GFX=gfx1031` fallback in setup.py, and binary-patch
  `ur_adapter_hip.dll` "gfx1031\0" -> "gfx103X" (offset 74470; keep `.orig`).
- In llama-swap both run their python `server.py` with `cmdStop: ${kill-tree}` (taskkill /T is refused on their
  process trees) and `healthCheckTimeout: 600`.
- Qwen3.6 on Strata was worse than llama.cpp (24-31 vs 46 tok/s) - use llama.cpp for normal GGUFs.

## 9. Other GPU users on this card

- **ComfyUI** (`D:\AIWorkspace\ComfyUI`, ROCm PyTorch): `pip install --index-url https://repo.amd.com/rocm/whl-multi-arch/
  "torch[device-gfx1031]==2.12.0+rocm7.14.1" "torchvision[device-gfx1031]==0.27.0+rocm7.14.1" "torchaudio==2.11.0+rocm7.14.1"`.
  No ZLUDA. MIOpen crashes on 1-D convs (audio VAEs) -> start via `launch_amd.py`. `~\.pi\comfyui.cmd` unloads
  llama-swap first. **LLM and ComfyUI can't share 12 GB** - always unload one.
- Games / OBS / Parsec hosting also eat VRAM; unload the model or expect a spill.

## 10. Pitfalls that cost hours

- `find /` from Git Bash walks every drive (one agent hung 3h45m). Search inside the project; put `timeout` on commands.
- A crashed server holding VRAM makes the next config "fail" - kill leftovers before blaming flags.
- Kill by PID/tree, not by name, when other llama-servers might be legit (ensure-server/kill-tree do it right).
- Near the VRAM edge, results flip between runs: always repeat.
- Reddit/YouTube claims ("IQ3 27B + 110K fully on 12 GB", "ncmoe 25", "-ngl 20") were wrong or slower here.
- CUDA-only features (`--moe-expert-cache`, cache forks) are untested/unsupported on HIP.
- `--split-mode row` failed on Kaggle 2x T4; `tensor` worked (off-PC, see models.md).
- Rejected, don't retry without a new build/reason: Flint 40B-A2.5B (Vulkan device-lost at 46K), Laguna XS 2.1
  (looped), vLLM on RDNA2, Avalon, Ollama, Unsloth 27B (no MTP head).
- Removed things (Flint, Laguna, PilotDeck, Avalon) stay removed unless Freddy asks.
