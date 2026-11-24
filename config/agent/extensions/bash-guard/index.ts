import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { SelectItem } from "@earendil-works/pi-tui";
import { Container, SelectList, Text } from "@earendil-works/pi-tui";
import { parse as shellParse } from "shell-quote";

type Severity = "high" | "medium";

type Risk = {
	severity: Severity;
	reasons: string[];
};

type OpToken = { op: string; [k: string]: unknown };

type Token = string | OpToken;

function isOpToken(t: Token): t is OpToken {
	return typeof t === "object" && t !== null && "op" in t;
}

function tokensToStrings(tokens: Token[]): string[] {
	return tokens.filter((t) => typeof t === "string") as string[];
}

function splitOnOps(tokens: Token[], splitOps: string[]): Token[][] {
	const out: Token[][] = [];
	let current: Token[] = [];
	for (const t of tokens) {
		if (isOpToken(t) && splitOps.includes(t.op)) {
			if (current.length) out.push(current);
			current = [];
			continue;
		}
		current.push(t);
	}
	if (current.length) out.push(current);
	return out;
}

// ---------------------------------------------------------------------------
// Local tuning (differs from upstream amosblomqvist/pi-config).
//
// Pipes and redirects are everyday shell usage, so only flag the shapes that
// can actually do damage: a redirect that escapes the working directory, or a
// pipe that feeds an interpreter / privilege-escalation command. All of the
// destructive rules further down are untouched.
// ---------------------------------------------------------------------------

const RISKY_REDIRECT_OPS = new Set([">", ">>"]);

// Commands that turn a pipe into code execution or privilege escalation.
const INTERPRETER_COMMANDS = new Set([
	"sh",
	"bash",
	"zsh",
	"fish",
	"dash",
	"ksh",
	"csh",
	"tcsh",
	"sudo",
	"doas",
	"su",
	"runas",
	"iex",
	"powershell",
	"pwsh",
	"cmd",
]);

// Commands that only execute piped input when given an inline-eval flag.
const INLINE_EVAL_COMMANDS = new Set([
	"python",
	"python3",
	"node",
	"deno",
	"bun",
	"perl",
	"ruby",
	"php",
]);

const INLINE_EVAL_FLAGS = new Set(["-c", "-e", "--eval", "-p", "-E"]);

function commandBasename(value: string): string {
	const base = value.replace(/\\/g, "/").split("/").pop() ?? value;
	return base.replace(/\.(exe|cmd|bat|ps1|com)$/i, "").toLowerCase();
}

function isRiskyRedirectTarget(target: string): boolean {
	const value = target.trim().replace(/^["']|["']$/g, "");
	if (!value) return true;
	// Discarding output is always safe.
	if (/^\/dev\/(null|stdout|stderr|tty)$/i.test(value)) return false;
	if (/^nul$|^nul:$/i.test(value)) return false;
	if (value.startsWith("~")) return true;
	if (value.startsWith("..")) return true;
	if (value.startsWith("/") || value.startsWith("\\")) return true;
	// Drive-letter paths are never the cwd, and shell-quote eats the backslashes
	// in `> C:\Windows\...`, so match on the prefix alone.
	if (/^[a-z]:/i.test(value)) return true;
	if (/windows[\\/]/i.test(value)) return true;
	return false;
}

function findRiskyRedirections(tokens: Token[]): string[] {
	const targets: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!isOpToken(token) || !RISKY_REDIRECT_OPS.has(token.op)) continue;
		const next = tokens[i + 1];
		if (typeof next === "string" && isRiskyRedirectTarget(next)) {
			targets.push(next);
		}
	}
	return [...new Set(targets)];
}

