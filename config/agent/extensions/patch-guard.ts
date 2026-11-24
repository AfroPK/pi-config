import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

interface Marker {
	file: string;
	contains: string;
}

interface PatchEntry {
	file: string;
	markers?: Marker[];
}

interface ConfigCopy {
	source: string;
	dest: string;
	requiredKeys?: Record<string, string>;
}

interface PackageEntry {
	name: string;
	packageDir: string;
	patches?: PatchEntry[];
	configCopies?: ConfigCopy[];
}

interface Manifest {
	packages: PackageEntry[];
}

function findMissingPatches(agentDir: string): string[] {
	const manifestPath = path.join(agentDir, "patches", "patches-manifest.json");
	if (!fs.existsSync(manifestPath)) return [];

	let manifest: Manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
	} catch (err: any) {
		return [`patches-manifest.json unreadable (${err?.message ?? err})`];
	}

	const issues: string[] = [];
	const nodeModules = path.join(agentDir, "npm", "node_modules");

	for (const pkg of manifest.packages ?? []) {
		const pkgRoot = path.join(nodeModules, ...pkg.packageDir.split("/"));
		if (!fs.existsSync(pkgRoot)) {
			issues.push(`${pkg.name} (not installed)`);
			continue;
		}
		for (const p of pkg.patches ?? []) {
			for (const m of p.markers ?? []) {
				const filePath = path.join(pkgRoot, m.file);
				if (!fs.existsSync(filePath) || !fs.readFileSync(filePath, "utf8").includes(m.contains)) {
					issues.push(`${pkg.name}:${p.file}`);
					break;
				}
			}
		}
		for (const cfg of pkg.configCopies ?? []) {
			const destPath = path.join(pkgRoot, cfg.dest);
			if (!fs.existsSync(destPath)) {
				issues.push(`${pkg.name}:${cfg.dest} (missing)`);
				continue;
			}
			try {
				const parsed = JSON.parse(fs.readFileSync(destPath, "utf8")) as Record<string, unknown>;
				for (const [k, expected] of Object.entries(cfg.requiredKeys ?? {})) {
					if (parsed[k] !== expected) {
						issues.push(`${pkg.name}:${cfg.dest} (${k} drifted)`);
						break;
					}
				}
			} catch {
				issues.push(`${pkg.name}:${cfg.dest} (invalid JSON)`);
			}
		}
	}
	return issues;
}

export default function (pi: ExtensionAPI) {
	const agentDir = getAgentDir();
	const managerScript = path.join(agentDir, "patches", "manage-patches.mjs");

	pi.on("session_start", async (_event, ctx) => {
		const issues = findMissingPatches(agentDir);
		if (issues.length === 0) return;

		const message =
			`Local package patches/config missing (${issues.join(", ")}). ` +
			`Run /patch-apply (then /reload) or: node "${managerScript}" apply`;
		if (ctx.hasUI) {
			ctx.ui.notify(message, "warning");
		} else {
			console.warn(`patch-guard: ${message}`);
		}
	});

	pi.registerCommand("patch-status", {
		description: "Verify that local patches on installed Pi npm packages are intact",
		handler: async (_args, ctx) => {
			if (!fs.existsSync(managerScript)) {
				ctx.ui.notify(`Patch manager not found: ${managerScript}`, "error");
				return;
			}
			const res = await pi.exec("node", [managerScript, "check"], { timeout: 15_000 });
			const output = (res.stdout || res.stderr || "").trim();
			ctx.ui.notify(output || (res.code === 0 ? "All patches intact" : "Patch check failed"), res.code === 0 ? "info" : "warning");
		},
	});

	pi.registerCommand("patch-apply", {
		description: "Reapply local patches and loop-police config to installed Pi npm packages",
		handler: async (_args, ctx) => {
			if (!fs.existsSync(managerScript)) {
				ctx.ui.notify(`Patch manager not found: ${managerScript}`, "error");
				return;
			}
			const res = await pi.exec("node", [managerScript, "apply"], { timeout: 30_000 });
			const output = (res.stdout || res.stderr || "").trim();
			if (res.code === 0) {
				ctx.ui.notify(`${output}\nRun /reload to load the patched modules.`, "info");
			} else {
				ctx.ui.notify(output || "Patch apply reported conflicts", "error");
			}
		},
	});
}
