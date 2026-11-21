# Points Pi's "kaggle" provider at the current Kaggle llama-server session.
# The Quick Tunnel URL and API key change on every Kaggle restart; paste the new ones from cell 5.
# Usage: kaggle-set <base-url> <api-key> [ctx]   e.g. kaggle-set https://x-y-z.trycloudflare.com/v1 AbC123 131072
# ctx must match the notebook's CTX (cell 5 prints it); default 131072.
param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][string]$Key, [int]$Ctx = 131072)
$ErrorActionPreference = "Stop"
$Url = $Url.TrimEnd("/"); if ($Url -notmatch "/v1$") { $Url += "/v1" }
$f = "$HOME\.pi\agent\models.json"
Copy-Item $f "$f.bak-kaggle" -Force
$py = @'
import json, sys
f, url, key, ctx = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
j = json.load(open(f, encoding="utf-8"))
q = j["providers"]["qwen27"]
j["providers"]["kaggle"] = {
    "baseUrl": url, "api": "openai-completions", "apiKey": key, "compat": q["compat"],
    "models": [{
        "id": "qwen27-q6-mtp",
        "name": f"Qwen3.8 27B Unsloth UD-Q6_K + MTP, {ctx // 1024}K q8_0 (Kaggle 2x T4 tensor split via Cloudflare tunnel)",
        "reasoning": True, "input": ["text"], "contextWindow": ctx, "maxTokens": 16384,
        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
        "thinkingLevelMap": {"minimal": "low", "low": "low", "medium": "medium", "high": "xhigh", "xhigh": "xhigh"},
    }],
}
json.dump(j, open(f, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
'@
$py | python - $f $Url $Key $Ctx
if ($LASTEXITCODE) { Copy-Item "$f.bak-kaggle" $f -Force; throw "models.json update failed, restored backup" }
try {
    $m = Invoke-RestMethod "$Url/models" -Headers @{Authorization = "Bearer $Key"} -TimeoutSec 20
    Write-Host "kaggle -> $Url  (server reports: $($m.data.id -join ', '))"
} catch { Write-Warning "Saved, but the server didn't answer: $($_.Exception.Message)" }