function hasInterpreterPipe(tokens: Token[]): boolean {
	const segments = splitOnOps(tokens, ["|"]);
	for (let i = 1; i < segments.length; i++) {
		const args = tokensToStrings(segments[i]);
		if (args.length === 0) continue;
		const cmd = commandBasename(args[0]);
		const rest = args.slice(1);
		if (INTERPRETER_COMMANDS.has(cmd)) return true;
		if (cmd === "xargs" && rest.some((a) => INTERPRETER_COMMANDS.has(commandBasename(a)))) {
			return true;
		}
		if (INLINE_EVAL_COMMANDS.has(cmd) && rest.some((a) => INLINE_EVAL_FLAGS.has(a))) {
			return true;
		}
	}
	return false;
}

// Read-only git subcommands prompt-free; anything that can move or drop state
// still prompts. High-risk escalations below apply regardless.
const GIT_READ_ONLY_SUBCOMMANDS = new Set([
	"status",
	"diff",
	"log",
	"show",
	"blame",
	"grep",
	"shortlog",
	"whatchanged",
	"rev-parse",
	"describe",
	"ls-files",
	"ls-tree",
	"fetch",
	"branch",
	"tag",
	"stash",
	"remote",
	"config",
	"help",
	"version",
]);

function gitIsReadOnly(sub: string | undefined, args: string[]): boolean {
	if (!sub) return false;
	if (!GIT_READ_ONLY_SUBCOMMANDS.has(sub)) return false;
	if (sub === "branch") {
		return !args.some((a) =>
			/^(-d|-D|-m|-M|-c|-C|-f|--delete|--move|--copy|--force|--set-upstream-to|--unset-upstream)$/.test(
				a,
			),
		);
	}
	if (sub === "tag") {
		return !args.some((a) => a === "-d" || a === "--delete" || a === "-f" || a === "--force");
	}
	if (sub === "stash") {
		return args.length === 0 || ["list", "show", "ls"].includes(args[0] ?? "");
	}
	if (sub === "remote") {
		return args.length === 0 || ["-v", "show", "get-url"].includes(args[0] ?? "");
	}
	if (sub === "config") {
		return args.some((a) => a === "--get" || a === "--get-all" || a === "--list" || a === "-l");
	}
	return true;
}

function hasFlag(args: string[], flag: string): boolean {
	return args.includes(flag) || args.some((a) => a.startsWith(flag) && flag.length === 2 && a.startsWith("-"));
}

function anyArgStartsWith(args: string[], prefix: string): boolean {
	return args.some((a) => a.startsWith(prefix));
}

