import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * claude-cli: Claude models in Pi through the official Claude Code CLI, on Freddy's Claude subscription.
 *
 * Pi talks OpenAI chat format to a small local server (shim.py, 127.0.0.1:18766). That server reuses the
 * DirectSDK client from Hermes's official `claude-subscription-directsdk` plugin, which runs one unmodified
 * `claude -p` process per model call. Anthropic bills those calls to the subscription the CLI is logged into
 * (its Agent SDK allowance). Pi keeps its own loop and tools: Claude proposes tool calls, Pi runs them.
 *
 * Needs: Hermes installed with the DirectSDK plugin (the shim uses Hermes's venv Python and reads the
 * plugin's settings, e.g. extra_usage: stop, from Hermes's config.yaml), and `claude` logged in
 * (`claude auth status`). The server starts on demand and exits after 2 h idle.
 *
 * /claude-cli shows its status; /claude-cli restart restarts the server.
 */

const PROVIDER = "claude-cli";
const PORT = Number(process.env.PI_CLAUDE_CLI_PORT || 18766);
const BASE = `http://127.0.0.1:${PORT}`;
const HERMES_HOME = process.env.HERMES_HOME || join(process.env.LOCALAPPDATA || "", "hermes");
const PYTHON = process.env.PI_CLAUDE_CLI_PYTHON || join(HERMES_HOME, "hermes-agent", "venv", "Scripts", "python.exe");
const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM = join(HERE, "shim.py");

