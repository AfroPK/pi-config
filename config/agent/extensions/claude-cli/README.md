# claude-cli (Pi extension)

Claude models in Pi through the official Claude Code CLI, on your Claude subscription.

```
Pi ──OpenAI chat format──▶ shim.py (127.0.0.1:18766) ──▶ DirectSDK client ──▶ claude -p (one process per call) ──▶ Anthropic
```

- `shim.py` is a small local server built on the DirectSDK client from Hermes's official
  `claude-subscription-directsdk` plugin (MIT, Nous Research). It runs the unmodified `claude` CLI;
  Anthropic bills those calls to the subscription the CLI is logged into (Agent SDK allowance).
- Pi keeps its own agent loop and tools: Claude proposes tool calls, Pi runs them.
- The server remembers each reply's replay carrier and puts it back when Pi resends the history, so
  Claude's earlier turns (thinking blocks included) are replayed exactly. `shim.log` shows
  "replayed natively" counts; it never logs prompts or replies.
- `index.ts` registers provider `claude-cli` with `claude-fable-5-2`, `claude-opus-5-5`,
  `claude-sonnet-5-5`, `claude-haiku-5-5` (1M context; thinking can't be turned off, "off" = low effort)
  and starts the server before a request if it isn't running. The server exits after 2 h idle.

## Use

```
pi --model claude-cli/claude-opus-5-5
/model claude-cli/claude-sonnet-5-5
/claude-cli            # server status
/claude-cli restart    # restart the server
/claude-usage          # plan limits: session (5h) and weekly %, resets, extra usage
```

While a `claude-cli` model is selected, the footer shows `Claude 5h 74% · wk 14%`, refreshed after
each run and on model switch. The numbers come from Claude Code's own zero-inference `get_usage`
request (same data as `/usage` in Claude Code and Hermes), via the server's `GET /usage`
(cached 60 s; `?fresh=1` bypasses).

## Needs

- Hermes at `%LOCALAPPDATA%\hermes` with the DirectSDK plugin in `plugins/claude-subscription-directsdk`
  (the server runs on Hermes's venv Python and reads the plugin's settings from Hermes's
  `config.yaml`, e.g. `extra_usage: stop`). Override with `PI_CLAUDE_CLI_PYTHON`,
  `CLAUDE_CLI_DIRECTSDK_DIR`, `PI_CLAUDE_CLI_PORT`.
- `claude` logged in: `claude auth status`.
- After updating the Hermes plugin: `/claude-cli restart`.

Built 2026-11-20.
