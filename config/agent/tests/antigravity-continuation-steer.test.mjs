// Test suite for pi-antigravity-acp-provider mid-turn steer delivery during tool continuations
// Run: node ~/.pi/agent/tests/antigravity-continuation-steer.test.mjs
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

const PI_ROOT = resolvePiRoot();
const PI_PKG_NM = path.join(PI_ROOT, "@earendil-works", "pi-coding-agent", "node_modules");
const JITI_DIR = process.env.JITI_DIR || path.join(PI_PKG_NM, "jiti");
const require = createRequire(JITI_DIR + "/");
const jitiMod = require(JITI_DIR);
const createJiti = jitiMod.createJiti || jitiMod.default || jitiMod;
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-ai": path.join(PI_PKG_NM, "@earendil-works", "pi-ai"),
    "@earendil-works/pi-coding-agent": path.join(PI_ROOT, "@earendil-works", "pi-coding-agent"),
    "typebox/value": path.join(PI_PKG_NM, "typebox", "build", "value", "index.mjs"),
    typebox: path.join(PI_PKG_NM, "typebox", "build", "index.mjs"),
  },
});

const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_PATH = path.join(
  AGENT_DIR,
  "npm",
  "node_modules",
  "pi-antigravity-acp-provider",
  "src",
  "runtime.ts",
);
const mod = await jiti.import(RUNTIME_PATH);
const { AntigravityRuntime, findContinuationSteerMessages, toMcpToolResult } = mod;

// 1. Unit tests for findContinuationSteerMessages
{
  const base = [
    { role: "user", content: "Start audit", timestamp: 1 },
    { role: "assistant", provider: "antigravity-acp", model: "m", content: [{ type: "toolCall", id: "t1", name: "read", arguments: {} }], timestamp: 2 },
    { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "file contents" }], isError: false, timestamp: 3 },
  ];

  // No steer appended
  assert.deepEqual(findContinuationSteerMessages({ messages: base }, [2]), []);

  // Single steer message appended after toolResult (e.g. subagent_question / subagent_result converted to user)
  const steer1 = { role: "user", content: [{ type: "text", text: 'Sub-agent "scout" asks: skip git log?' }], timestamp: 4 };
  assert.deepEqual(findContinuationSteerMessages({ messages: [...base, steer1] }, [2]), [steer1]);

  // Empty/whitespace user message is ignored
  const emptySteer = { role: "user", content: [{ type: "text", text: "   " }], timestamp: 5 };
  assert.deepEqual(findContinuationSteerMessages({ messages: [...base, emptySteer] }, [2]), []);

  // Second tool step in same turn does NOT re-deliver steer1 from step 1
  const step2 = [
    ...base,
    steer1,
    { role: "assistant", provider: "antigravity-acp", model: "m", content: [{ type: "toolCall", id: "t2", name: "bash", arguments: {} }], timestamp: 6 },
    { role: "toolResult", toolCallId: "t2", toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 7 },
  ];
  assert.deepEqual(findContinuationSteerMessages({ messages: step2 }, [5]), []);

  // New steer on step 2 returns only steer2
  const steer2 = { role: "user", content: 'Sub-agent "scout" completed.', timestamp: 8 };
  assert.deepEqual(findContinuationSteerMessages({ messages: [...step2, steer2] }, [5]), [steer2]);

  // Parallel tool calls followed by multiple steers
  const parallel = [
    { role: "user", content: "Go", timestamp: 1 },
    {
      role: "assistant",
      provider: "antigravity-acp",
      model: "m",
      content: [
        { type: "toolCall", id: "p1", name: "read", arguments: {} },
        { type: "toolCall", id: "p2", name: "read", arguments: {} },
      ],
      timestamp: 2,
    },
    { role: "toolResult", toolCallId: "p1", toolName: "read", content: [{ type: "text", text: "a" }], isError: false, timestamp: 3 },
    { role: "toolResult", toolCallId: "p2", toolName: "read", content: [{ type: "text", text: "b" }], isError: true, timestamp: 4 },
    steer1,
    steer2,
  ];
  assert.deepEqual(findContinuationSteerMessages({ messages: parallel }, [2, 3]), [steer1, steer2]);
}

