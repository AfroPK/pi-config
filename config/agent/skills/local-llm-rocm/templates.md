# Templates (copy, then replace <placeholders>)

## 1. Stand-alone launcher - `__PI_HOME__\llama\start-<name>.bat`

Full exe path (cmd can't find exes by name on this PC). Record the sweep in REM lines.

```bat
@echo off
REM <Model name> (<publisher>/<repo>, <quant>) - set up <yyyy-mm-dd>
REM Measured: <decode short> tok/s, <decode at depth> at <N>K, prompt <pp> tok/s, <VRAM> GB VRAM.
REM Sweep: <what was tried and why this config won>. Backup: *.bak-<yyyymmdd>-<what>
REM API: http://127.0.0.1:8080/v1   (llama-swap id / Pi: <provider>/<alias>)
setlocal
"__PI_HOME__\llama-mainline\b11869-rocm-th102\llama-server.exe" ^
 --host 127.0.0.1 --port 8080 --alias <alias> ^
 --model E:\models\<publisher>\<repo>\<file>.gguf ^
 --gpu-layers 99 --fit off --flash-attn on --parallel 1 --threads 6 ^
 --ctx-size <ctx> --cache-type-k q4_0 --cache-type-v q4_0 ^
 --spec-type draft-mtp --spec-draft-n-max 2 ^
 --jinja --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.0
REM MoE offload adds:  --n-cpu-moe <N> --load-mode none -b 2048 -ub 2048
REM No MTP head in the GGUF -> drop the two --spec-* flags.
echo [<alias>] Server exited with code %ERRORLEVEL%
pause
```

## 2. llama-swap entry - `C:\llama-swap\config.yaml` under `models:`

Macros already defined there: `${rocm}` (ROCm llama-server + host + `--port ${PORT}`), `${prism}` (Vulkan fork),
`${mtp2}`, `${qwen27-sampling}`, `${kill-tree}`.

```yaml
  # ---- <one-line note: model, placement, measured speed, date> ----
  "<alias>":
    cmd: >-
      ${rocm} --model E:\models\<publisher>\<repo>\<file>.gguf --gpu-layers 99 --fit off
      --ctx-size <ctx> --cache-type-k q4_0 --cache-type-v q4_0 --flash-attn on --parallel 1 --threads 6
      ${mtp2} --jinja --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.0
```

Non-llama.cpp servers (python wrappers) also need `cmdStop: ${kill-tree}`. Test the entry:

```bash
curl -s http://127.0.0.1:8080/upstream/<alias>/health      # loads / swaps, returns when ready
curl -s http://127.0.0.1:8080/v1/models | head -c 600
```

## 3. Benchmark one request (Git Bash + python)

```bash
cat > /tmp/bench.py <<'EOF'
import json, sys, time, urllib.request, uuid
alias, kind = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "code")
prompts = {
  "code": "Write a Python function that parses an INI file into nested dicts, with tests.",
  "prose": "Explain in 400 words how a CPU cache hierarchy works.",
}
body = {"model": alias, "max_tokens": 512, "temperature": 0.6,
        "messages": [{"role": "user", "content": f"[{uuid.uuid4()}] " + prompts[kind]}]}  # unique prefix = no cache hit
req = urllib.request.Request("http://127.0.0.1:8080/v1/chat/completions", json.dumps(body).encode(),
                             {"Content-Type": "application/json"})
t = time.time(); r = json.load(urllib.request.urlopen(req, timeout=900)); t = time.time() - t
tm = r.get("timings", {})
print(f"{alias} {kind}: decode {tm.get('predicted_per_second', 0):.1f} tok/s, "
      f"prompt {tm.get('prompt_per_second', 0):.0f} tok/s, wall {t:.1f}s, "
      f"draft accepted {tm.get('draft_n_accepted', '?')}/{tm.get('draft_n', '?')}")
EOF
python /tmp/bench.py <alias> code; python /tmp/bench.py <alias> code   # report the warm (2nd) run
```

For "decode at depth", prepend ~85-90% of the context as a long document to the prompt and watch Shared GPU memory
during the run (spill = ~0.9-1.0 GB shared).

## 4. Pi provider - `~\.pi\agent\models.json` (under `"providers"`)

```json
"<provider>": {
  "baseUrl": "http://127.0.0.1:8080/v1",
  "api": "openai-completions",
  "apiKey": "local",
  "compat": {
    "supportsDeveloperRole": false,
    "supportsReasoningEffort": false,
    "supportsUsageInStreaming": true,
    "maxTokensField": "max_tokens",
    "thinkingFormat": "chat-template",
    "chatTemplateKwargs": {
      "enable_thinking": { "$var": "thinking.enabled" },
      "preserve_thinking": true
    },
    "thinkingTokenBudgetField": "thinking_budget_tokens"
  },
  "models": [{
    "id": "<alias>", "name": "<human name, ctx, speed>",
    "reasoning": true, "input": ["text"],
    "contextWindow": <ctx>, "maxTokens": 16384,
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
  }]
}
```

Qwen3.8-27B/Swift instead: drop `thinkingTokenBudgetField`, add
`"reasoning_effort": { "$var": "thinking.effort", "omitWhenOff": true }` to chatTemplateKwargs and
`"thinkingLevelMap": {"minimal":"low","low":"low","medium":"medium","high":"xhigh","xhigh":"xhigh"}` to the model.
Then: add `"<provider>/<alias>"` to `enabledModels` in settings.json, run `pi --list-models`.

Launcher `~\.pi\pi-<name>.cmd`:

```bat
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Alias <alias>
if errorlevel 1 exit /b 1
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --model <provider>/<alias> %*
```

## 5. opencode provider - `~\.config\opencode\opencode.jsonc` (under `"provider"`)

```jsonc
"local": {
  "npm": "@ai-sdk/openai-compatible",
  "name": "Local llama-swap (RX 6750 XT)",
  "options": { "baseURL": "http://127.0.0.1:8080/v1", "apiKey": "local" },
  "models": {
    "<alias>": { "name": "<human name>", "tool_call": true, "reasoning": true,
                 "limit": { "context": <ctx>, "output": 16384 } }
  }
}
```

Use as `local/<alias>`. Load the model first (`ensure-server.ps1 -Alias <alias>` or the `/upstream/<alias>/health`
URL) so the first request doesn't time out during the 35-50 s swap.
