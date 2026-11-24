// Test harness for ~/.pi/agent/extensions/ask-guard.ts
// Run: node __PI_HOME__/.pi/agent/tests/ask-guard.test.mjs
// Exit code 0 = all checks passed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolvePiRoot() {
  const candidates = [
    process.env.PI_GLOBAL_NODE_MODULES,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : '',
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(path.join(c, '@earendil-works', 'pi-coding-agent'))) return c;
  }
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8' }).trim();
}

const JITI_DIR =
  process.env.JITI_DIR ||
  path.join(resolvePiRoot(), '@earendil-works', 'pi-coding-agent', 'node_modules', 'jiti');
const require = createRequire(JITI_DIR + '/');
const jitiMod = require(JITI_DIR);
const createJiti = jitiMod.createJiti || jitiMod.default || jitiMod;
const jiti = createJiti(import.meta.url);

const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(AGENT_DIR, 'extensions', 'ask-guard.ts');
const m = await jiti.import(EXT);
const detect = m.detectPlainTextQuestion;
const strip = m.stripNonProse;
const ext = m.default;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

// ---- detector: positives ----
const positives = [
  'I fixed the layout. Should I also update the README?',
  'Done.\n\nWhich color do you want: blue or green?',
  '**Question?**\n\nDo you want me to commit?',
  'Ready. Want me to delete the temp files?',
  'What should the default be? \u{1F642}',
  'Two options here:\n1. Ship now\n2. Wait\nWhich one?',
  '- Option A\n- Option B\n\nPick one?',
];
for (const t of positives) check('positive: ' + JSON.stringify(t.slice(-30)), detect(t) !== null, '-> ' + String(detect(t)));

// ---- detector: negatives ----
const negatives = [
  ['All tests pass. Nothing else needed.', 'statement'],
  ['Here is how it works: does X? yes it does.', 'question answered inline'],
  ['```\nDid it work?\n```', 'code block only'],
  ['You asked: should it be red?', 'refers to user words'],
  ['Q: is it ready?', 'q prefix'],
  ['Run `npm test -- --watch?`', 'inline code only'],
  ['Docs: https://example.com/a?b=1', 'url'],
  ['What about `config?`', 'question mark inside code'],
  ['He said "is it done?" to me.', 'quoted phrase'],
  ['', 'empty'],
  ['Steps:\n```sh\nnpm run build\n```\nDone.', 'trailing fence'],
];
for (const [t, why] of negatives) check('negative(' + why + ')', detect(t) === null, '-> ' + String(detect(t)));

check('strip removes fence', !strip('a\n```\nb?\n```').includes('b?'));
check('strip keeps prose', strip('Keep me').includes('Keep me'));

// ---- handler behaviour ----
function makeHarness(opts = {}) {
  const handlers = new Map();
  const commands = new Map();
  const notes = [];
  const pi = {
    on: (name, fn) => { handlers.set(name, fn); },
    registerCommand: (name, def) => { commands.set(name, def); },
    getActiveTools: () => opts.tools ?? ['ask_user_question', 'read', 'bash'],
  };
  ext(pi);
  const ctx = { hasUI: opts.hasUI ?? true, mode: 'tui', ui: { notify: (t, l) => notes.push([l, t]) } };
  const assistant = (text) => ({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] });
  const turnEnd = (message, toolResults = []) => {
    const event = { outcome: 'completed', message, toolResults, messageEntryId: 'e1', entries: [], continue: false };
    return Promise.resolve(handlers.get('turn_end')(event, ctx));
  };
  const input = (text = 'hi', source = 'interactive') => handlers.get('input')({ text, source, images: [] }, ctx);
  return { handlers, commands, notes, turnEnd, assistant, input, ctx };
}

{
  const h = makeHarness();
  const r = await h.turnEnd(h.assistant('Let me know. Should I proceed with the refactor?'));
  check('nudge: returns continuation', !!r && r.continue === true, JSON.stringify(r));
  check('nudge: appends one entry', !!r && r.entries.length === 1 && r.entries[0].type === 'custom_message');
  check('nudge: entry hidden from UI', !!r && r.entries[0].display === false);
  check('nudge: entry names the tool', !!r && r.entries[0].content.includes('ask_user_question'));
  check('nudge: entry quotes question', !!r && r.entries[0].content.includes('Should I proceed with the refactor?'));
  check('nudge: notifies user', h.notes.some(([lvl]) => lvl === 'warning'));
}
{
  const h = makeHarness();
  check('skip: no question', (await h.turnEnd(h.assistant('All done, tests pass.'))) === undefined);
  check('skip: tool results present', (await h.turnEnd(h.assistant('Ok?'), [{ toolName: 'read' }])) === undefined);
  check('skip: toolCall in message', (await h.turnEnd({ role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Reading. Which file?' }, { type: 'toolCall', name: 'read', arguments: {} }] })) === undefined);
  check('skip: truncated (length)', (await h.turnEnd({ role: 'assistant', stopReason: 'length', content: [{ type: 'text', text: 'Shall I continue with the nex' }] })) === undefined);
}
{
  const h = makeHarness({ hasUI: false });
  check('skip: no UI', (await h.turnEnd(h.assistant('Should I proceed?'))) === undefined);
}
{
  const h = makeHarness({ tools: ['read', 'bash'] });
  check('skip: tool inactive', (await h.turnEnd(h.assistant('Should I proceed?'))) === undefined);
}
{
  const h = makeHarness();
  const q = h.assistant('Do you want the short or long version?');
  const r1 = await h.turnEnd(q);
  const r2 = await h.turnEnd(q);
  const r3 = await h.turnEnd(q);
  check('cap: first nudge fires', !!r1 && r1.continue === true);
  check('cap: second nudge fires', !!r2 && r2.continue === true);
  check('cap: third is blocked', r3 === undefined);
  check('cap: limit notified', h.notes.some(([lvl, t]) => lvl === 'warning' && t.includes('limit')));
  await h.input();
  const r4 = await h.turnEnd(q);
  check('cap: new user message resets budget', !!r4 && r4.continue === true);
}
{
  const h = makeHarness();
  const q = h.assistant('Should I proceed?');
  await h.turnEnd(q); await h.turnEnd(q); await h.turnEnd(q);
  await h.commands.get('ask-guard').handler('off', h.ctx);
  await h.input();
  check('toggle: off disables', (await h.turnEnd(q)) === undefined);
  await h.commands.get('ask-guard').handler('on', h.ctx);
  await h.input();
  check('toggle: on re-enables', !!(await h.turnEnd(q)));
  await h.commands.get('ask-guard').handler('', h.ctx);
  check('toggle: status prints state', h.notes.some(([, t]) => t.includes('ask-guard ON')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
