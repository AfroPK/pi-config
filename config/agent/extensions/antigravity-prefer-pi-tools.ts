// antigravity-prefer-pi-tools: steers antigravity-acp models to call Pi's bridged
// MCP tools (`pi-bridge`) instead of Antigravity's built-in native tools.
//
// Why: pi-antigravity-acp-provider exposes Pi's tools via a lazy-loaded `pi-bridge`
// MCP server while keeping Antigravity's native tools eager. Without explicit
// guidance and inline core signatures, Antigravity models default to native
// `run_command` / `view_file` / `replace_file_content` / `ask_question`, bypassing
// Pi's guards (bash-guard, ask-guard, loop-police), Git Bash shell, and TUI history.
//
// Scope: injects `event.systemPromptOptions.sections.antigravity_pi_tools` ONLY
// when the active provider is `antigravity-acp` AND `AGY_ACP_BIN` is not pointing
// to native `agy` / `agy.exe` (native `agy acp` does not advertise HTTP MCP, so
// `pi-bridge` is not attached). Adds zero tokens to all other models.

import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TARGET_PROVIDER = "antigravity-acp";
const SECTION_KEY = "antigravity_pi_tools";

interface ToolMapping {
	piTool: string;
	replaces?: string;
	signature?: string;
}

const KNOWN_MAPPINGS: readonly ToolMapping[] = [
	{
		piTool: "read",
		replaces: "view_file",
		signature: "{ path: string, offset?: number, limit?: number }",
	},
	{
		piTool: "bash",
		replaces: "run_command",
		signature: "{ command: string, timeout?: number }",
	},
	{
		piTool: "edit",
		replaces: "replace_file_content",
		signature: "{ path: string, edits: [{ oldText: string, newText: string }] }",
	},
	{
		piTool: "write",
		replaces: "write_to_file",
		signature: "{ path: string, content: string }",
	},
	{
		piTool: "ask_user_question",
		replaces: "ask_question",
		signature:
			"{ question: string, details?: string, multiSelect?: boolean, options?: [{ label: string, description?: string, value?: string }] }",
	},
	{ piTool: "subagent", replaces: "invoke_subagent" },
	{ piTool: "subagents_list", replaces: "manage_subagents" },
	{ piTool: "subagent_stop", replaces: "manage_subagents" },
	{ piTool: "subagent_message", replaces: "send_message" },
	{ piTool: "web_search", replaces: "search_web" },
	{ piTool: "web_fetch", replaces: "read_url_content" },
	{ piTool: "generate_image", replaces: "generate_image" },
	{ piTool: "look" },
	{ piTool: "mcp" },
];

export function isNativeAntigravityBin(envValue: string | undefined): boolean {
	const trimmed = envValue?.trim();
	if (!trimmed) return false;
	const base = path.basename(trimmed.replace(/\\/g, "/")).toLowerCase();
	return base === "agy" || base === "agy.exe";
}

export function toBridgeToolName(piToolName: string): string {
	return `pi_${piToolName}`.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 64);
}

export function buildAntigravityPiToolsSection(selectedTools?: readonly string[]): string {
	const active = selectedTools && selectedTools.length > 0 ? new Set(selectedTools) : null;
	const mappings = active
		? KNOWN_MAPPINGS.filter((entry) => active.has(entry.piTool))
		: KNOWN_MAPPINGS;

	const lines: string[] = [
		"You are running inside Pi via Antigravity ACP with the `pi-bridge` MCP server attached.",
		"ALWAYS call Pi's tools through `call_mcp_tool` (`ServerName: \"pi-bridge\"`, `ToolName: \"pi_<name>\"`) instead of Antigravity's built-in native tools.",
		"Using `pi-bridge` ensures commands run in Pi's Git Bash environment and pass through Pi's guards, hooks, TUI, and session history.",
		"",
		"Required tool routing (do NOT call the native equivalents):",
	];

	for (const entry of mappings) {
		const bridgeName = toBridgeToolName(entry.piTool);
		const parts = [`- \`${bridgeName}\``];
		if (entry.replaces) parts.push(`instead of native \`${entry.replaces}\``);
		if (entry.signature) parts.push(`— Arguments: \`${entry.signature}\``);
		lines.push(parts.join(" "));
	}

	lines.push(
		"- Any other Pi tool `<name>` listed under `<tools>` (such as `ssh-*`, `davinci-resolve_*`, etc.): call `pi_<name>` via `call_mcp_tool` on `pi-bridge`. Read its schema file under the `pi-bridge` MCP directory once if its arguments are not listed above.",
		"- Only fall back to a native Antigravity tool if no matching `pi-bridge` tool exists or if `pi-bridge` explicitly fails.",
	);

	return lines.join("\n");
}

export default function antigravityPreferPiTools(pi: ExtensionAPI) {
	let enabled = true;

	pi.on("before_agent_start", (event, ctx) => {
		const sections = event.systemPromptOptions?.sections;
		if (!sections) return;

		if (!enabled || ctx.model?.provider !== TARGET_PROVIDER || isNativeAntigravityBin(process.env.AGY_ACP_BIN)) {
			delete sections[SECTION_KEY];
			return;
		}

		sections[SECTION_KEY] = buildAntigravityPiToolsSection(event.systemPromptOptions.selectedTools);
	});

	pi.registerCommand("antigravity-pi-tools", {
		description: "Toggle steering antigravity-acp models to use Pi's pi-bridge MCP tools (on|off)",
		handler: async (args, ctx) => {
			const value = (args ?? "").trim().toLowerCase();
			if (value === "off" || value === "false" || value === "0") {
				enabled = false;
			} else if (value === "on" || value === "true" || value === "1") {
				enabled = true;
			}
			const activeProvider = ctx.model?.provider ?? "unknown";
			const nativeAgy = isNativeAntigravityBin(process.env.AGY_ACP_BIN);
			let activeNote: string;
			if (activeProvider !== TARGET_PROVIDER) {
				activeNote = `idle (current provider: ${activeProvider})`;
			} else if (nativeAgy) {
				activeNote = "auto-skipped (AGY_ACP_BIN uses native agy, which does not attach pi-bridge)";
			} else {
				activeNote = "active on current antigravity-acp model";
			}
			ctx.ui.notify(
				`antigravity-pi-tools ${enabled ? "ON" : "OFF"} (${activeNote}). Usage: /antigravity-pi-tools [on|off]`,
				enabled && !nativeAgy ? "info" : "warning",
			);
		},
	});
}
