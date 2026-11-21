## Local session
This session runs Strata Qwen3.8-Flash-Next Gyro-S on Kaggle (remote, 2x T4) with a 64K-token context window, and `call_model` is not available. Handle every task yourself.
Long cold prompts are slow to read: read files with offset/limit or grep for the part you need instead of whole large files, and keep command output short (pipe through head/tail).
