// Test harness for ~/.pi/agent/extensions/antigravity-prefer-pi-tools.ts
// Run: node ~/.pi/agent/tests/antigravity-prefer-pi-tools.test.mjs
// Exit code 0 = all checks passed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolvePiRoot() {
  const candidates = [
    process.env.PI_GLOBAL_NODE_MODULES,
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : "",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "@earendil-works", "pi-coding-agent"))) return c;
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
}

const JITI_DIR =
  process.env.JITI_DIR ||
  path.join(resolvePiRoot(), "@earendil-works", "pi-coding-agent", "node_modules", "jiti");
const require = createRequire(JITI_DIR + "/");
const jitiMod = require(JITI_DIR);
const createJiti = jitiMod.createJiti || jitiMod.default || jitiMod;
const jiti = createJiti(import.meta.url);

const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT_PATH = path.join(AGENT_DIR, "extensions", "antigravity-prefer-pi-tools.ts");
const mod = await jiti.import(EXT_PATH);

const { buildAntigravityPiToolsSection, toBridgeToolName } = mod;
const registerExtension = mod.default;

// 1. Bridge naming matches pi-antigravity-acp-provider's src/mcp/bridge.ts rule
assert.equal(toBridgeToolName("read"), "pi_read");
assert.equal(toBridgeToolName("ask_user_question"), "pi_ask_user_question");
assert.equal(toBridgeToolName("ssh-bash"), "pi_ssh-bash");
assert.equal(toBridgeToolName("foo.bar/baz"), "pi_foo_bar_baz");
assert.equal(toBridgeToolName("a".repeat(80)).length, 64);

// 2. Section builder filters to selectedTools, inlines core signatures, and is deterministic
const subset = buildAntigravityPiToolsSection(["read", "bash", "edit", "write", "ask_user_question"]);
assert.equal(subset, buildAntigravityPiToolsSection(["read", "bash", "edit", "write", "ask_user_question"]));
assert.match(subset, /`pi_read` instead of native `view_file`/);
assert.match(subset, /`pi_bash` instead of native `run_command`/);
assert.match(subset, /`pi_edit` instead of native `replace_file_content`/);
assert.match(subset, /`pi_write` instead of native `write_to_file`/);
assert.match(subset, /`pi_ask_user_question` instead of native `ask_question`/);
assert.doesNotMatch(subset, /`pi_subagent`/);

const allTools = buildAntigravityPiToolsSection(undefined);
assert.match(allTools, /`pi_subagent` instead of native `invoke_subagent`/);
assert.match(allTools, /`pi_look`/);

// 3. Extension hook scoping and /antigravity-pi-tools toggle
const handlers = new Map();
const commands = new Map();
const fakePi = {
  on: (name, fn) => handlers.set(name, fn),
  registerCommand: (name, def) => commands.set(name, def),
};
registerExtension(fakePi);

const beforeStart = handlers.get("before_agent_start");
const toggleCmd = commands.get("antigravity-pi-tools");
assert.equal(typeof beforeStart, "function");
assert.equal(typeof toggleCmd?.handler, "function");

// Safe no-op when systemPromptOptions / sections absent
assert.doesNotThrow(() => beforeStart({}, { model: { provider: "antigravity-acp" } }));
assert.doesNotThrow(() => beforeStart({ systemPromptOptions: {} }, { model: { provider: "antigravity-acp" } }));

// Active on antigravity-acp
const agyEvent = { systemPromptOptions: { sections: {}, selectedTools: ["read", "bash"] } };
beforeStart(agyEvent, { model: { provider: "antigravity-acp" } });
assert.ok(agyEvent.systemPromptOptions.sections.antigravity_pi_tools);
assert.match(agyEvent.systemPromptOptions.sections.antigravity_pi_tools, /`pi_bash`/);

// Deleted (zero tokens) on non-antigravity providers or missing model
for (const provider of ["openrouter", "claude-cli", "llama-swap", undefined]) {
  const otherEvent = {
    systemPromptOptions: {
      sections: { antigravity_pi_tools: "stale", keep_me: "ok" },
      selectedTools: ["read", "bash"],
    },
  };
  beforeStart(otherEvent, provider ? { model: { provider } } : {});
  assert.equal("antigravity_pi_tools" in otherEvent.systemPromptOptions.sections, false);
  assert.equal(otherEvent.systemPromptOptions.sections.keep_me, "ok");
}

// Command toggle off / status / on
const notes = [];
const makeCtx = (provider) => ({
  model: provider ? { provider } : undefined,
  ui: { notify: (msg, level) => notes.push({ msg, level }) },
});

await toggleCmd.handler("off", makeCtx("antigravity-acp"));
assert.match(notes.at(-1).msg, /OFF/);
assert.equal(notes.at(-1).level, "warning");

const offEvent = {
  systemPromptOptions: { sections: { antigravity_pi_tools: "stale" }, selectedTools: ["read", "bash"] },
};
beforeStart(offEvent, { model: { provider: "antigravity-acp" } });
assert.equal("antigravity_pi_tools" in offEvent.systemPromptOptions.sections, false);

await toggleCmd.handler("", makeCtx("openrouter"));
assert.match(notes.at(-1).msg, /OFF.*idle \(current provider: openrouter\)/);

await toggleCmd.handler("on", makeCtx("antigravity-acp"));
assert.match(notes.at(-1).msg, /ON.*active on current antigravity-acp model/);
assert.equal(notes.at(-1).level, "info");

beforeStart(offEvent, { model: { provider: "antigravity-acp" } });
assert.ok(offEvent.systemPromptOptions.sections.antigravity_pi_tools);

// 4. antigravity-acp-provider/config.json permissions validity (when present)
const agyConfigPath = path.join(AGENT_DIR, "antigravity-acp-provider", "config.json");
if (fs.existsSync(agyConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(agyConfigPath, "utf8"));
  assert.ok(["default", "yolo", "plan"].includes(cfg.permissions), `unexpected permissions: ${cfg.permissions}`);
}

console.log("antigravity-prefer-pi-tools tests: ALL PASS");
