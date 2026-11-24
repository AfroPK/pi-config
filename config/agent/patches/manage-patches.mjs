#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCHES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENT_DIR = path.dirname(PATCHES_DIR);

function sha256Normalized(filePath) {
  const raw = fs.readFileSync(filePath);
  const normalized = Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  return createHash("sha256").update(normalized).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveHomeTokens(text, homeDir) {
  const forward = homeDir.replace(/\\/g, "/");
  return text.replace(/__PI_HOME__/g, forward);
}

export function checkMarkers(pkgRoot, patchEntry) {
  const missing = [];
  for (const marker of patchEntry.markers ?? []) {
    const target = path.join(pkgRoot, marker.file);
    if (!fs.existsSync(target)) {
      missing.push(`${marker.file} missing`);
      continue;
    }
    const content = fs.readFileSync(target, "utf8");
    if (!content.includes(marker.contains)) {
      missing.push(`${marker.file} missing marker ${JSON.stringify(marker.contains)}`);
    }
  }
  return missing;
}

function checkHashes(pkgRoot, patchEntry) {
  const mismatches = [];
  for (const [rel, expected] of Object.entries(patchEntry.hashes ?? {})) {
    const target = path.join(pkgRoot, rel);
    if (!fs.existsSync(target)) {
      mismatches.push(`${rel}: missing`);
      continue;
    }
    const actual = sha256Normalized(target);
    if (actual !== expected) {
      mismatches.push(`${rel}: hash ${actual.slice(0, 12)} != ${expected.slice(0, 12)}`);
    }
  }
  return mismatches;
}

function runGitApply(pkgRoot, patchPath, checkOnly) {
  const args = ["apply", "--ignore-whitespace"];
  if (checkOnly) args.push("--check");
  args.push(patchPath);
  execFileSync("git", args, { cwd: pkgRoot, stdio: "pipe", encoding: "utf8" });
}

export function auditAndApply({ agentDir = DEFAULT_AGENT_DIR, apply = false, homeDir = os.homedir() } = {}) {
  const manifest = readJson(path.join(PATCHES_DIR, "patches-manifest.json"));
  const nodeModules = path.join(agentDir, "npm", "node_modules");
  const results = [];
  let hasProblems = false;

  for (const pkg of manifest.packages) {
    const pkgRoot = path.join(nodeModules, ...pkg.packageDir.split("/"));
    const pkgJsonPath = path.join(pkgRoot, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      results.push({
        package: pkg.name,
        status: "not_installed",
        detail: `Directory not found: ${pkgRoot}`,
      });
      hasProblems = true;
      continue;
    }

    const installedVersion = readJson(pkgJsonPath).version ?? "unknown";
    const versionNote =
      installedVersion === pkg.testedVersion
        ? installedVersion
        : `${installedVersion} (tested on ${pkg.testedVersion})`;

    const patchResults = [];
    for (const patchEntry of pkg.patches ?? []) {
      const patchPath = path.join(PATCHES_DIR, patchEntry.file);
      const missingMarkers = checkMarkers(pkgRoot, patchEntry);
      if (missingMarkers.length === 0) {
        const hashMismatches = checkHashes(pkgRoot, patchEntry);
        patchResults.push({
          patch: patchEntry.file,
          status: installedVersion === pkg.testedVersion && hashMismatches.length === 0 ? "ok" : "applied_drifted",
          detail: hashMismatches.length ? hashMismatches.join("; ") : "applied",
        });
        continue;
      }

      if (!apply) {
        hasProblems = true;
        patchResults.push({
          patch: patchEntry.file,
          status: "missing",
          detail: missingMarkers.join("; "),
        });
        continue;
      }

      try {
        runGitApply(pkgRoot, patchPath, true);
        runGitApply(pkgRoot, patchPath, false);
        const postMissing = checkMarkers(pkgRoot, patchEntry);
        if (postMissing.length > 0) {
          hasProblems = true;
          patchResults.push({
            patch: patchEntry.file,
            status: "failed",
            detail: `Applied but markers still missing: ${postMissing.join("; ")}`,
          });
        } else {
          patchResults.push({
            patch: patchEntry.file,
            status: "reapplied",
            detail: `Reapplied cleanly to ${versionNote}`,
          });
        }
      } catch (err) {
        hasProblems = true;
        const stderr = err?.stderr ? String(err.stderr).trim() : err?.message || String(err);
        patchResults.push({
          patch: patchEntry.file,
          status: "conflict",
          detail: `Patch does not apply cleanly to ${versionNote}: ${stderr}`,
        });
      }
    }

    const configResults = [];
    for (const cfg of pkg.configCopies ?? []) {
      const srcPath = path.join(PATCHES_DIR, cfg.source);
      const destPath = path.join(pkgRoot, cfg.dest);
      const templateText = resolveHomeTokens(fs.readFileSync(srcPath, "utf8"), homeDir);
      let needsRestore = !fs.existsSync(destPath);
      let reason = needsRestore ? "missing" : "ok";

      if (!needsRestore) {
        try {
          const current = readJson(destPath);
          for (const [k, v] of Object.entries(cfg.requiredKeys ?? {})) {
            if (current[k] !== v) {
              needsRestore = true;
              reason = `${k}=${JSON.stringify(current[k])} != ${JSON.stringify(v)}`;
              break;
            }
          }
        } catch (e) {
          needsRestore = true;
          reason = `invalid JSON (${e.message})`;
        }
      }

      if (!needsRestore) {
        configResults.push({ file: cfg.dest, status: "ok", detail: "required keys intact" });
      } else if (!apply) {
        hasProblems = true;
        configResults.push({ file: cfg.dest, status: "missing_or_drifted", detail: reason });
      } else {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        if (fs.existsSync(destPath)) {
          fs.copyFileSync(destPath, `${destPath}.bak-prepatch`);
        }
        fs.writeFileSync(destPath, templateText, "utf8");
        configResults.push({ file: cfg.dest, status: "restored", detail: `Restored (${reason})` });
      }
    }

    results.push({
      package: pkg.name,
      version: versionNote,
      patches: patchResults,
      configs: configResults,
    });
  }

  return { ok: !hasProblems, agentDir, results };
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args.find((a) => !a.startsWith("-")) ?? "check";
  const jsonOut = args.includes("--json");
  const agentIdx = args.indexOf("--agent-dir");
  const agentDir = agentIdx !== -1 && args[agentIdx + 1] ? path.resolve(args[agentIdx + 1]) : DEFAULT_AGENT_DIR;
  const homeIdx = args.indexOf("--home");
  const homeDir = homeIdx !== -1 && args[homeIdx + 1] ? path.resolve(args[homeIdx + 1]) : os.homedir();

  if (!["check", "apply", "status"].includes(cmd)) {
    console.error("Usage: node manage-patches.mjs <check|apply|status> [--json] [--agent-dir <path>] [--home <path>]");
    process.exit(2);
  }

  const report = auditAndApply({ agentDir, apply: cmd === "apply", homeDir });

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const pkg of report.results) {
      console.log(`${pkg.package} (${pkg.version ?? pkg.status}):`);
      if (pkg.detail) console.log(`  [${pkg.status}] ${pkg.detail}`);
      for (const p of pkg.patches ?? []) {
        console.log(`  patch ${p.patch}: [${p.status}] ${p.detail}`);
      }
      for (const c of pkg.configs ?? []) {
        console.log(`  config ${c.file}: [${c.status}] ${c.detail}`);
      }
    }
    console.log(report.ok ? "OK: all package patches and configs intact." : "FAIL: patch/config action required.");
  }

  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
