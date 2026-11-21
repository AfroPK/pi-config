# Per-model configs and measured results (RX 6750 XT 12 GB)

Live source of truth for the exact flags: `C:\llama-swap\config.yaml` (each entry mirrors a `start-*.bat`).
Speeds are decode tok/s unless marked pp (prompt). "Role" = what it's good for in Pi.

Macros used below: `ROCM` = b11869-rocm-th102 llama-server; `MTP2` = `--spec-type draft-mtp --spec-draft-n-max 2`;
`BASE` = `--gpu-layers 99 --fit off --flash-attn on --parallel 1 --threads 6 --jinja`.

## Summary table

| Alias (llama-swap / Pi id) | Model | Placement | Ctx / KV | Speed | Role |
|---|---|---|---|---|---|
| `ornith9b-q8` | Ornith 1.5 9B Q8_0 (has MTP head) | all VRAM | 80K q8 (96K q4 max) | **62 short**, 40 at 68K, pp 1156 | fastest; great executor, FAILS as planner |
| `swift27-xs-64k` | Swift 1.5 Qwen3.8-27B IQ2_XS-mtp | all VRAM | 48K q4 | 41 short, 31 at 37.5K, pp 134 | planner/reviewer; loops least |
| `qwen27-xs-64k` | ISTA Qwen3.8-27B IQ2_XS-mtp | all VRAM | 64K q4 | 35-39, pp 157-162 | planner (older default) |
| `qwen27-xs-40k` / `-s-40k` / `-s-24k` | ISTA 27B IQ2_XS / IQ2_S | all VRAM | 40K q8 / 40K q4 / 24K q8 | ~35-39 | variants |
| `swift27-iq3xxs` | Swift 27B IQ3_XXS-mtp (10.44 GB) | all VRAM | 22K q4 | 33-35 | short focused tasks only |
| `qwen3.6-antiloop-local` | Qwen3.6-35B-A3B AntiLoop i1-Q4_K_M (MTP head) | ncmoe 30 | 128K q4 | **46.7 short, 38.7 at 64K, 32 at 128K**, pp ~600-813 | long-context agent |
| `qwen3.6-iq3-local` | Qwen3.6-35B-A3B UD-IQ3_XXS | ncmoe 16 | 128K q4 | 40.1, pp 1398 | best executor in bench (10/10); fails as planner |
| `qwen3.6-q4km-local` | Qwen3.6-35B-A3B UD-Q4_K_M | ncmoe 28 | 128K q4 | ~27, 21 at 76K | thinks 22% less than IQ3 |
| `qwen3.8-35b-a3b-local` | Qwen3.8-35B-A3B Q4_K_M (prism Vulkan) | ncmoe 30 | 256K q4 | 37.5, 91 on rewrites | huge context |
| `bonsai2-27b-mtp` | Ternary Bonsai-2 27B PQ2_0-MTP (prism Vulkan) | all VRAM | 96K q4 | ~48, 80 on rewrites | needs prism fork |
| `nemotron-bolt-local` | Nemotron 3.5 Bolt 74B-A9B 24GB | auto fit | 32K q8 | 20.3, pp 476 | smart but 2x slower/wordier |
| `qwen35-9b-vision` | Qwen3.5-9B Q4_K_M + mmproj | all VRAM | 16K | 62 (no MTP) | vision checks |
| `qwen3.8-flash-next-gyro-gyro-s` (alias `qwen3.8-flash-next-gyro-s`) | Strata Gyro-S 125B MoE (HIP) + DFlash2 | Strata expert cache | 64K q4_0 | 31-36, pp ~480 | strongest local model |
| `xestrata-gyro-s` | same Gyro-S via XeStrata (SYCL) | expert cache | 128K q4_0 | 19.6, pp ~102 | 128K but slow prefill |

## Dense 27B (Qwen3.8-27B ISTA / Swift), all in VRAM

