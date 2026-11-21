// Renders the bash-guard confirmation dialog in a fake terminal and checks the
// fix for long commands: the Run/Abort list must always stay on screen.
//
//   node test/dialog-fit.test.mjs   (run from the extension directory)
//
// The extension file itself is loaded through jiti (with the same module aliases
// pi uses), so this exercises the real render code, not a copy of it.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function resolveFirst(candidates) {
	for (const candidate of candidates) {
		try {
			return require.resolve(candidate);
		} catch {
			// try the next one
		}
	}
	throw new Error(`could not resolve any of: ${candidates.join(", ")}`);
}

// pi-tui + jiti live inside the global pi install when the extension is loaded
// by pi itself; fall back to a normal resolution for a local install.
const PI_PKG = "__PI_HOME__/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent";
const PI_TUI = resolveFirst([
	"@earendil-works/pi-tui/dist/index.js",
	`${PI_PKG}/node_modules/@earendil-works/pi-tui/dist/index.js`,
]);
const JITI = resolveFirst(["jiti/lib/jiti.mjs", `${PI_PKG}/node_modules/jiti/lib/jiti.mjs`]);
const SHELL_QUOTE = resolveFirst([
	"shell-quote/index.js",
	join(import.meta.dirname, "..", "node_modules", "shell-quote", "index.js"),
]);

const { createJiti } = await import(pathToFileURL(JITI).href);

const SOURCE = join(import.meta.dirname, "..", "index.ts");
const WORK = mkdtempSync(join(tmpdir(), "bash-guard-test-"));
const STUB = join(WORK, "stub-pi.ts");
const PATCHED = join(WORK, "index.patched.ts");

const url = (p) => pathToFileURL(p).href;

writeFileSync(
	STUB,
	`export function isToolCallEventType(): boolean { return false; }

export class DynamicBorder {
	constructor(private color: (s: string) => string = (s) => s) {}
	invalidate(): void {}
	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}
`,
);

// pi resolves the old @mariozechner names to its own modules; point them at local files.
let source = readFileSync(SOURCE, "utf8");
source = source.replace(/^import type \{ ExtensionAPI \}.*$/m, "");
source = source.replaceAll('from "@mariozechner/pi-coding-agent"', `from ${JSON.stringify(url(STUB))}`);
source = source.replaceAll('from "@mariozechner/pi-tui"', `from ${JSON.stringify(url(PI_TUI))}`);
source = source.replaceAll('from "shell-quote"', `from ${JSON.stringify(url(SHELL_QUOTE))}`);
source += "\nexport { promptRunOrAbort };\n";
writeFileSync(PATCHED, source);

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { promptRunOrAbort } = await jiti.import(PATCHED);

const theme = { fg: (_color, text) => text, bold: (text) => text };

// Build the dialog, render it, then answer "abort" so the promise settles.
function render(command, reasons, width, termRows) {
	let component;
	const tui = { terminal: { rows: termRows, columns: width }, requestRender() {} };
	const ctx = {
		hasUI: true,
		ui: {
			custom: (factory) => {
				component = factory(tui, theme, { matches: () => false }, () => {});
				return Promise.resolve("abort");
			},
		},
	};
	return promptRunOrAbort(ctx, command, { severity: "medium", reasons }).then(() => ({
		tui,
		render: (w = width) => component.render(w),
	}));
}

let failures = 0;
function check(name, ok, detail = "") {
	if (ok) {
		console.log(`ok   ${name}`);
	} else {
		failures++;
		console.log(`FAIL ${name} ${detail}`);
	}
}

const REASONS = [
	"output redirection to /tmp/pr-body.md (writes outside the working directory)",
	"shell input redirection (questionable)",
];

function checkFits(name, lines, termRows) {
	const joined = lines.join("\n");
	check(`${name}: fits ${lines.length} <= ${termRows - 2}`, lines.length <= termRows - 2, `(got ${lines.length})`);
	check(`${name}: risk header kept`, joined.includes("Command flagged as MEDIUM risk:"));
	check(`${name}: reasons kept`, joined.includes("output redirection to /tmp/pr-body.md"));
	check(`${name}: Run visible`, joined.includes("Run"));
	check(`${name}: Abort visible`, joined.includes("Abort"));
	check(`${name}: top border visible`, lines[0].includes("──"));
	check(`${name}: bottom border visible`, lines[lines.length - 1].includes("──"));
	const abortRow = lines.findIndex((l) => l.includes("Abort"));
	check(`${name}: Abort above the bottom border`, abortRow === lines.length - 2, `(row ${abortRow}/${lines.length})`);
}

// The case that motivated the fix: a ~120-line heredoc PR body.
const heredocLines = ["cd D:/AIWorkspace/pi-ghost-text && cat > /tmp/pr-body.md <<'MSG'"];
for (let i = 0; i < 118; i++) heredocLines.push(`line ${i}: ${"word ".repeat(10)}`);
heredocLines.push("MSG");
const heredoc = heredocLines.join("\n");

let r = await render(heredoc, REASONS, 120, 40);
checkFits("heredoc/120x40", r.render(), 40);
check("heredoc: reports omitted lines", r.render().join("\n").includes("lines omitted"));
check("heredoc: keeps the head", r.render().join("\n").includes("cd D:/AIWorkspace"));
check("heredoc: keeps the tail", r.render().join("\n").includes("MSG"));

const short = "rm -f ./build/out.txt";
r = await render(short, REASONS, 120, 40);
checkFits("short/120x40", r.render(), 40);
check("short: full command shown", r.render().join("\n").includes(short));
check("short: no omission marker", !r.render().join("\n").includes("omitted"));

r = await render(`node -e "${"x".repeat(6000)}"`, REASONS, 120, 40);
checkFits("giant-line/120x40", r.render(), 40);
check("giant-line: marked truncated", r.render().join("\n").includes("truncated"));

const manyReasons = [
	"recursive delete (rm -r / -rf / -Rf)",
	"pipe into an interpreter/elevation command (possible remote code execution)",
	"output redirection to /tmp/pr-body.md (writes outside the working directory)",
	"git push --force",
	"chmod -R 777",
];
r = await render(heredoc, manyReasons, 100, 24);
checkFits("many-reasons/100x24", r.render(), 24);

// A terminal too short for the reasons plus any command: reasons must survive.
r = await render(heredoc, manyReasons, 100, 14);
checkFits("small-term/100x14", r.render(), 14);

const longWords = Array.from({ length: 40 }, (_, i) => `--flag${i}=${"v".repeat(60)}`).join(" ");
r = await render(`rm ${longWords}`, REASONS, 60, 30);
checkFits("narrow/60x30", r.render(), 30);

// Resizing must re-fit the body.
r = await render(heredoc, REASONS, 120, 40);
check("resize: tall window fits", r.render(120).length <= 38);
r.tui.terminal.rows = 20;
const shrunk = r.render(120);
check(`resize: shrunk window refits (${shrunk.length} <= 18)`, shrunk.length <= 18);
check("resize: list still visible", shrunk.join("\n").includes("Abort"));
r.tui.terminal.rows = 44;
const grown = r.render(120);
check("resize: grown window refits", grown.length <= 42, `(${grown.length})`);
check("resize: grown shows more", grown.length > shrunk.length, `(${grown.length} vs ${shrunk.length})`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
