// ask-guard: catches the model asking Freddy a question as plain reply text and
// forces it back through the ask_user_question tool.
//
// Why a guard at all: tool choice is probabilistic, and a question written in the
// answer body is easy to miss and cannot be answered with selectable options.
// The extension's promptGuidelines already say "never ask in plain text"; this is
// the runtime safety net for the times the model ignores them.
//
// How it works: at the actionable `turn_end` boundary, when a turn completed with
// no tool calls and its last prose line is a question, we append an
// extension-authored message telling the model to use the tool and request one
// continuation. The nudge is capped per user request so a stubborn model cannot
// loop.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MAX_NUDGES = 2;
const ASK_TOOL = "ask_user_question";
const NUDGE_TYPE = "ask-guard-nudge";

const FENCED_CODE = /```[\s\S]*?```/g;
const UNCLOSED_FENCE = /```[\s\S]*$/;
const INLINE_CODE = /`[^`\n]*`/g;
const MD_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const URL = /\bhttps?:\/\/\S+/g;
const XML_TAG = /<\/?[a-zA-Z][^>]*>/g;
// Quoted spans are removed before the "does it end with ?" test: "you asked
// 'should it be red?'" is the model summarising Freddy, not asking.
const QUOTED = /"[^"\n]*"|'[^'\n]*'|\u201c[^\u201d\n]*\u201d|\u2018[^\u2019\n]*\u2019/g;
// Trailing punctuation, quotes and emoji, so "Ready? 🙂" still counts as a question.
const TRAILING_DECORATION = /[\s)\]}*_`"'\u201d\u2019\ufe0f\u200d\u00a0\p{Extended_Pictographic}]+$/u;
// Questions about the user's own words, not requests for an answer.
const NOT_A_REQUEST =
	/^(?:you asked|you said|your question|the question|he asked|she asked|they asked)\b|^(?:q|question)\s*[:.\-]/i;

/** Remove everything that is not prose a human would read as a sentence. */
export function stripNonProse(text: string): string {
	return (text ?? "")
		.replace(FENCED_CODE, "\n")
		.replace(UNCLOSED_FENCE, "\n")
		.replace(INLINE_CODE, " ")
		.replace(MD_LINK, "$1")
		.replace(URL, " ")
		.replace(XML_TAG, " ");
}

/**
 * Returns the last prose line when the reply ends by asking a question, else null.
 * Precision over recall: a missed question only means no nudge, a false positive
 * costs an extra model turn.
 */
export function detectPlainTextQuestion(text: string): string | null {
	const prose = stripNonProse(text);
	const lines = prose
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return null;

	const last = lines[lines.length - 1];
	const unquoted = last.replace(QUOTED, " ").replace(TRAILING_DECORATION, "");
	if (!unquoted.endsWith("?")) return null;
	if (!/[a-z]/i.test(unquoted)) return null;
	if (NOT_A_REQUEST.test(unquoted)) return null;
	return last;
}

function assistantText(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block: any) => block?.type === "text" && typeof block.text === "string")
		.map((block: any) => block.text)
		.join("\n");
}

function toolCallNames(message: any): string[] {
	const content = message?.content;
	if (!Array.isArray(content)) return [];
	return content
		.filter((block: any) => block?.type === "toolCall")
		.map((block: any) => String(block?.name ?? ""));
}

function buildNudge(question: string): string {
	const shown = question.length > 300 ? `${question.slice(0, 297)}...` : question;
	return [
		"[ask-guard] Your previous reply asked Freddy a question as plain reply text:",
		`  ${shown}`,
		"A question written into the answer body is easy to miss and cannot be answered with options.",
		`If you still need the answer, call the ${ASK_TOOL} tool now: one question (the text above), options covering the plausible choices, your recommended one first with "(Recommended)" in its label. Then continue from the answer.`,
		"If you did not actually need input, remove the question and finish with your conclusion instead.",
		"Do not ask again in plain text.",
	].join("\n");
}

export default function askGuard(pi: ExtensionAPI) {
	let enabled = true;
	let nudges = 0;

	// One nudge budget per human message: the nudge itself is extension-authored,
	// so its follow-up turn never triggers this reset.
	pi.on("input", async () => {
		nudges = 0;
	});

	pi.on("turn_end", async (event: any, ctx: any) => {
		if (!enabled) return;
		if (event.outcome !== "completed") return;
		if (!ctx.hasUI) return; // no one to answer in -p / json modes
		if (event.message?.stopReason === "length") return; // truncated, not a real ending

		const results = Array.isArray(event.toolResults) ? event.toolResults : [];
		const calls = toolCallNames(event.message);
		// A turn that did work, or already asked the proper way, is not the case here.
		if (results.length > 0 || calls.length > 0) return;

		const question = detectPlainTextQuestion(assistantText(event.message));
		if (!question) return;

		let active: string[] = [];
		try {
			active = (pi.getActiveTools?.() as string[]) ?? [];
		} catch {
			active = [];
		}
		// Nudging toward a tool that is switched off would burn a turn for nothing.
		if (active.length > 0 && !active.includes(ASK_TOOL)) return;

		if (nudges >= MAX_NUDGES) {
			ctx.ui.notify(
				`ask-guard: the model asked in plain text again and was not nudged (limit ${MAX_NUDGES} per message).`,
				"warning",
			);
			return;
		}
		nudges += 1;
		ctx.ui.notify("ask-guard: plain-text question intercepted — asking the model to use ask_user_question.", "warning");

		return {
			entries: [
				...(Array.isArray(event.entries) ? event.entries : []),
				{ type: "custom_message", customType: NUDGE_TYPE, content: buildNudge(question), display: false },
			],
			continue: true,
		};
	});

	pi.registerCommand("ask-guard", {
		description: "Toggle the plain-text-question guard, or show its status.",
		handler: async (args: string, ctx: any) => {
			const value = (args ?? "").trim().toLowerCase();
			if (value === "off" || value === "false" || value === "0") {
				enabled = false;
			} else if (value === "on" || value === "true" || value === "1") {
				enabled = true;
			}
			ctx.ui.notify(
				`ask-guard ${enabled ? "ON" : "OFF"} — nudges used for this message: ${nudges}/${MAX_NUDGES}. Usage: /ask-guard [on|off]`,
				enabled ? "info" : "warning",
			);
		},
	});
}