```
ROCM --model <...IQ2_XS-mtp.gguf> BASE --ctx-size 49152 --cache-type-k q4_0 --cache-type-v q4_0 MTP2
  --chat-template-kwargs "{\"reasoning_effort\":\"medium\"}" --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.0
```
- MTP n2 best (39 code / 34-36 prose / 42.5 rewrite). ngram lookup HURTS, ub 1024 hurts.
- Context limits without spill: IQ2_S q8 24K / q4 40K; IQ2_XS q8 40K / q4 64K (only ~0.25 GB left -> 48K chosen for Swift once dwm was 1.4 GB; 64K may fit again since Parsec's virtual display was disabled (dwm 641 MB) - re-run the spill test before raising it).
- IQ3_XXS: 22K q4 is the max that stays 33-35; 24K = 28, 32K flaky, 40K = 4.8. q8 unreliable above 16K. Partial CPU offload useless (dense).
- Unsloth's 27B GGUFs have no public MTP head.
- Thinking: Swift ~2x fewer tokens than ISTA on ambiguous prompts at medium; medium ~= xhigh in quality (benchmarked), so medium is default.

## Ornith 1.5 9B Q8_0

```
ROCM --model E:\models\ornith-ai\Ornith-1.5-9B-GGUF\Ornith-1.5-9B-Q8_0.gguf BASE --ctx-size 81920
  --cache-type-k q8_0 --cache-type-v q8_0 MTP2 --no-webui --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.0
```
- No MTP 37.8 / n1 53.3 / **n2 61.9** / n3 62.2. 11.4 GB at 80K q8; 96K q8 spills (5.4 tok/s); q4 96K max (112K spills).
- 16/16 on the reasoning bench in 129 s (fastest). Uses ~2x the output tokens of Swift. Ran `find /` once as executor.

## Qwen3.6-35B-A3B family (MoE, experts partly in RAM)

```
ROCM --model <gguf> --gpu-layers 99 --fit off --n-cpu-moe <N> --load-mode none --threads 6 --flash-attn on
  -b 2048 -ub 2048 --ctx-size 131072 --cache-type-k q4_0 --cache-type-v q4_0 --cache-ram 0 --parallel 1 --jinja
  [AntiLoop: MTP2]  [IQ3/Q4: --reasoning on --reasoning-budget 8192 --presence-penalty 1.5]
  --temp 0.6 --top-k 20 --top-p 0.95 --min-p 0.0
```
- **AntiLoop has an MTP head (blk.40.nextn.*)** - enabling it took 30.6 -> 46.7 tok/s short, 23.2 -> 38.7 at 64K. VRAM 10.1 GB, acceptance 86-90%. n-max 1 collapses to ~14 past 60K.
- IQ3_XXS sweep: ncmoe 25 30.9 / 20 35.1 / **16 40.1 (11.1 GB)** / 12 spills.
- Q4_K_M sweep: 30 26.6 / **28 ~27 (10.6 GB)** / 26 edge / <=25 spill (flaky). Needs ~13 GB free RAM.
- Overthinks ~7-9x vs Swift on reasoning; fine at thinking low as executor. Both variants loop / write code instead of PLAN.md as planner.
- CUDA-only "moe expert cache" forks are untested on HIP.

## Qwen3.8-35B-A3B (prism Vulkan, legacy)

```
PRISM --model E:\models\Qwen3.8-35B-A3B-Q4_K_M.gguf --gpu-layers 99 --n-cpu-moe 30 --threads 6 --flash-attn on
  --ctx-size 262144 --cache-type-k q4_0 --cache-type-v q4_0 --load-mode none
  --spec-type draft-mtp,ngram-simple --spec-draft-n-max 1 --spec-ngram-simple-size-n 16 --spec-ngram-simple-size-m 128
```
- 64K q8: ncmoe 25 = 39 tok/s / 348 pp until Parsec pushed dwm to 2.2 GB (dropped to 13) -> ncmoe 28 (41 short, 38 at 24K). Now 256K q4 ncmoe 30 = 37.5, 91 on rewrites. ub > 512 spilled at 64K.

## Bonsai-2 27B PQ2_0-MTP (prism Vulkan only)

- MTP n2 ~48 vs 34.7 without; 128K spills (13.6). 96K q4 is the setting. `--no-mmap`, ngram n16/m128 (rewrites 60 -> 80).
- Pi: thinking off by default - with thinking on, multi-turn follow-up prefill stalled at 7-14 tok/s.

## Nemotron 3.5 Bolt 74B-A9B (hybrid Mamba/MoE)

```
ROCM --model <...24GB.gguf> --ctx-size 32768 --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0
  --parallel 1 --threads 6 --load-mode none --batch-size 2048 --ubatch-size 2048 --jinja --temp 1.0 --top-p 0.95
```
- Video's command 10.9 / 124 -> `--load-mode none` 19.7 / 172 -> `-b/-ub 2048` 20.3 / 476. Auto placement beat manual ncmoe. Needs ~12 GB free RAM.

## Strata Gyro-S 125B (C:\Strata, self-built HIP, v0.2.11 / engine 0.1.57 + DFlash2)

- Config `C:\Strata\strata-gyro-gyro-s.json`: `--max-context 65536 --kv q4_0 --vram-reserve-mib 1536`, `"drafting": "dflash2"`;
  env `STRATA_HIP_PROMPT_F16=1 STRATA_RESIDENT_HEADROOM_GIB=6 STRATA_RESIDENT_PIN=0 STRATA_HC_PERSIST=1 STRATA_SELECT_SIMT=1 STRATA_ROCBLAS_TUNING=C:\Strata\tools\hip\gfx1031-rocblas-5.8.0.efafc1c1.txt`.
- History: 32K int8 467 pp / 28 tg -> + own rocBLAS table, HC_PERSIST (~+8% decode), SIMT: 495 / 33-36 -> 64K q4_0 480 / 30-32
  (1.2 GB free) -> 0.1.57 + DFlash2: warm code ~35.7 vs MTP ~30.7 (+16%, 83% vs 79% accepted). 7 workers (default) best:
  36.5; 5-6 = 34.2; 15 = 27.2. Headroom 4 instead of 6 = no gain. 39K and 57K needle PASS. 64K int8 dropped to 24-30 (<1 GB free).
- `drafting: auto` picks DFlash2 whenever the pack is in the data dir, so an A/B needs a separate data dir.
- Coder IQ1_M variant: same speed, no quality gain, garbled French -> deleted. Qwen3.6 GGUF on Strata: fp32 KV, 24-31 tok/s -> use llama.cpp.
- Data dir `C:\Strata\Strata-data` (must be on C:). Startup ~20 s from NVMe. Pi provider `strata`, thinkingFormat "openai".
- Rollback: `engine.bak-20261106`, `strata-gyro-gyro-s.json.bak-20261106`, git tag `pre-update-20261106`.

## XeStrata 0.2.2 (C:\XeStrata, SYCL port) - 3 required patches after every new release

1. Copy TheRock's `amdhip64_7.dll` (from `C:\Strata\.rocm-win\...\_rocm_sdk_core\bin`) onto PATH and the config's lib_dirs (Adrenalin ships only `amdhip64_6.dll`).
2. Patch setup.py `gpus_from_engine` to fall back to env `XESTRATA_AMD_GFX=gfx1031` (adapter reports empty arch).
3. Binary-patch `ur_adapter_hip.dll`: "gfx1031\0" at offset 74470 -> "gfx103X" (upstream hard-codes free memory 0 for gfx1031 -> 0 expert slots). Keep `.orig`.
- 64K: 22.7 tok/s, MTP accept ~78%. 128K q4_0: 19.6 tok/s, prefill only ~102 tok/s.

## Off-PC options

- **Kaggle 2x T4**: Qwen3.8-27B UD-Q6_K + `--model-draft` Unsloth MTP Q4_0, `--split-mode tensor` (row fails; tensor 13 -> 22.7 tok/s), MTP n2, 128K q8. ~27 tok/s short, 19 at 121K. Notebook `__PI_HOME__\kaggle-ollama\llama-kaggle.ipynb`; `kaggle-set <url> <key>` each session. Cloudflare quick tunnel drops requests idle > 100-120 s.
- **HomeLab GTX 1060 6 GB** (`ssh homelab`): Gemma 4 E2B vision on :8095 (socket-activated), whisper large-v3-turbo on :8020.

## Models that were rejected (don't retry without a new build/reason)
Flint 40B-A2.5B (slow, Vulkan device-lost at 46K), Laguna XS 2.1 (looped with thinking off), vLLM on RDNA2 (slower everywhere), Ollama on Kaggle (no MTP).