// 2. Unit tests for toMcpToolResult
{
  const toolRes = {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "read",
    content: [{ type: "text", text: "original output" }],
    isError: false,
    timestamp: 3,
  };

  // Passthrough with no steers
  const plain = toMcpToolResult(toolRes);
  assert.deepEqual(plain, {
    content: [{ type: "text", text: "original output" }],
    isError: false,
  });

  // String steer appended as clearly labeled block
  const withString = toMcpToolResult(toolRes, [{ role: "user", content: "Scout asks a question", timestamp: 4 }]);
  assert.equal(withString.content.length, 2);
  assert.equal(withString.content[0].text, "original output");
  assert.match(withString.content[1].text, /Pi mid-turn steering message/);
  assert.match(withString.content[1].text, /Scout asks a question/);
  assert.equal(withString.isError, false);

  // Array steer with text + image preserves both blocks and keeps isError
  const errToolRes = { ...toolRes, isError: true };
  const withArray = toMcpToolResult(errToolRes, [
    {
      role: "user",
      content: [
        { type: "text", text: "Look at this screenshot" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
      timestamp: 5,
    },
  ]);
  assert.equal(withArray.isError, true);
  assert.equal(withArray.content.length, 3);
  assert.match(withArray.content[1].text, /Look at this screenshot/);
  assert.deepEqual(withArray.content[2], { type: "image", data: "AAAA", mimeType: "image/png" });
}

// 3. End-to-end AntigravityRuntime test: mid-turn steer arrives during a pi-bridge tool call
{
  let mcpToolUrl = "";
  let mcpAuthHeader = "";
  let receivedMcpResult = null;
  let secondMcpResult = null;
  let promptCalls = 0;

  async function callMcpTool(name, args) {
    const res = await fetch(mcpToolUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: mcpAuthHeader,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 100000),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const text = await res.text();
    // StreamableHTTPServerTransport may respond with SSE or JSON
    const dataLine = text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));
    const payload = JSON.parse(dataLine ? dataLine.slice(6) : text);
    return payload.result;
  }

  const fakeFactory = (options) => {
    const state = {
      sessionId: "sess-1",
      modes: { currentModeId: "yolo", availableModes: [{ id: "yolo" }, { id: "default" }] },
      models: { currentModelId: "gemini-test", availableModels: [{ modelId: "gemini-test" }] },
    };
    const conn = {
      closed: false,
      process: { alive: true, exited: new Promise(() => {}), ignoredStdoutNoiseLines: 0, stderrTail: "" },
      async initialize() {
        return {
          agentInfo: { name: "fake-agy", version: "1.0.0" },
          agentCapabilities: {
            mcpCapabilities: { http: true },
            promptCapabilities: { embeddedContext: true, image: true },
          },
          authMethods: [],
        };
      },
      async newSession(_cwd, _signal, mcpServers) {
        const srv = mcpServers?.[0];
        if (srv && srv.type === "http") {
          mcpToolUrl = srv.url;
          mcpAuthHeader = srv.headers?.[0]?.value ?? "";
        }
        return state;
      },
      getSessionState() {
        return state;
      },
      async setMode(_sid, mode) {
        state.modes.currentModeId = mode;
      },
      async setModel(_sid, modelId) {
        state.models.currentModelId = modelId;
      },
      holdPromptWatchdog() {
        return () => {};
      },
      async cancel() {},
      async close() {
        conn.closed = true;
        conn.process.alive = false;
      },
      async prompt() {
        promptCalls += 1;
        // 1st tool call during the ACP turn
        receivedMcpResult = await callMcpTool("pi_read", { path: "demo.txt" });
        // 2nd tool call in same ACP turn (should NOT receive the previous steer again)
        secondMcpResult = await callMcpTool("pi_read", { path: "demo2.txt" });
        options.handlers?.onUpdate?.({
          sessionId: state.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done handling steer." } },
        });
        return { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
      },
    };
    return conn;
  };

  const runtime = new AntigravityRuntime(fakeFactory, "yolo");
  const model = {
    id: "gemini-test",
    name: "Gemini Test",
    api: "antigravity-acp",
    provider: "antigravity-acp",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100000,
    maxTokens: 4096,
  };
  const tools = [
    {
      name: "read",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  ];

  // Turn 1: initial prompt -> pauses with toolCall #1
  const initialMessages = [{ role: "user", content: "Inspect demo files", timestamp: 1 }];
  const w1 = runtime.stream(model, { messages: initialMessages, tools }, { sessionId: "pi-sess-steer-1" });
  const msg1 = await w1.stream.result();
  assert.equal(msg1.stopReason, "toolUse");
  const call1 = msg1.content.find((b) => b.type === "toolCall");
  assert.ok(call1, "expected first pi_read toolCall");

  // Continuation 1: toolResult #1 PLUS a mid-turn scout question steer!
  const cont1Messages = [
    ...initialMessages,
    msg1,
    {
      role: "toolResult",
      toolCallId: call1.id,
      toolName: "read",
      content: [{ type: "text", text: "demo.txt contents" }],
      isError: false,
      timestamp: 2,
    },
    {
      role: "user",
      content: [{ type: "text", text: 'Sub-agent "balatro-docs-miner" asks: Skip git log?' }],
      timestamp: 3,
    },
  ];
  const w2 = runtime.stream(model, { messages: cont1Messages, tools }, { sessionId: "pi-sess-steer-1" });
  const msg2 = await w2.stream.result();
  assert.equal(msg2.stopReason, "toolUse");
  const call2 = msg2.content.find((b) => b.type === "toolCall");
  assert.ok(call2, "expected second pi_read toolCall");

  // Verify the first MCP tool call received BOTH tool output AND the steer message
  assert.ok(receivedMcpResult, "expected first MCP tool result");
  assert.equal(receivedMcpResult.content.length, 2);
  assert.equal(receivedMcpResult.content[0].text, "demo.txt contents");
  assert.match(receivedMcpResult.content[1].text, /balatro-docs-miner/);
  assert.match(receivedMcpResult.content[1].text, /Skip git log\?/);

  // Continuation 2: toolResult #2 with NO new steer
  const cont2Messages = [
    ...cont1Messages,
    msg2,
    {
      role: "toolResult",
      toolCallId: call2.id,
      toolName: "read",
      content: [{ type: "text", text: "demo2.txt contents" }],
      isError: false,
      timestamp: 4,
    },
  ];
  const w3 = runtime.stream(model, { messages: cont2Messages, tools }, { sessionId: "pi-sess-steer-1" });
  const msg3 = await w3.stream.result();
  assert.equal(msg3.stopReason, "stop");
  assert.equal(promptCalls, 1, "should stay in the same warm ACP prompt without dropping binding");

  // Verify second MCP tool call did NOT re-receive the old steer
  assert.ok(secondMcpResult, "expected second MCP tool result");
  assert.equal(secondMcpResult.content.length, 1);
  assert.equal(secondMcpResult.content[0].text, "demo2.txt contents");

  await runtime.close();
}

// 4. End-to-end AntigravityRuntime test: permission-only continuation with mid-turn steer
//    drops the warm binding and replays cleanly into a fresh prompt containing the steer.
{
  const seenPrompts = [];
  let connIndex = 0;

  const fakeFactory = (options) => {
    const myIndex = ++connIndex;
    const state = {
      sessionId: `perm-sess-${myIndex}`,
      modes: { currentModeId: "default", availableModes: [{ id: "default" }, { id: "yolo" }] },
      models: { currentModelId: "gemini-test", availableModels: [{ modelId: "gemini-test" }] },
    };
    const conn = {
      closed: false,
      process: { alive: true, exited: new Promise(() => {}), ignoredStdoutNoiseLines: 0, stderrTail: "" },
      async initialize() {
        return {
          agentInfo: { name: "fake-agy", version: "1.0.0" },
          agentCapabilities: {
            mcpCapabilities: { http: false },
            promptCapabilities: { embeddedContext: true, image: true },
          },
          authMethods: [],
        };
      },
      async newSession() {
        return state;
      },
      getSessionState() {
        return state;
      },
      async setMode(_sid, mode) {
        state.modes.currentModeId = mode;
      },
      async setModel(_sid, modelId) {
        state.models.currentModelId = modelId;
      },
      holdPromptWatchdog() {
        return () => {};
      },
      async cancel() {},
      async close() {
        conn.closed = true;
        conn.process.alive = false;
      },
      async prompt(req) {
        seenPrompts.push(req.prompt);
        if (myIndex === 1) {
          await options.handlers.onPermission({
            sessionId: state.sessionId,
            toolCall: { title: "Run shell" },
            options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
          });
          return { stopReason: "cancelled", usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } };
        }
        options.handlers?.onUpdate?.({
          sessionId: state.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Handled via fresh prompt." } },
        });
        return { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
      },
    };
    return conn;
  };

  const runtime = new AntigravityRuntime(fakeFactory, "default");
  const model = {
    id: "gemini-test",
    name: "Gemini Test",
    api: "antigravity-acp",
    provider: "antigravity-acp",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100000,
    maxTokens: 4096,
  };

  const u0 = { role: "user", content: "Run something", timestamp: 1 };
  const w1 = runtime.stream(model, { messages: [u0], tools: [] }, { sessionId: "pi-sess-perm-1" });
  const msg1 = await w1.stream.result();
  assert.equal(msg1.stopReason, "toolUse", `expected toolUse, got ${msg1.stopReason}: ${msg1.errorMessage}`);
  const permCall = msg1.content.find((b) => b.type === "toolCall");
  assert.ok(permCall, "expected permission toolCall");

  const contMessages = [
    u0,
    msg1,
    {
      role: "toolResult",
      toolCallId: permCall.id,
      toolName: permCall.name,
      content: [{ type: "text", text: "Allowed" }],
      details: { kind: "antigravity_acp_permission_result", requestId: permCall.id, cancelled: false, optionId: "allow" },
      isError: false,
      timestamp: 2,
    },
    {
      role: "user",
      content: [{ type: "text", text: "STOP: do not run that command, read SPEC.md instead." }],
      timestamp: 3,
    },
  ];
  const w2 = runtime.stream(model, { messages: contMessages, tools: [] }, { sessionId: "pi-sess-perm-1" });
  const msg2 = await w2.stream.result();
  assert.equal(msg2.stopReason, "stop");
  assert.equal(seenPrompts.length, 2, "permission-only steer should reconstruct into a fresh prompt");
  const replayText = JSON.stringify(seenPrompts[1]);
  assert.match(replayText, /STOP: do not run that command, read SPEC\.md instead\./);

  await runtime.close();
}

console.log("ALL antigravity-continuation-steer checks passed.");
