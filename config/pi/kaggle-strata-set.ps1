# Points Pi's "kaggle-strata" provider at the current Kaggle Strata session (strata-kaggle.ipynb).
# Separate from the "kaggle" provider (Qwen27 Q6_K), which pi-plan / pi-exec use.
# Usage: kaggle-strata-set <base-url> <api-key> [ctx]   ctx must match the notebook's CTX; default 65536.
param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][string]$Key, [int]$Ctx = 65536)
$ErrorActionPreference = "Stop"
$Url = $Url.TrimEnd("/"); if ($Url -notmatch "/v1$") { $Url += "/v1" }
$f = "$HOME\.pi\agent\models.json"
Copy-Item $f "$f.bak-kaggle-strata" -Force
$py = @'
import json, sys
f, url, key, ctx = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
j = json.load(open(f, encoding="utf-8"))
s = j["providers"]["strata"]
gyro = next(m for m in s["models"] if m["id"] == "qwen3.8-flash-next-gyro-s")
j["providers"]["kaggle-strata"] = {
    "baseUrl": url, "api": "openai-completions", "apiKey": key, "compat": s["compat"],
    "models": [{
        "id": "gyro-s",
        "name": f"Strata Qwen3.8-Flash-Next Gyro-S, {ctx // 1024}K (Kaggle 2x T4 via Cloudflare tunnel)",
        "reasoning": True, "input": ["text"], "contextWindow": ctx, "maxTokens": 16384,
        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
        "thinkingLevelMap": gyro["thinkingLevelMap"],
    }],
}
json.dump(j, open(f, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
'@
$py | python - $f $Url $Key $Ctx
if ($LASTEXITCODE) { Copy-Item "$f.bak-kaggle-strata" $f -Force; throw "models.json update failed, restored backup" }
try {
    $m = Invoke-RestMethod "$Url/models" -Headers @{Authorization = "Bearer $Key"} -TimeoutSec 20
    Write-Host "kaggle-strata -> $Url  (server reports: $($m.data.id -join ', '))"
} catch { Write-Warning "Saved, but the server didn't answer: $($_.Exception.Message)" }
