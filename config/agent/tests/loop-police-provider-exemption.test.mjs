import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path, { delimiter } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

function resolvePiRoot() {
  const candidates = [
    process.env.PI_GLOBAL_NODE_MODULES,
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : "",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(path.join(c, "@earendil-works", "pi-coding-agent"))) return c;
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
}

const require = createRequire(import.meta.url);
const piRoot = resolvePiRoot();
const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.NODE_PATH = [piRoot, `${piRoot}/@earendil-works/pi-coding-agent/node_modules`, process.env.NODE_PATH ?? ""]
  .filter(Boolean)
  .join(delimiter);
require("node:module")._initPaths();
const { createJiti } = require(`${piRoot}/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs`);
const jiti = createJiti(import.meta.url);
const { default: loopPolice, LOOP_POLICE_DEFAULTS } = await jiti.import(
  path.join(agentDir, "npm", "node_modules", "pi-loop-police", "extensions", "loop-police.ts"),
);

function setup() {
  const handlers = new Map();
  const sent = [];
  const emitted = [];
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    events: { emit(name, payload) { emitted.push({ name, payload }); } },
    exec: async () => ({ code: 0, killed: false }),
    sendMessage(message, options) { sent.push({ message, options }); },
    registerCommand() {},
    registerMessageRenderer() {},
  };
  loopPolice(pi);
  return { handlers, sent, emitted };
}

function context(provider) {
  return {
    model: { id: "test-model", name: "Test model", provider },
    aborts: 0,
    abort() { this.aborts += 1; },
    sessionManager: {
      getSessionId: () => "test-session",
      getSessionFile: () => null,
    },
    cwd: "__PI_HOME__",
    ui: { notify() {} },
  };
}

async function emit(harness, name, event, ctx) {
  const handler = harness.handlers.get(name);
  assert.equal(typeof handler, "function", `${name} handler registered`);
  return await handler(event, ctx);
}

function repeatingThinkingMessage() {
  const unit = "This reasoning paragraph repeats deliberately. 1234567890 abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ. ";
  assert.ok(unit.length >= 80);
  return {
    role: "assistant",
    content: [{ type: "thinking", thinking: unit + unit }],
  };
}

async function start(harness, ctx) {
  await emit(harness, "agent_start", {}, ctx);
  await emit(harness, "turn_start", { turnIndex: 0 }, ctx);
}

// The configured provider bypasses character/semantic stream aborts and message rewriting.
{
  const harness = setup();
  const ctx = context("antigravity-acp");
  await start(harness, ctx);
  const message = repeatingThinkingMessage();
  await emit(harness, "message_update", {
    message,
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "repeat" },
  }, ctx);
  assert.equal(ctx.aborts, 0);
  const original = JSON.stringify(message);
  const result = await emit(harness, "message_end", { message }, ctx);
  assert.equal(result, undefined);
  assert.equal(JSON.stringify(message), original);
  await emit(harness, "agent_settled", {}, ctx);
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.emitted.length, 0);
}

// Matching is provider-wide and case-insensitive, not a hardcoded model-ID list.
{
  const harness = setup();
  const ctx = context("ANTIGRAVITY-ACP");
  await start(harness, ctx);
  const message = repeatingThinkingMessage();
  await emit(harness, "message_update", {
    message,
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "repeat" },
  }, ctx);
  assert.equal(ctx.aborts, 0);
}

// A non-exempt provider is still protected by the same repeating-stream input.
{
  const harness = setup();
  const ctx = context("openrouter");
  await start(harness, ctx);
  const message = repeatingThinkingMessage();
  await emit(harness, "message_update", {
    message,
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "repeat" },
  }, ctx);
  assert.equal(ctx.aborts, 1);
  const result = await emit(harness, "message_end", { message }, ctx);
  assert.ok(result?.message);
}

// Every tool detector is bypassed, including identical loops and the read ceiling.
{
  const harness = setup();
  const ctx = context("antigravity-acp");
  await start(harness, ctx);
  for (let i = 0; i < 25; i++) {
    const result = await emit(harness, "tool_call", {
      toolName: "read",
      input: { path: "C:/example.txt", offset: 1, limit: 20 },
    }, ctx);
    assert.equal(result, undefined);
  }
  assert.equal(harness.emitted.length, 0);
}

// Non-exempt identical calls are still blocked in place.
{
  const harness = setup();
  const ctx = context("openrouter");
  await start(harness, ctx);
  const event = { toolName: "read", input: { path: "C:/example.txt", offset: 1, limit: 20 } };
  assert.equal(await emit(harness, "tool_call", event, ctx), undefined);
  const result = await emit(harness, "tool_call", event, ctx);
  assert.equal(result?.block, true);
}

// Context is passed through untouched for the exempt provider.
{
  const harness = setup();
  const ctx = context("antigravity-acp");
  const messages = [{ role: "assistant", content: [{ type: "thinking", thinking: "keep me" }] }];
  assert.equal(await emit(harness, "context", { messages }, ctx), undefined);
  const other = context("openrouter");
  const result = await emit(harness, "context", { messages }, other);
  assert.deepEqual(result, { messages });
}

// Cross-turn stagnation never trims reasoning or starts recovery for exempt models.
{
  const harness = setup();
  const ctx = context("antigravity-acp");
  await start(harness, ctx);
  for (let i = 0; i < 5; i++) {
    const result = await emit(harness, "message_end", {
      message: { role: "assistant", content: [{ type: "thinking", thinking: "same stable reasoning across every turn" }] },
    }, ctx);
    assert.equal(result, undefined);
  }
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.emitted.length, 0);
}

// Switching to an exempt provider also suppresses an already queued recovery turn.
{
  const harness = setup();
  const other = context("openrouter");
  await start(harness, other);
  const message = repeatingThinkingMessage();
  await emit(harness, "message_update", {
    message,
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "repeat" },
  }, other);
  assert.equal(other.aborts, 1);
  await emit(harness, "message_end", { message }, other);
  const exempt = context("antigravity-acp");
  await emit(harness, "agent_settled", {}, exempt);
  assert.equal(harness.sent.length, 0);
}

assert.ok("EXEMPT_PROVIDERS" in LOOP_POLICE_DEFAULTS);
console.log("PASS: Antigravity ACP is fully exempt; non-exempt providers retain loop protection.");
