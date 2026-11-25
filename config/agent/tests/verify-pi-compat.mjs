#!/usr/bin/env node
/**
 * Full Pi compatibility & post-update verification suite.
 *
 * Verifies:
 *   1. Local npm package patches & loop-police.json config (via manage-patches.mjs)
 *   2. SettingsManager / models.json / keybindings.json load cleanly
 *   3. DefaultResourceLoader loads all local + package extensions (0 errors) and skills (0 diagnostics/collisions)
 *   4. No local extension uses deprecated @mariozechner/* or @sinclair/typebox aliases
 *   5. All agent definitions (agents/*.md) use LF line endings (required by pi-interactive-subagents)
 *   6. `pi --list-models` emits zero "No models match pattern" warnings for settings.json enabledModels
 *   7. All unit test suites under ~/.pi/agent/tests and ~/.pi/agent/extensions/bash-guard/test pass
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENT_DIR = path.dirname(TESTS_DIR);

function resolveGlobalNodeModules() {
  const candidates = [
    process.env.PI_GLOBAL_NODE_MODULES,
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : "",
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "@earendil-works", "pi-coding-agent"))) return dir;
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "__pycache__" || entry.name === ".venv") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const agentIdx = args.indexOf("--agent-dir");
  const agentDir = agentIdx !== -1 && args[agentIdx + 1] ? path.resolve(args[agentIdx + 1]) : DEFAULT_AGENT_DIR;
  const skipSubtests = args.includes("--skip-tests");
  const skipCli = args.includes("--skip-cli");

  const globalNodeModules = resolveGlobalNodeModules();
  const piDistIndex = path.join(globalNodeModules, "@earendil-works", "pi-coding-agent", "dist", "index.js");
  if (!fs.existsSync(piDistIndex)) {
    throw new Error(`Pi CLI package not found at ${piDistIndex}`);
  }
  const pi = await import(pathToFileURL(piDistIndex).href);
  const failures = [];

  // 1. Patches & loop-police.json
  const patchMgrUrl = pathToFileURL(path.join(agentDir, "patches", "manage-patches.mjs")).href;
  const { auditAndApply } = await import(patchMgrUrl);
  const patchReport = auditAndApply({ agentDir, apply: false, homeDir: os.homedir() });
  if (!patchReport.ok) {
    failures.push(`Patch check failed: ${JSON.stringify(patchReport.results)}`);
  } else {
    console.log(`[PASS] Package patches & loop-police.json intact (${patchReport.results.length} packages)`);
  }

  // 2. Settings + ResourceLoader (extensions + skills)
  const sm = pi.SettingsManager.create(process.cwd(), agentDir);
  const settingsErrors = sm.drainErrors ? sm.drainErrors() : [];
  if (settingsErrors.length > 0) {
    failures.push(`SettingsManager errors: ${JSON.stringify(settingsErrors)}`);
  } else {
    console.log(`[PASS] SettingsManager loaded cleanly`);
  }

  const loader = new pi.DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir,
    settingsManager: sm,
  });
  await loader.reload();

  const extResult = loader.getExtensions();
  if (extResult.errors.length > 0) {
    failures.push(`Extension load errors: ${JSON.stringify(extResult.errors)}`);
  } else {
    console.log(`[PASS] DefaultResourceLoader loaded ${extResult.extensions.length} extensions with 0 errors`);
  }

  const skillsResult = loader.getSkills();
  if (skillsResult.diagnostics.length > 0) {
    failures.push(`Skill diagnostics: ${JSON.stringify(skillsResult.diagnostics)}`);
  } else {
    console.log(`[PASS] DefaultResourceLoader loaded ${skillsResult.skills.length} skills with 0 diagnostics`);
  }

  // 3. Deprecated alias scan across local extensions
  const extFiles = walkFiles(path.join(agentDir, "extensions")).filter((f) => /\.(?:ts|mts|js|mjs)$/i.test(f));
  const legacyMatches = [];
  for (const file of extFiles) {
    const text = fs.readFileSync(file, "utf8");
    if (/@mariozechner\/|@sinclair\/typebox/.test(text)) {
      legacyMatches.push(path.relative(agentDir, file));
    }
  }
  if (legacyMatches.length > 0) {
    failures.push(`Legacy @mariozechner/@sinclair imports in local extensions: ${legacyMatches.join(", ")}`);
  } else {
    console.log(`[PASS] Local extensions free of deprecated @mariozechner/* and @sinclair/typebox imports (${extFiles.length} files scanned)`);
  }

  // 4. Agents LF line endings
  const agentsDir = path.join(agentDir, "agents");
  const crlfAgents = [];
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md")) continue;
      const raw = fs.readFileSync(path.join(agentsDir, file));
      if (raw.includes("\r\n")) crlfAgents.push(file);
    }
  }
  if (crlfAgents.length > 0) {
    failures.push(`agents/*.md has CRLF line endings (breaks pi-interactive-subagents): ${crlfAgents.join(", ")}`);
  } else {
    console.log(`[PASS] All agents/*.md files use LF line endings`);
  }

  // 5. enabledModels warning check via `pi --list-models`
  if (!skipCli) {
    const piBundle = path.join(globalNodeModules, "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
    const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
    const out = execFileSync(process.execPath, [piBundle, "--list-models"], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Also capture stderr explicitly via spawnSync if needed; execFileSync throws on non-zero, stderr only captured via spawnSync
    void out;
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync(process.execPath, [piBundle, "--list-models"], { env, encoding: "utf8" });
    const combined = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const warnLines = combined.split(/\r?\n/).filter((l) => /Warning:\s+No models match/i.test(l));
    if (res.status !== 0) {
      failures.push(`pi --list-models exited ${res.status}: ${res.stderr}`);
    } else if (warnLines.length > 0) {
      failures.push(`pi --list-models warnings: ${warnLines.join(" | ")}`);
    } else {
      console.log(`[PASS] pi --list-models resolved enabledModels with 0 warnings`);
    }
  }

  // 6. Unit test suites
  if (!skipSubtests) {
    const suites = [
      path.join(agentDir, "tests", "antigravity-continuation-steer.test.mjs"),
      path.join(agentDir, "tests", "antigravity-prefer-pi-tools.test.mjs"),
      path.join(agentDir, "tests", "ask-guard.test.mjs"),
      path.join(agentDir, "tests", "loop-police-provider-exemption.test.mjs"),
      path.join(agentDir, "extensions", "bash-guard", "test", "agent-desktop.test.mjs"),
      path.join(agentDir, "extensions", "bash-guard", "test", "dialog-fit.test.mjs"),
    ];
    for (const suite of suites) {
      if (!fs.existsSync(suite)) {
        failures.push(`Missing test suite: ${suite}`);
        continue;
      }
      try {
        execFileSync(process.execPath, [suite], { cwd: path.dirname(suite), stdio: "pipe", encoding: "utf8" });
        console.log(`[PASS] ${path.relative(agentDir, suite)}`);
      } catch (err) {
        failures.push(`Test failed (${path.relative(agentDir, suite)}): ${err.stderr || err.stdout || err.message}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("\nCOMPATIBILITY CHECKS FAILED:");
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log("\nALL PI COMPATIBILITY CHECKS PASSED.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
