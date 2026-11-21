@echo off
REM Qwen3.8-27B (dense, hybrid attention) ISTA-DASLab GSQ-RCO IQ2_XS + MTP head, FULLY in VRAM on RX 6750 XT 12GB - tuned 2026-10-25
REM Backend: official llama.cpp b11869 win-rocm-10.0 with TheRock ROCm 10.2 runtime DLLs + .kpack (from C:\Strata\engine\rocm)
REM   copied in - the bundled 10.0 runtime does not see gfx1031. ROCm beat Vulkan (PrismML) clearly:
REM   IQ2_S @ 7K/21K deep: ROCm 162/157 pp, 38.7/34.7 tg  vs  Vulkan 123/106 pp, 22.2/24.0 tg (Vulkan fits more ctx but is slower).
REM Max context with NO spill into RAM (--fit off, -ngl 99, filled to 90%, desktop on the GPU, ~1 GB):
REM   IQ2_S  (9.6 GB):  q8_0 24K (28K spills: pp 157 -> 122) | q4_0 40K (48K spills)
REM   IQ2_XS (8.8 GB):  q8_0 40K (11.73 GB at full fill)    | q4_0 64K (11.73 GB at full fill)
REM   For bigger files: --ctx-size 65536 with --cache-type-k/v q4_0 (writes ~25 tok/s at 60K deep vs ~28 at 37K).
REM   Both limits leave ~0.25 GB: if Parsec or a game holds VRAM, drop to 32K (q8_0) / 56K (q4_0).
REM Speculative (24K, speed.py + 628-token file rewrite), IQ2_S: none 27.5 code / 27.5 prose / 27.4 rewrite |
REM   MTP n-max 1: 35.3 / 33.0 / 35.2 | n-max 2: 39.4 / 35.8 / 42.8 <- | n-max 3: 34.9 / 29.1 / 41.0 |
REM   MTP2 + ngram-simple: rewrite drops to 33.4 (most lookup drafts rejected) -> no ngram on this model.
REM   IQ2_XS MTP2: 39.0 / 33.4 / 42.5, prompt 145 tok/s. ubatch 1024 hurts (pp 118), 256 = same as default 512.
REM THIS FILE: IQ2_XS, 64K, q4_0 cache: most context, for big files.
REM Thinking: Qwen template enable_thinking (Pi sends chat_template_kwargs). Sampling per Qwen coding guidance.
REM API: http://127.0.0.1:8080/v1   (Pi: qwen27/qwen27-xs-64k, or "pi-qwen27-xs-64k" / "pi-models qwen27-xs-64k")
REM Swift 1.5 (ukisai post-train of Qwen3.8-27B, claims 58.5% fewer thinking tokens) GSQ-RCO IQ2_XS+MTP - test copy 2026-10-26
REM Identical server config to start-qwen27-xs-64k.bat (see its notes) so the A/B compares models only.
REM 2026-10-31: context 64K -> 48K (alias kept so launchers still match). With the desktop's dwm at 1.4 GB, 64K spilled
REM   754 MB into shared memory and decode fell to ~1 tok/s. Backup: *.bak-20261031-swift48k. Same change in C:\llama-swap\config.yaml.
setlocal
"__PI_HOME__\llama-mainline\b11869-rocm-th102\llama-server.exe" ^
 --host 127.0.0.1 ^
 --port 8080 ^
 --alias swift27-xs-64k ^
 --model E:\models\ukisai\Swift-1.5-Qwen3.8-27B-GSQ-RCO-GGUF\Swift-1.5-Qwen3.8-27B-GSQ-RCO-IQ2_XS-mtp.gguf ^
 --gpu-layers 99 ^
 --fit off ^
 --ctx-size 49152 ^
 --cache-type-k q4_0 ^
 --cache-type-v q4_0 ^
 --flash-attn on ^
 --parallel 1 ^
 --threads 6 ^
 --spec-type draft-mtp ^
 --spec-draft-n-max 2 ^
 --jinja ^
 --chat-template-kwargs "{\"reasoning_effort\":\"medium\"}" ^
 --temp 0.6 ^
 --top-p 0.95 ^
 --top-k 20 ^
 --min-p 0.0
echo.
echo [swift27-xs-64k] Server exited with code %ERRORLEVEL%
pause
