@echo off
REM ComfyUI (D:\AIWorkspace\ComfyUI, fresh clone 2026-11-02) on the RX 6750 XT with AMD's native ROCm PyTorch
REM (torch 2.12.0+rocm7.14.1 with the gfx1031 device package from repo.amd.com/rocm/whl-multi-arch).
REM ComfyUI and llama-swap share the 12 GB GPU: this unloads llama-swap's model first (llama-swap keeps running
REM and reloads a model on the next request, so don't run pi / pi-loop while generating images).
REM UI: http://127.0.0.1:8188   Models: D:\AIWorkspace\ComfyUI\models (SDXL base + pixel-art-xl LoRA + fp16-fix VAE)
curl -s -m 30 -X POST http://127.0.0.1:8080/api/models/unload >nul 2>&1 && echo [comfyui] unloaded llama-swap's model
cd /d D:\AIWorkspace\ComfyUI
start "" http://127.0.0.1:8188
venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188 %*
