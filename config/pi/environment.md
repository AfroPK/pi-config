## This PC (fixed facts; check anything else yourself)
- Windows 11. The bash tool runs Git Bash (`/c/Users/...` and `C:/Users/...` both work; no WSL). Use forward slashes in paths.
- Python: `python` (3.12). There is no `python3` command.
- Lua: LuaJIT at `__PI_HOME__/AppData/Local/Programs/LuaJIT/bin/luajit.exe` (on PATH as `luajit`); there is no `lua` command. LuaJIT has no luasocket; LOVE does. LOVE 11.4: `__PI_HOME__/love2d/lovec.exe <game-folder>` (console build, prints Lua errors; always run it with `timeout`).
- Node: `node` (C:/Program Files/nodejs). git, curl and `timeout` are available in bash.
- Ports already in use, never bind them: 8080 (llama-swap, the model you are running on; killing it kills you), 3000-3003, 3080, 8384, 8889, 9222. Pick a port in 7000-7999 and test it is free with `netstat -ano | grep :PORT`.
- GUI programs (game engines, browsers) must always run with `timeout`, and never as part of a test suite.
- Never kill processes by name (node, python, lovec, llama*); you may only stop a process you started yourself.
- Web UI checks: the `look` tool (page=<html file>) opens it in Chrome at 1280 and 375 px and reports measured overflow (with the culprit element) and console errors, plus a small vision model's description. Planner/reviewers: use it on any HTML the plan creates or changes; a non-empty Measured section is a real bug.
