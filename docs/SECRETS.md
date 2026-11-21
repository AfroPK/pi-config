# Secrets and authentication

No live credential is stored in this repository. Keep it that way.

## Excluded credential stores

| Live location | Why excluded | Restore action |
|---|---|---|
| `~/.pi/agent/auth.json` | Pi provider API keys/OAuth credentials | Use `/login` inside Pi, or provider environment variables |
| `~/.pi/agent/mcp-auth.json` | MCP OAuth tokens | Use `/mcp`, select the server, and sign in if required |
| `~/.pi/agent/extensions/web-search/auth.json` | Google Custom Search credentials | Copy `auth.example.json`, then fill locally; environment variables are preferred |
| `~/.pi/agent/extensions/browser/.profile/` | Cookies and authenticated browser state | Sign in again in the restored browser profile |
| GitHub CLI keyring | `gh` authentication | Run `gh auth login` |
| Claude/Hermes credential stores | Claude subscription and plugin authentication | Sign in through the official Claude CLI |
| Application-specific credential stores | OmniRoute, Firecrawl, ComfyUI, etc. | Configure each application separately |

`.gitignore` blocks `auth.json`, `.env.local`, `secrets.env`, logs, sessions, and common generated dependency/state directories. `scripts/verify.py` provides an additional pre-commit scan, but no scanner is a substitute for reviewing `git diff --cached`.

## Required environment references in `models.json`

The capture process converted literal remote provider keys to these names:

| Variable | Provider | Notes |
|---|---|---|
| `OMNIROUTER_API_KEY` | `omnirouter` | Key for the OmniRoute endpoint at `localhost:20128` |
| `KAGGLE_API_KEY` | `kaggle` | Ephemeral key printed by the Qwen 27B Kaggle notebook |
| `KAGGLE_STRATA_API_KEY` | `kaggle-strata` | Ephemeral key printed by the Strata Kaggle notebook |
| `RD_API_KEY` | Retro Diffusion MCP | Used in the HTTP `Authorization: Bearer ${RD_API_KEY}` header |

The five local OpenAI-compatible providers use the intentionally non-secret dummy value `local`:

- `strata` at `http://127.0.0.1:8080/v1`;
- `qwen27` at `http://127.0.0.1:8080/v1`;
- `qwen36iq3` at `http://127.0.0.1:8080/v1`;
- `hipfire` at `http://127.0.0.1:8080/v1`;
- `inkling` at `http://127.0.0.1:8080/v1`.

OpenRouter is a built-in provider and has no key in `models.json`. Its normal authentication is in Pi's excluded `auth.json`.

## Set variables for one PowerShell session

Run these in the same terminal that will start Pi. `Read-Host` avoids putting key material in the command itself; omit services you do not use.

```powershell
$env:OMNIROUTER_API_KEY = Read-Host "OmniRoute API key"
$env:KAGGLE_API_KEY = Read-Host "Kaggle API key"
$env:KAGGLE_STRATA_API_KEY = Read-Host "Kaggle Strata API key"
$env:RD_API_KEY = Read-Host "Retro Diffusion API key"
pi
```

To persist a variable for future Windows sessions without writing the key into a script:

```powershell
[Environment]::SetEnvironmentVariable("RD_API_KEY", (Read-Host "Retro Diffusion API key"), "User")
```

Repeat only for required names, then open a new terminal. User-level environment variables are still local secret storage; protect the Windows account accordingly.

## Use the optional `.env.local` template in Git Bash

```bash
cp secrets.example.env .env.local
# Edit .env.local locally. It is ignored by git.
set -a
source .env.local
set +a
pi
```

This simple format is suitable for single-line values without shell-special formatting. Do not commit `.env.local` or echo its contents.

## Provider-specific sign-in

### OpenRouter (default provider)

Start `pi`, run `/login`, choose OpenRouter, and complete the flow. This also enables the `look` extension: it first checks `OPENROUTER_API_KEY`, then reads OpenRouter's key from Pi's local `auth.json`.

The configured default is `openrouter/deepseek/deepseek-v4.1-flash-1017`. Hosted model use may incur cost.

### OmniRoute

Install/run OmniRoute and configure its upstream providers separately. Set `OMNIROUTER_API_KEY` to the local router's key. The Pi snapshot contains the model aliases and endpoint, but not OmniRoute's application database or upstream credentials.

### Kaggle tunnels

Each notebook restart changes the tunnel URL and key. After restoring, the simplest update path is the included helper:

```powershell
kaggle-set <base-url> <api-key> [context]
kaggle-strata-set <base-url> <api-key> [context]
```

These scripts intentionally write the new literal key into the **live** `~/.pi/agent/models.json`, make a local backup, and test the endpoint. Running `scripts/capture.py` later converts those values back to environment references in the repository copy.

If you keep the repository's environment-reference form instead, ensure the relevant variable is set before using `pi-kaggle` or `pi-kaggle-strata`. `kaggle-check.ps1` expects the literal form produced by `kaggle-set`.

### Retro Diffusion

Set `RD_API_KEY` in Pi's process environment. The MCP configuration does not contain a literal token.

### Google Custom Search (optional `web_search` backend)

Set:

```text
GOOGLE_SEARCH_API_KEY
GOOGLE_CSE_ID
```

When both are present, the local web-search extension uses Google. Otherwise it falls back to Firecrawl. Alternatively copy `extensions/web-search/auth.example.json` to a local `auth.json` in that same installed extension directory and fill it; never commit the result.

### Claude CLI models

The `claude-cli` extension uses the official Claude CLI's existing subscription login, not a Pi API key. Install Claude Code and complete its normal sign-in, then verify:

```powershell
claude auth status
```

Hermes and its DirectSDK plugin must also be installed as described in the extension README and external-services guide.

### Firecrawl

The captured configuration points to a self-hosted Firecrawl instance on the LAN and does not require an API key in Pi. If using hosted Firecrawl instead, change the MCP environment/configuration and supply that service's credential through an environment reference rather than a committed literal.

## Credential hygiene during maintenance

1. Never copy `auth.json`, token caches, browser profiles, or session JSONL files into the repository.
2. Run `python scripts/capture.py`; it structurally sanitizes provider `apiKey` and authorization fields.
3. Run `python scripts/verify.py` and the unit tests.
4. Review `git status` and `git diff --cached` before committing.
5. If a real credential is ever committed, revoke/rotate it immediately. Deleting it in a later commit does not remove it from Git history or caches.
