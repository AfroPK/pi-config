// Checks the agent-desktop exemption through the real tool_call handler:
// agent-desktop commands never reach the Run/Abort prompt, the catastrophic
// hard-block floor still applies to them, and other commands still prompt.
//
//   node test/agent-desktop.test.mjs   (run from the extension directory)
//
// index.ts is copied to a temp dir with its pi imports replaced by stubs, then
// loaded with Node's built-in TypeScript type stripping.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = import.meta.dirname;
const shellQuote = pathToFileURL(join(here, "..", "node_modules", "shell-quote", "index.js")).href;

let src = readFileSync(join(here, "..", "index.ts"), "utf8");
src = src
	.replace(/^import type .*$/gm, "")
	.replace(/^import \{ DynamicBorder, isToolCallEventType \} .*$/m,
		"const DynamicBorder = class {}; const isToolCallEventType = (n, e) => e.toolName === n;")
	.replace(/^import \{ Container, SelectList, Text \} .*$/m,
		"const Container = class {}; const SelectList = class {}; const Text = class {};")
	.replace(/^import \{ parse as shellParse \} from \"shell-quote\";$/m,
		`import { parse as shellParse } from ${JSON.stringify(shellQuote)};`);

const dir = mkdtempSync(join(tmpdir(), "bash-guard-test-"));
const file = join(dir, "guard.ts");
writeFileSync(file, src);

delete process.env.PI_SUBAGENT_DEPTH;
const mod = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

let handler;
const pi = {
	on: (name, fn) => { if (name === "tool_call") handler = fn; },
	registerFlag: () => {},
	registerCommand: () => {},
	getFlag: () => false,
};
mod.default(pi);
assert.ok(handler, "tool_call handler registered");

// A UI whose dialog records that it was opened and answers "abort".
async function run(command) {
	let prompted = false;
	const ctx = {
		hasUI: true,
		ui: { custom: async () => { prompted = true; return "abort"; } },
	};
	const result = await handler({ toolName: "bash", input: { command } }, ctx);
	return { prompted, blocked: Boolean(result?.block) };
}

const cases = [
	// [command, expectPrompt, expectBlocked]
	["agent-desktop snapshot --app X -i | python -c \"import json,sys\"", false, false],
	["agent-desktop snapshot --app X -i > /tmp/calc.json", false, false],
	["cd \"$TEMP\"; agent-desktop snapshot --app X -i > __PI_HOME__/x.json", false, false],
	["AGENT_DESKTOP_AGENT_ID=a1 agent-desktop click @s1:e2", false, false],
	["agent-desktop.exe close-app notepad --force", false, false],
	["echo secret | agent-desktop set-value @s1:e2 --stdin", false, false],
	// Hard-block floor still applies when chained onto agent-desktop.
	["agent-desktop status && rm -rf build", false, true],
	["agent-desktop status; sudo reboot", false, true],
	// Not agent-desktop: still prompts as before.
	["ls | python -c \"print(1)\"", true, true],
	["rm notes.txt", true, true],
	["echo agent-desktop > /tmp/x", true, true],
	// Unflagged plain commands untouched.
	["ls -la", false, false],
];

let failed = 0;
for (const [command, expectPrompt, expectBlocked] of cases) {
	const r = await run(command);
	const ok = r.prompted === expectPrompt && r.blocked === expectBlocked;
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  prompt=${r.prompted} block=${r.blocked}  ${command}`);
}
if (failed) {
	console.error(`${failed} case(s) failed`);
	process.exit(1);
}
console.log("all agent-desktop cases passed");