function analyzeSegment(seg: Token[]): Risk | null {
	const reasons: string[] = [];
	let severity: Severity = "medium";

	const ops = seg.filter(isOpToken).map((o) => o.op);
	const args = tokensToStrings(seg);
	if (args.length === 0) return null;

	const cmd = args[0];
	const rest = args.slice(1);

	// Shell redirection / pipes are handled on the whole command, but keep some segment checks too.
	if (ops.includes("|") && (args.includes("sh") || args.includes("bash") || args.includes("zsh") || args.includes("fish"))) {
		reasons.push("pipe to a shell (possible remote code execution)");
		severity = "high";
	}

	// sudo
	if (cmd === "sudo") {
		reasons.push("sudo (elevated privileges)");
		severity = "high";
	}

	// rm/rmdir/unlink
	if (cmd === "rm" || cmd === "rmdir" || cmd === "unlink") {
		severity = "high";
		reasons.push(`${cmd} (file deletion)`);
		if (rest.some((a) => a.includes("-r") || a.includes("-R"))) reasons.push("recursive delete (-r/-R)");
		if (rest.some((a) => a.includes("-f"))) reasons.push("forced delete (-f)");
		if (ops.includes("glob")) reasons.push("glob pattern expansion (may delete many files)");
	}

	// find -delete
	if (cmd === "find" && rest.includes("-delete")) {
		severity = "high";
		reasons.push("find -delete (bulk deletion)");
	}

	// git operations: read-only subcommands pass, anything that mutates prompts
	if (cmd === "git") {
		const sub = rest[0];
		const subArgs = rest.slice(1);

		if (!gitIsReadOnly(sub, subArgs)) {
			reasons.push(sub ? `git ${sub} (git command that changes state)` : "git (git command)");
		}

		if (sub === "rm") {
			severity = "high";
			reasons.push("git rm (deletes files from working tree and stages deletions)");
		}
		if (sub === "clean" && (subArgs.some((a) => a.includes("-f")) || subArgs.includes("-d") || subArgs.includes("-x"))) {
			severity = "high";
			reasons.push("git clean (can delete untracked files)");
		}
		if (sub === "reset" && subArgs.includes("--hard")) {
			severity = "high";
			reasons.push("git reset --hard (discard changes)");
		}
		if ((sub === "checkout" || sub === "restore") && (subArgs.includes(".") || subArgs.includes("--") || subArgs.includes("--source"))) {
			severity = severity === "high" ? "high" : "medium";
			reasons.push("git checkout/restore (can overwrite working tree)");
		}
		if (sub === "push" && (subArgs.includes("--force") || subArgs.includes("--force-with-lease") || subArgs.includes("-f"))) {
			severity = "high";
			reasons.push("git push --force (rewrite remote history)");
		}
		if (sub === "reflog" && subArgs.includes("expire")) {
			severity = "high";
			reasons.push("git reflog expire (can remove recovery history)");
		}
		if (sub === "gc" && subArgs.some((a) => a.startsWith("--prune"))) {
			severity = "high";
			reasons.push("git gc --prune (can permanently delete objects)");
		}
	}

	// truncate
	if (cmd === "truncate") {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("truncate (in-place size change, can erase contents)");
	}

	// dd of=
	if (cmd === "dd" && (anyArgStartsWith(rest, "of=") || rest.includes("of"))) {
		severity = "high";
		reasons.push("dd with output file/device (can overwrite data)");
	}

	// Disk / volume management (prompt aggressively; high risk)
	// Linux: mkfs.*, wipefs, parted, fdisk, gdisk/sgdisk, lsblk, cryptsetup, LVM tools, zpool
	// macOS: diskutil, hdiutil, gpt, newfs_*, asr
	if (cmd.startsWith("mkfs")) {
		severity = "high";
		reasons.push("mkfs (filesystem formatting)");
	}
	if (cmd.startsWith("newfs_")) {
		severity = "high";
		reasons.push("newfs_* (filesystem formatting)");
	}
	if (cmd === "wipefs") {
		severity = "high";
		reasons.push("wipefs (disk signature wipe)");
	}
	if (cmd === "diskutil") {
		severity = "high";
		reasons.push("diskutil (disk management command)");
		if (rest.includes("eraseDisk") || rest.includes("eraseVolume")) {
			reasons.push("diskutil erase (destructive disk operation)");
		}
	}
	if (cmd === "hdiutil") {
		severity = "high";
		reasons.push("hdiutil (disk image management command)");
	}
	if (cmd === "gpt") {
		severity = "high";
		reasons.push("gpt (partition table manipulation)");
	}
	if (cmd === "asr") {
		severity = "high";
		reasons.push("asr (Apple Software Restore; can overwrite volumes)");
	}
	if (cmd === "parted" || cmd === "fdisk" || cmd === "gdisk" || cmd === "sgdisk") {
		severity = "high";
		reasons.push(`${cmd} (disk/partition management)`);
	}
	if (cmd === "lsblk") {
		// Usually read-only, but still disk-related; prompt as requested.
		severity = severity === "high" ? "high" : "medium";
		reasons.push("lsblk (disk listing)");
	}
	if (cmd === "cryptsetup") {
		severity = "high";
		reasons.push("cryptsetup (disk encryption management)");
	}
	if (cmd === "pvcreate" || cmd === "vgcreate" || cmd === "lvcreate") {
		severity = "high";
		reasons.push(`${cmd} (LVM volume management)`);
	}
	if (cmd === "zpool") {
		severity = "high";
		reasons.push("zpool (ZFS pool management)");
	}

	// chmod/chown recursive
	if (cmd === "chmod" && (rest.includes("-R") || rest.includes("--recursive"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("chmod -R (recursive permission changes)");
	}
	if (cmd === "chown" && (rest.includes("-R") || rest.includes("--recursive"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("chown -R (recursive ownership changes)");
	}

	// mv/cp overwriting
	if (cmd === "mv" && (rest.includes("-f") || rest.includes("--force"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("mv --force/-f (can overwrite files)");
	}
	if (cmd === "cp" && (rest.includes("-f") || rest.includes("--force"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("cp --force/-f (can overwrite files)");
	}

	// sed/perl in-place
	if (cmd === "sed" && (hasFlag(rest, "-i") || rest.includes("--in-place"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("sed -i (in-place file modification)");
	}
	if (cmd === "perl" && (rest.includes("-pi") || (rest.includes("-p") && rest.includes("-i")))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("perl -pi/-i (in-place file modification)");
	}

	// kill/shutdown/systemctl
	if (cmd === "kill" || cmd === "pkill" || cmd === "killall") {
		severity = severity === "high" ? "high" : "medium";
		reasons.push(`${cmd} (process termination)`);
		if (rest.includes("-9")) {
			severity = "high";
			reasons.push("SIGKILL (-9)");
		}
	}
	if (cmd === "shutdown" || cmd === "reboot") {
		severity = "high";
		reasons.push(`${cmd} (system power operation)`);
	}
	if (cmd === "systemctl" && (rest.includes("stop") || rest.includes("disable"))) {
		severity = severity === "high" ? "high" : "medium";
		reasons.push("systemctl stop/disable (service disruption)");
	}

	// Remote execution patterns
	if ((cmd === "curl" || cmd === "wget") && ops.includes("|")) {
		severity = "high";
		reasons.push("curl/wget piped (possible remote code execution)");
	}

	// Infra deletes
	if (cmd === "kubectl" && rest[0] === "delete") {
		severity = "high";
		reasons.push("kubectl delete (resource deletion)");
	}
	if (cmd === "terraform" && rest[0] === "destroy") {
		severity = "high";
		reasons.push("terraform destroy (infrastructure teardown)");
	}
	if (cmd === "aws" && rest[0] === "s3" && rest[1] === "rm" && rest.includes("--recursive")) {
		severity = "high";
		reasons.push("aws s3 rm --recursive (bulk deletion)");
	}
	if (cmd === "gcloud" && rest.includes("delete")) {
		severity = "high";
		reasons.push("gcloud delete (resource deletion)");
	}

	if (reasons.length === 0) return null;
	return { severity, reasons };
}

function analyzeBashCommand(command: string): Risk | null {
	let tokens: Token[];
	try {
		tokens = shellParse(command) as Token[];
	} catch {
		// Fallback: if we can't parse, treat it as questionable
		return { severity: "medium", reasons: ["unparsed shell command (unable to analyze safely)"] };
	}

	const reasons: string[] = [];
	let severity: Severity = "medium";

	// Whole-command operator checks
	const ops = tokens.filter(isOpToken).map((t) => t.op);
	const riskyRedirections = findRiskyRedirections(tokens);
	if (riskyRedirections.length > 0) {
		reasons.push(
			`output redirection to ${riskyRedirections.join(", ")} (writes outside the working directory)`,
		);
		severity = severity === "high" ? "high" : "medium";
	}
	if (ops.includes("<")) {
		reasons.push("shell input redirection (questionable)");
	}
	if (hasInterpreterPipe(tokens)) {
		reasons.push("pipe into an interpreter/elevation command (possible remote code execution)");
		severity = "high";
	}

	// Segment analysis (split on &&, ||, ;)
	const segments = splitOnOps(tokens, ["&&", "||", ";"]);
	for (const seg of segments) {
		const segRisk = analyzeSegment(seg);
		if (!segRisk) continue;
		if (segRisk.severity === "high") severity = "high";
		for (const r of segRisk.reasons) reasons.push(r);
	}

	// De-duplicate reasons
	const uniq = [...new Set(reasons)];
	if (uniq.length === 0) return null;
	return { severity, reasons: uniq };
}

// Freddy's choice: desktop control through agent-desktop must never stop for a
// Run/Abort prompt. A command that invokes agent-desktop anywhere (any segment
// or pipeline stage) skips the interactive prompt; the catastrophic hard-block
// floor (MAIN_DISABLED_BLOCKED) still applies to it, so `agent-desktop x; rm -rf y`
// is still refused.
function usesAgentDesktop(command: string): boolean {
	let tokens: Token[];
	try {
		tokens = shellParse(command) as Token[];
	} catch {
		return false;
	}
	for (const seg of splitOnOps(tokens, ["&&", "||", ";", "|", "&"])) {
		const args = tokensToStrings(seg);
		// Skip leading VAR=value assignments (e.g. AGENT_DESKTOP_AGENT_ID=a agent-desktop ...).
		const first = args.find((a) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a));
		if (first && /^agent-desktop(-win32-x64)?$/.test(commandBasename(first))) return true;
	}
	return false;
}

// Long commands (heredocs, generated PR bodies) used to push the Run/Abort list
// off the bottom of the terminal, leaving no visible way to answer. The dialog
// therefore shows a head+tail excerpt that always leaves room for the list.
function truncateCommandLines(command: string, maxLines: number): string {
	const lines = command.replace(/\r\n/g, "\n").split("\n");
	if (lines.length <= maxLines) return command;
	if (maxLines <= 1) return `${lines[0]} … (${lines.length - 1} more lines)`;
	const tailCount = Math.min(3, Math.floor((maxLines - 1) / 2));
	const headCount = maxLines - 1 - tailCount;
	const head = lines.slice(0, headCount);
	const tail = tailCount > 0 ? lines.slice(lines.length - tailCount) : [];
	const omitted = lines.length - head.length - tail.length;
	return [...head, `… (${omitted} lines omitted) …`, ...tail].join("\n");
}

function dialogBody(header: string, reasonsText: string, command: string): string {
	return `${header}\n\n${reasonsText}\n\nCommand:\n${command}`;
}

async function promptRunOrAbort(ctx: any, command: string, risk: Risk): Promise<"run" | "abort"> {
	if (!ctx.hasUI) return "abort";

	const reasonsText = risk.reasons.map((r) => `• ${r}`).join("\n");
	const header = `Command flagged as ${risk.severity.toUpperCase()} risk:`;

	const items: SelectItem[] = [
		{ value: "run", label: "Run", description: "Execute the command" },
		{ value: "abort", label: "Abort", description: "Block this command" },
	];

	const choice = await ctx.ui.custom<"run" | "abort">((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("warning", s)));
		const titleText = new Text(
			theme.fg("warning", theme.bold("Potentially destructive bash command")),
			1,
			0,
		);
		container.addChild(titleText);

		const bodyText = new Text(dialogBody(header, reasonsText, command), 1, 0);
		container.addChild(bodyText);

		const list = new SelectList(items, items.length, {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		});

		list.onSelect = (item) => done(item.value as "run" | "abort");
		list.onCancel = () => done("abort");
		container.addChild(list);

		container.addChild(new DynamicBorder((s: string) => theme.fg("warning", s)));

		// Stand-in component used to measure how many rows a given text needs.
		const probe = new Text("", 1, 0);
		const rowsFor = (text: string, width: number): number => {
			probe.setText(text);
			probe.invalidate();
			return probe.render(width).length;
		};

		const termRows = (): number => Number(tui.terminal?.rows ?? 0) || 24;
		const commandLines = command.replace(/\r\n/g, "\n").split("\n").length;

		// Body text that still leaves room for the title, the list and both borders.
		// Two rows are kept free so the dialog never covers the input box or status line.
		const fitBody = (width: number): string => {
			const chromeRows = 2 + titleText.render(width).length + list.render(width).length;
			const budget = Math.max(1, termRows() - 2 - chromeRows);
			const bodyFor = (maxLines: number) =>
				dialogBody(header, reasonsText, truncateCommandLines(command, maxLines));

			if (rowsFor(bodyFor(commandLines), width) <= budget) return bodyFor(commandLines);

			let best = 0;
			let lo = 1;
			let hi = commandLines;
			while (lo <= hi) {
				const mid = Math.floor((lo + hi) / 2);
				if (rowsFor(bodyFor(mid), width) <= budget) {
					best = mid;
					lo = mid + 1;
				} else {
					hi = mid - 1;
				}
			}
			if (best > 0) return bodyFor(best);

			// A single very long line (e.g. `node -e "..."`): cut it by characters.
			const firstLine = command.replace(/\r\n/g, "\n").split("\n")[0];
			let chars = 0;
			let low = 0;
			let high = firstLine.length;
			while (low <= high) {
				const mid = Math.floor((low + high) / 2);
				const candidate = `${firstLine.slice(0, mid)} … (truncated)`;
				if (rowsFor(dialogBody(header, reasonsText, candidate), width) <= budget) {
					chars = mid;
					low = mid + 1;
				} else {
					high = mid - 1;
				}
			}
			if (chars > 0) return dialogBody(header, reasonsText, `${firstLine.slice(0, chars)} … (truncated)`);

			// Terminal too short for any command text: keep the risk reasons, which
			// are what the decision actually needs.
			const reasonsOnly = `${header}\n\n${reasonsText}`;
			return rowsFor(reasonsOnly, width) <= budget ? reasonsOnly : "(command too long to display)";
		};

		let fittedWidth: number | undefined;
		let fittedRows: number | undefined;
		const ensureFitted = (width: number): void => {
			if (fittedWidth === width && fittedRows === termRows()) return;
			bodyText.setText(fitBody(width));
			bodyText.invalidate();
			fittedWidth = width;
			fittedRows = termRows();
		};

		return {
			render: (w) => {
				ensureFitted(w);
				return container.render(w);
			},
			invalidate: () => {
				fittedWidth = undefined;
				container.invalidate();
			},
			handleInput: (data) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true });

	return choice ?? "abort";
}

// PI_SUBAGENT_DEPTH is 0 (or unset) in the main session and >= 1 in spawned subagent processes.
// Behaviour branches on this: interactive prompting in the main session, headless hard-block
// for catastrophic operations in subagents (where stdin is /dev/null and no UI is available).
const _subagentDepth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
const _isSubagent = Number.isFinite(_subagentDepth) && _subagentDepth >= 1;

// Hard-block patterns for subagent (headless) mode. Criteria: unrecoverable by default AND
// unlikely to be intentional in an automated context. Fewer false positives over broad coverage —
// the interactive prompt handles the rest for main sessions.
const HEADLESS_BLOCKED: Array<{ pattern: RegExp; reason: string }> = [
	// Recursive deletion
	{ pattern: /(?<!\bgit\s+)\brm\b[^#\n]*\s-(?:[a-zA-Z]*[rR]|-\brecursive\b)/, reason: "recursive delete (rm -r / -rf / -Rf)" },
	// Privilege escalation
	{ pattern: /\bsudo\b/, reason: "elevated privileges (sudo)" },
	// Remote code execution via pipe-to-shell
	{ pattern: /\b(curl|wget)\b[^#\n]*\|\s*(ba?sh|zsh|fish|dash|sh)\b/, reason: "pipe to shell (remote code execution)" },
	// Disk / filesystem destruction
	{ pattern: /\bmkfs/, reason: "filesystem formatting (mkfs)" },
	{ pattern: /\bnewfs_\w+/, reason: "filesystem formatting (newfs_*)" },
	{ pattern: /\bwipefs\b/, reason: "disk signature wipe" },
	{ pattern: /\bdiskutil\s+(erase|zeroDisk|secureErase|reformat)/i, reason: "destructive disk operation (diskutil)" },
	{ pattern: /\bdd\b[^#\n]*\bof=\/dev\//, reason: "raw disk write (dd of=/dev/...)" },
	{ pattern: /\b(parted|fdisk|gdisk|sgdisk)\b/, reason: "partition table management" },
	{ pattern: /\bcryptsetup\b/, reason: "disk encryption management" },
	{ pattern: /\bzpool\b/, reason: "ZFS pool management" },
	// System power
	{ pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: "system power operation" },
	// Infrastructure teardown
	{ pattern: /\bterraform\s+destroy\b/, reason: "infrastructure teardown (terraform destroy)" },
	{ pattern: /\bkubectl\s+delete\b/, reason: "Kubernetes resource deletion" },
	{ pattern: /\baws\s+s3\s+rm\b[^#\n]*--recursive/, reason: "bulk S3 deletion (aws s3 rm --recursive)" },
	// Destructive git operations
	{ pattern: /\bgit\s+commit\b/, reason: "git commit (commits are main-session operations)" },
	{ pattern: /\bgit\s+pull\b/, reason: "git pull (pulls are main-session operations)" },
	{ pattern: /\bgit\s+push\b/, reason: "git push (pushes are main-session operations)" },
	{ pattern: /\bgit\s+reset\b[^#\n]*--hard\b/, reason: "discard all uncommitted changes (git reset --hard)" },
	{ pattern: /\bgit\s+clean\b[^#\n]*-[a-zA-Z]*f/, reason: "delete untracked files (git clean -f)" },
	{ pattern: /\bgit\s+reflog\s+expire\b/, reason: "expire reflog (removes recovery history)" },
	{ pattern: /\bgit\s+gc\b[^#\n]*--prune\b/, reason: "prune unreachable objects (git gc --prune)" },
];

// Subset of HEADLESS_BLOCKED used as the hard-block floor when bash-guard is
// disabled in an interactive (main) session. The user explicitly opts into
// autonomy here, so routine git operations (commit/pull/push) are allowed
// through; only truly catastrophic / non-recoverable patterns remain blocked.
const MAIN_DISABLED_BLOCKED: Array<{ pattern: RegExp; reason: string }> = HEADLESS_BLOCKED.filter(
	({ pattern }) => {
		const src = pattern.source;
		return !(
			src.includes("git\\s+commit") ||
			src.includes("git\\s+pull") ||
			// Keep `git push --force` blocked but allow plain `git push`.
			src === "\\bgit\\s+push\\b"
		);
	},
);

// Warning shown via ctx.ui.setStatus when bash-guard is disabled. Pi joins all
// extension statuses on a single line sorted alphabetically by key, so:
//
// - Key has a leading space so it sorts before any letter-keyed extension,
//   guaranteeing the warning stays visible (truncateToWidth chops the right).
// - We deliberately do NOT pad the text to full width — that would push other
//   extensions' statuses off-screen via truncation.
// - Background is truecolor pure red (#FF0000) instead of the basic palette
//   color 41 (which terminals remap per theme, often appearing brown/orange).
//   Foreground is truecolor white for high contrast on pure red.
// - NBSPs (U+00A0) handle intra-warning spacing because the footer's
//   sanitizeStatusText collapses runs of ASCII spaces via / +/g.
const BASH_GUARD_STATUS_KEY = " bash-guard";

export default function (pi: ExtensionAPI) {
	if (_isSubagent) {
		// Subagent mode: hard-block catastrophic operations, no prompting.
		pi.on("tool_call", async (event) => {
			if (!isToolCallEventType("bash", event)) return;
			const command = event.input.command;
			for (const { pattern, reason } of HEADLESS_BLOCKED) {
				if (pattern.test(command)) {
					return {
						block: true,
						reason:
							`Blocked by bash-guard: ${reason}. ` +
							"This is a non-interactive subagent session — catastrophic operations are not permitted. " +
							"Propose a safer alternative or ask the parent agent to confirm with the user.",
					};
				}
			}
		});
		return;
	}

	// Main session mode: interactive prompting.
	pi.registerFlag("bash-guard-auto-allow", {
		description: "If set, bash-guard will not block when no UI is available (non-interactive modes).",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("bash-guard-disabled", {
		description: "Start the session with bash-guard disabled (autonomous mode; hard-block floor still applies).",
		type: "boolean",
		default: false,
	});

	// Session-local toggle. Intentionally not persisted across reloads or restarts.
	let disabled = false;

	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "startup" && pi.getFlag("bash-guard-disabled") === true) {
			disabled = true;
			if (ctx.hasUI) {
				const { theme } = ctx.ui;
				const badge = theme.bg(
					"toolErrorBg",
					theme.bold(theme.fg("error", " ⚠ BG OFF ")),
				);
				ctx.ui.setStatus(BASH_GUARD_STATUS_KEY, badge);
			}
		}
	});

	pi.registerCommand("bash-guard", {
		description: "Toggle bash-guard between interactive (default) and disabled (autonomous) for this session.",
		handler: async (_args, ctx) => {
			disabled = !disabled;
			if (disabled) {
				const { theme } = ctx.ui;
				const badge = theme.bg(
					"toolErrorBg",
					theme.bold(theme.fg("error", " ⚠ BG OFF ")),
				);
				ctx.ui.setStatus(BASH_GUARD_STATUS_KEY, badge);
				ctx.ui.notify(
					"bash-guard DISABLED for this session. Catastrophic operations are still hard-blocked. Run /bash-guard again to re-enable.",
					"warning",
				);
			} else {
				ctx.ui.setStatus(BASH_GUARD_STATUS_KEY, undefined);
				ctx.ui.notify("bash-guard re-enabled.", "info");
			}
		},
	});

	// Avoid annoying retry loops: if the exact command was aborted recently, auto-block it.
	const recentlyAborted = new Map<string, number>();
	const ABORT_REMEMBER_MS = 60_000;

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;

		// Disabled (autonomous) mode, or a desktop-control command: skip interactive
		// prompting entirely, but keep a hard-block floor for catastrophic operations.
		if (disabled || usesAgentDesktop(command)) {
			for (const { pattern, reason } of MAIN_DISABLED_BLOCKED) {
				if (pattern.test(command)) {
					return {
						block: true,
						reason:
							`Blocked by bash-guard (disabled-mode floor): ${reason}. ` +
							"Even with bash-guard disabled, this pattern is considered too destructive to run unattended. " +
							"Re-enable bash-guard with /bash-guard and confirm interactively, or propose a safer alternative.",
					};
				}
			}
			return;
		}

		const risk = analyzeBashCommand(command);
		if (!risk) return;

		const now = Date.now();
		const lastAbort = recentlyAborted.get(command);
		if (lastAbort && now - lastAbort < ABORT_REMEMBER_MS) {
			return {
				block: true,
				reason:
					"Blocked by bash-guard: command was already aborted recently. Ask the user for a safer alternative; do not retry the same command.",
			};
		}

		if (!ctx.hasUI && pi.getFlag("bash-guard-auto-allow")) {
			// Non-interactive mode: allow when explicitly requested.
			return;
		}

		const choice = await promptRunOrAbort(ctx, command, risk);
		if (choice === "run") return;

		recentlyAborted.set(command, now);
		return {
			block: true,
			reason:
				"Blocked by user via bash-guard (potentially destructive command). Ask the user for confirmation or propose a non-destructive alternative.",
		};
	});
}
