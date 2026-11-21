@echo off
REM Qwen3.6-35B-A3B unsloth UD-IQ3_XXS (13.2 GB) with MoE experts of the first 25 layers in system RAM - set up 2026-10-25
REM Source: Unbiased Bob "I was wrong about this" (youtube nZe5gAOr1wE). Flags below are his, verbatim, except
REM   host/port/alias (127.0.0.1:8080 like the other launchers, so ensure-server swaps it) and --fit off / --load-mode none.
REM ncmoe sweep (128K q4_0, ub 2048, 2026-10-25): 25 = 30.9 tok/s decode, 1261 pp, 8.8 GB VRAM | 20 = 35.1, 1340, 10.1 GB |
REM   16 = 40.1, 1398, 11.1 GB <- | 12 = SPILLS (31.6 decode, pp 318). Video used 25; our 12 GB card has room for 16.
REM   If Parsec/a game holds VRAM and speed drops, raise to 18-20.
REM Backend: ROCm build (b11869 win-rocm + TheRock 10.2 DLLs), see laguna-local-setup memory. No --no-host on ROCm.
REM API: http://127.0.0.1:8080/v1
setlocal
"__PI_HOME__\llama-mainline\b12445-rocm-th102\llama-server.exe" ^
 --host 127.0.0.1 ^
 --port 8080 ^
 --alias qwen3.6-iq3-local ^
 --model E:\models\unsloth\Qwen3.6-35B-A3B-GGUF\Qwen3.6-35B-A3B-UD-IQ3_XXS.gguf ^
 --ctx-size 131072 ^
 --gpu-layers 99 ^
 --fit off ^
 --n-cpu-moe 16 --moe-cache-mib 1000 ^
 --load-mode none ^
 --threads 6 ^
 --flash-attn on ^
 -b 2048 -ub 2048 ^
 --cache-type-k q4_0 --cache-type-v q4_0 ^
 --cache-ram 0 ^
 --parallel 1 ^
 --jinja ^
 --reasoning on --reasoning-budget 8192 ^
 --temp 0.6 --top-k 20 --top-p 0.95 --min-p 0.0 ^
 --presence-penalty 1.5 --repeat-penalty 1.0 ^
 --n-predict 32768
echo.
echo [qwen36-iq3] Server exited with code %ERRORLEVEL%
pause
