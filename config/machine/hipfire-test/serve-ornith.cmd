@echo off
setlocal
set "HIPFIRE_MODELS_DIR=E:\models\hipfire"
set "HIPFIRE_ROCM_PATH=D:\AIWorkspace\ComfyUI\venv\Lib\site-packages\_rocm_sdk_core"
set "HIPFIRE_HIPCC_EXTRA_FLAGS=--rocm-device-lib-path=D:/AIWorkspace/ComfyUI/venv/Lib/site-packages/_rocm_sdk_core/lib/llvm/amdgcn/bitcode -IC:/PROGRA~2/MICROS~4/2019/COMMUN~1/VC/Tools/MSVC/14.29.30133/include"
set "HIPFIRE_NO_REGISTRY_FETCH=1"
"__PI_HOME__\.hipfire\bin\hipfire.exe" serve --model ornith-1.5-9b.mq6 --spec mtp --max-seq 73728 --idle-timeout 0 127.0.0.1 %1
endlocal
