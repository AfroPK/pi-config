## Local session
This session runs a local model (XeStrata, Qwen3.8-Flash-Next Gyro-S) with a 128K-token context window, and `call_model` is not available. Handle every task yourself.
Reading new input is slow (~100 tokens/s): read files with offset/limit or grep for the part you need instead of whole large files, and keep command output short (pipe through head/tail).