// All four take a 1M context through the CLI. Thinking is mandatory on these models, so "off" sends the lowest effort.
const thinkingLevelMap = { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
const model = (id: string, name: string) => ({
  id,
  name,
  reasoning: true,
  input: ["text", "image"] as ("text" | "image")[],
  // Billed to the subscription, not per token.
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 64_000,
  thinkingLevelMap,
  compat: { supportsReasoningEffort: true, supportsDeveloperRole: false, supportsStore: false },
});

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

let starting: Promise<void> | null = null;
let lastOk = 0;

function startServer(): void {
  if (!existsSync(PYTHON)) throw new Error(`claude-cli: Hermes Python not found at ${PYTHON} (set PI_CLAUDE_CLI_PYTHON)`);
  const env = { ...process.env, HERMES_HOME };
  // The server must reach Anthropic only through the CLI's own login.
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const child = spawn(PYTHON, ["-I", SHIM, "--port", String(PORT)], {
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function ensureServer(): Promise<void> {
  if (Date.now() - lastOk < 10_000) return;
  if (await healthy()) {
    lastOk = Date.now();
    return;
  }
  if (!starting) {
    starting = (async () => {
      startServer();
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await healthy()) {
          lastOk = Date.now();
          return;
        }
      }
      throw new Error(`claude-cli: server did not start on ${BASE} (see ${join(HERE, "shim.log")})`);
    })().finally(() => {
      starting = null;
    });
  }
  await starting;
}

async function stopServer(): Promise<void> {
  // The server has no shutdown route; find its process by port and end it.
  await new Promise<void>((resolve) => {
    const ps = spawn(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: "ignore", windowsHide: true },
    );
    ps.on("exit", () => resolve());
    ps.on("error", () => resolve());
  });
  lastOk = 0;
}

type Usage = {
  ok: boolean;
  reason?: string | null;
  windows: { label: string; used_percent: number | null; resets_at: string | null }[];
  details: string[];
};

async function fetchUsage(fresh = false): Promise<Usage> {
  await ensureServer();
  const r = await fetch(`${BASE}/usage${fresh ? "?fresh=1" : ""}`, { signal: AbortSignal.timeout(20_000) });
  return (await r.json()) as Usage;
}

function resetIn(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return "";
  const m = Math.round(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}

const short = (label: string) =>
  label === "Current session" ? "5h" : label === "Current week" ? "wk" : label.replace(/ week$/, " wk");

function footer(u: Usage): string | undefined {
  if (!u.ok) return undefined;
  const parts = u.windows
    .filter((w) => w.used_percent != null && (w.label.startsWith("Current") || (w.used_percent as number) > 0))
    .map((w) => `${short(w.label)} ${Math.round(w.used_percent as number)}%`);
  return parts.length ? `Claude ${parts.join(" · ")}` : undefined;
}

function report(u: Usage): string {
  if (!u.ok) return `Claude plan usage unavailable: ${u.reason || "unknown reason"}`;
  const lines = u.windows.map((w) => {
    const used = w.used_percent == null ? "?" : `${Math.round(w.used_percent)}% used`;
    const left = w.used_percent == null ? "" : ` (${Math.round(100 - w.used_percent)}% left)`;
    const reset = resetIn(w.resets_at);
    return `${w.label}: ${used}${left}${reset ? ` · resets in ${reset}` : ""}`;
  });
  return ["Claude plan usage", ...lines, ...u.details].join("\n");
}

async function refreshFooter(ctx: any, fresh = false): Promise<void> {
  if (!ctx?.hasUI) return;
  if (ctx?.model?.provider !== PROVIDER) {
    ctx.ui.setStatus(PROVIDER, undefined);
    return;
  }
  try {
    ctx.ui.setStatus(PROVIDER, footer(await fetchUsage(fresh)));
  } catch {
    /* footer is best-effort */
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER, {
    name: "Claude (subscription via Claude Code CLI)",
    baseUrl: `${BASE}/v1`,
    apiKey: "local",
    api: "openai-completions",
    models: [
      model("claude-fable-5-2", "Claude Fable 5.2 (CLI)"),
      model("claude-opus-5-5", "Claude Opus 5.5 (CLI)"),
      model("claude-sonnet-5-5", "Claude Sonnet 5.5 (CLI)"),
      model("claude-haiku-5-5", "Claude Haiku 5.5 (CLI)"),
    ],
  } as any);

  // Start the server right before a request to one of these models (it may have exited while idle).
  pi.on("before_provider_request", async (_event, ctx: any) => {
    if (ctx?.model?.provider !== PROVIDER) return undefined;
    await ensureServer();
    return undefined;
  });

  pi.on("session_start", async (_event, ctx: any) => {
    if (ctx?.model?.provider === PROVIDER) ensureServer().then(() => refreshFooter(ctx)).catch(() => {});
  });

  // Footer: plan usage after each Claude run settles (fresh, since the run just used some), and on model switch.
  pi.on("agent_settled", async (_event, ctx: any) => {
    await refreshFooter(ctx, true);
  });
  pi.on("model_select", async (_event, ctx: any) => {
    await refreshFooter(ctx);
  });

  pi.registerCommand("claude-usage", {
    description: "Claude plan usage (session / weekly limits), asked of Claude Code itself",
    handler: async (_args: string, ctx: any) => {
      try {
        const u = await fetchUsage(true);
        ctx.ui.notify(report(u), u.ok ? "info" : "warning");
        if (ctx?.model?.provider === PROVIDER) ctx.ui.setStatus(PROVIDER, footer(u));
      } catch (e: any) {
        ctx.ui.notify(`claude-usage failed: ${e?.message || e}`, "error");
      }
    },
  });

  pi.registerCommand(PROVIDER, {
    description: "Status of the Claude Code CLI bridge; '/claude-cli restart' restarts its server",
    handler: async (args: string, ctx: any) => {
      if ((args || "").trim() === "restart") {
        await stopServer();
        await ensureServer();
        ctx.ui.notify(`claude-cli server restarted on ${BASE}`, "info");
        return;
      }
      const up = await healthy();
      ctx.ui.notify(
        up ? `claude-cli server running on ${BASE}` : `claude-cli server not running (starts on the next Claude request)`,
        up ? "info" : "warning",
      );
    },
  });
}
