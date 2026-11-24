// antigravity-prefer-pi-tools: steers antigravity-acp models to call Pi's bridged
// MCP tools (`pi-bridge`) instead of Antigravity's built-in native tools.
//
// Why: pi-antigravity-acp-provider attaches Pi's tools via the `pi-bridge` HTTP MCP
// server while Antigravity keeps its own native tools declared too. Without explicit
// guidance, Antigravity models default to native shell/file/question tools, bypassing
// Pi's guards (bash-guard, ask-guard, loop-police), Git Bash shell, and TUI history.
//
// Runtime differences:
// - Native `agy` / `agy.exe` 1.5+ (`AGY_ACP_BIN`): exposes `pi-bridge` tools directly
//   as eager schema-bound functions named `mcp_pi-bridge_pi_<name>`.
// - Managed `agy_acp_server` (default when `AGY_ACP_BIN` is unset): exposes `pi-bridge`
//   tools lazily via `call_mcp_tool` (`ServerName: "pi-bridge"`, `ToolName: "pi_<name>"`).
//
// Scope: injects `event.systemPromptOptions.sections.antigravity_pi_tools` ONLY
// when the active provider is `antigravity-acp`, adding zero tokens to other models.

import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TARGET_PROVIDER = "antigravity-acp";
const SECTION_KEY = "antigravity_pi_tools";

interface ToolMapping {
	piTool: string;
	replacesServer?: string;
	replacesNativeAgy?: string;
	signature?: string;
}

const KNOWN_MAPPINGS: readonly ToolMapping[] = [
	{
		piTool: "read",
		replacesServer: "view_file",
		replacesNativeAgy: "read_file",
		signature: "{ path: string, offset?: number, limit?: number }",
	},
	{
		piTool: "bash",
		replacesServer: "run_command",
		replacesNativeAgy: "run_command",
		signature: "{ command: string, timeout?: number }",
	},
	{
		piTool: "edit",
		replacesServer: "replace_file_content",
		replacesNativeAgy: "edit_file",
		signature: "{ path: string, edits: [{ oldText: string, newText: string }] }",
	},
	{
		piTool: "write",
		replacesServer: "write_to_file",
		replacesNativeAgy: "write_file",
		signature: "{ path: string, content: string }",
	},
	{
		piTool: "ask_user_question",
		replacesServer: "ask_question",
		replacesNativeAgy: "ask_question",
		signature:
			"{ question: string, details?: string, multiSelect?: boolean, options?: [{ label: string, description?: string, value?: string }] }",
	},
	{ piTool: "subagent", replacesServer: "invoke_subagent", replacesNativeAgy: "invoke_subagent" },
	{ piTool: "subagents_list", replacesServer: "manage_subagents", replacesNativeAgy: "manage_subagents" },
	{ piTool: "subagent_stop", replacesServer: "manage_subagents", replacesNativeAgy: "manage_subagents" },
	{ piTool: "subagent_message", replacesServer: "send_message", replacesNativeAgy: "send_message" },
	{ piTool: "web_search", replacesServer: "search_web", replacesNativeAgy: "search_web" },
	{ piTool: "web_fetch", replacesServer: "read_url_content" },
	{ piTool: "generate_image", replacesServer: "generate_image" },
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

export function buildAntigravityPiToolsSection(
	selectedTools?: readonly string[],
	options?: { nativeAgy?: boolean },
): string {
	const nativeAgy = options?.nativeAgy ?? false;
	const active = selectedTools && selectedTools.length > 0 ? new Set(selectedTools) : null;
	const mappings = active
		? KNOWN_MAPPINGS.filter((entry) => active.has(entry.piTool))
		: KNOWN_MAPPINGS;

	if (nativeAgy) {
		const lines: string[] = [
			"You are running inside Pi via Antigravity ACP with the `pi-bridge` MCP server attached.",
			"ALWAYS call Pi's bridged MCP tools (`mcp_pi-bridge_pi_<name>`) instead of Antigravity's built-in native tools.",
			"Using `pi-bridge` ensures commands run in Pi's Git Bash environment and pass through Pi's guards, hooks, TUI, and session history.",
			"",
			"Required tool routing (do NOT call the native equivalents):",
		];

		for (const entry of mappings) {
			const directName = `mcp_pi-bridge_${toBridgeToolName(entry.piTool)}`;
			const parts = [`- \`${directName}\``];
			if (entry.replacesNativeAgy) parts.push(`instead of native \`${entry.replacesNativeAgy}\``);
			lines.push(parts.join(" "));
		}

		lines.push(
			"- Any other Pi tool `<name>` listed under `<tools>` (such as `ssh-*`, `davinci-resolve_*`, `firecrawl_*`, etc.): call `mcp_pi-bridge_pi_<name>` directly.",
			"- Only fall back to a native Antigravity tool if no matching `mcp_pi-bridge_pi_*` tool is declared or if `pi-bridge` explicitly fails.",
		);

		return lines.join("\n");
	}

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
		if (entry.replacesServer) parts.push(`instead of native \`${entry.replacesServer}\``);
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

		if (!enabled || ctx.model?.provider !== TARGET_PROVIDER) {
			delete sections[SECTION_KEY];
			return;
		}

		const nativeAgy = isNativeAntigravityBin(process.env.AGY_ACP_BIN);
		sections[SECTION_KEY] = buildAntigravityPiToolsSection(event.systemPromptOptions.selectedTools, {
			nativeAgy,
		});
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
				activeNote = "active on antigravity-acp (native agy direct mcp_pi-bridge_pi_* mode)";
			} else {
				activeNote = "active on antigravity-acp (agy_acp_server call_mcp_tool mode)";
			}
			ctx.ui.notify(
				`antigravity-pi-tools ${enabled ? "ON" : "OFF"} (${activeNote}). Usage: /antigravity-pi-tools [on|off]`,
				enabled ? "info" : "warning",
			);
		},
	});
}
