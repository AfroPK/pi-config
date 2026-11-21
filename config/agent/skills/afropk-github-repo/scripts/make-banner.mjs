#!/usr/bin/env node
// AfroPK repo art: renders header.png (1280x320 @2x), social-preview.png (1280x640),
// footer.png (1280x140 @2x) and one section-<name>.png bar (1280x96 @2x) per README section
// in the AfroPK brand (ink + magenta, Anton skewed -10deg, outline AFROPK rows, Brace Pad logo).
//
// node make-banner.mjs --title "TUNIC CO-OP" --tagline "seamless online co-op" --tag mod \
//   --repo AfroPK/tunic-seamless-coop --desc "2-8 players, shared world" --out <repo>/.github/assets
//
// Needs Playwright (global npm install is fine; it is found via `npm root -g`).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'assets');

// ---------- args ----------
const args = {};
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) {
  if (av[i].startsWith('--')) {
    const k = av[i].slice(2);
    const v = av[i + 1] && !av[i + 1].startsWith('--') ? av[++i] : 'true';
    args[k] = v;
  }
}
if (!args.title) {
  console.error('usage: make-banner.mjs --title "NAME" [--tagline "..."] [--tag dev] [--repo AfroPK/name] [--desc "..."] [--sections "about,setup"] [--out dir] [--only header,social,footer,sections]');
  process.exit(2);
}
const title = args.title.toUpperCase();
const tagline = args.tagline || 'play games · make games';
const tag = (args.tag || 'dev').toLowerCase();
const repo = args.repo || '';
const desc = args.desc || '';
const out = resolve(args.out || '.');
const only = args.only || 'all';
// README section bars: --sections "about,features,setup,how it works,notes"
const sections = (args.sections || 'about,features,setup,how it works,notes').split(',').map((x) => x.trim()).filter(Boolean);
const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
mkdirSync(out, { recursive: true });

// ---------- playwright ----------
function loadPlaywright() {
  const tryReq = (base) => { try { return createRequire(join(base, 'x.js'))('playwright'); } catch { return null; } };
  let pw = tryReq(process.cwd()) || tryReq(here);
  if (!pw) {
    try { pw = tryReq(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch {}
  }
  if (!pw) {
    console.error('Playwright not found. Install it: npm i -g playwright && npx playwright install chromium');
    process.exit(3);
  }
  return pw;
}

// ---------- fonts / logo ----------
const font = (f) => `data:font/ttf;base64,${readFileSync(join(assets, 'fonts', f)).toString('base64')}`;
const css = `
@font-face{font-family:Anton;src:url(${font('Anton-Regular.ttf')})}
@font-face{font-family:Barlow;font-weight:700;font-style:italic;src:url(${font('BarlowCondensed-BoldItalic.ttf')})}
@font-face{font-family:Barlow;font-weight:600;font-style:italic;src:url(${font('BarlowCondensed-SemiBoldItalic.ttf')})}
@font-face{font-family:Barlow;font-weight:500;font-style:normal;src:url(${font('BarlowCondensed-Medium.ttf')})}
@font-face{font-family:Barlow;font-weight:700;font-style:normal;src:url(${font('BarlowCondensed-Bold.ttf')})}
@font-face{font-family:JBM;font-weight:800;src:url(${font('JetBrainsMono-ExtraBold.ttf')})}
:root{--ink:#0B0608;--mag:#D6246E;--hot:#FF4F9A;--white:#FFFFFF;--line:rgba(214,36,110,.42)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--ink)}
.stage{position:relative;overflow:hidden;background:var(--ink);color:var(--white)}
.rows{position:absolute;left:-40px;white-space:nowrap;font-family:Anton;color:transparent;
  -webkit-text-stroke:1.5px var(--line);transform:skewX(-10deg);letter-spacing:4px;line-height:1}
.panel{position:absolute;top:0;bottom:0;right:0;background:var(--mag)}
.slash{position:absolute;inset:0;background:var(--mag)}
.logo{position:absolute;border-radius:50%;background:var(--ink);display:grid;place-items:center}
.logo svg{width:100%;height:100%}
.title{position:absolute;font-family:Anton;line-height:.92;transform:skewX(-10deg);transform-origin:left bottom;white-space:nowrap}
.chips{position:absolute;display:flex;gap:16px;transform:skewX(-10deg);transform-origin:left top}
.chip{padding:6px 22px 8px;font-family:Barlow;font-weight:700;font-style:italic;white-space:nowrap}
.chip.mag{background:var(--mag);color:var(--white)}
.chip.tag{background:var(--white);color:var(--ink);font-family:JBM;font-style:normal;font-weight:800}
.desc{position:absolute;font-family:Barlow;font-weight:500;color:#e9dde2;line-height:1.2}
.url{position:absolute;font-family:JBM;font-weight:800;color:var(--hot)}
.base{position:absolute;left:0;right:0;bottom:0;background:var(--mag)}
`;
const logoSvg = readFileSync(join(assets, 'logo.svg'), 'utf8');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rowText = Array(8).fill('AFROPK').join(' ');

function headerHtml() {
  // 1280x320
  return `<div class="stage" id="s" style="width:1280px;height:320px">
  <div class="rows" style="top:-38px;font-size:120px">${rowText}</div>
  <div class="rows" style="top:252px;font-size:120px;left:-180px">${rowText}</div>
  <div class="panel" style="width:430px;clip-path:polygon(60px 0,100% 0,100% 100%,0 100%)"></div>
  <div class="slash" style="clip-path:polygon(862px 0,880px 0,820px 100%,802px 100%)"></div>
  <div class="logo" style="right:72px;top:32px;width:256px;height:256px">${logoSvg}</div>
  <div class="title" id="t" data-max="720" style="left:70px;bottom:130px;font-size:118px">${esc(title)}</div>
  <div class="chips" style="left:62px;top:196px">
    <div class="chip mag" style="font-size:32px">${esc(tagline)}</div>
    <div class="chip tag" style="font-size:28px;padding-top:8px">{ ${esc(tag)} }</div>
  </div>
  <div class="base" style="height:6px"></div>
</div>`;
}

function socialHtml() {
  // 1280x640 (GitHub social preview size)
  return `<div class="stage" id="s" style="width:1280px;height:640px">
  <div class="rows" style="top:-52px;font-size:150px">${rowText}</div>
  <div class="rows" style="top:548px;font-size:150px;left:-220px">${rowText}</div>
  <div class="panel" style="width:420px;clip-path:polygon(80px 0,100% 0,100% 100%,0 100%)"></div>
  <div class="slash" style="clip-path:polygon(888px 0,908px 0,828px 100%,808px 100%)"></div>
  <div class="logo" style="right:56px;top:180px;width:280px;height:280px">${logoSvg}</div>
  <div class="title" id="t" data-max="760" style="left:76px;bottom:362px;font-size:150px">${esc(title)}</div>
  <div class="chips" style="left:66px;top:300px">
    <div class="chip mag" style="font-size:36px">${esc(tagline)}</div>
    <div class="chip tag" style="font-size:30px;padding-top:9px">{ ${esc(tag)} }</div>
  </div>
  ${desc ? `<div class="desc" id="d" style="left:78px;top:392px;width:740px;font-size:32px">${esc(desc)}</div>` : ''}
  ${repo ? `<div class="url" style="left:78px;bottom:116px;font-size:24px">github.com/${esc(repo)}</div>` : ''}
  <div class="base" style="height:8px"></div>
</div>`;
}

function sectionHtml(name, i) {
  // 1280x96 README section bar: number chip, skewed title, outline echo, magenta tail
  const n = String(i + 1).padStart(2, '0');
  return `<div class="stage" id="s" style="width:1280px;height:96px">
  <div class="rows" style="top:-6px;left:420px;font-size:110px">${esc(name.toUpperCase())} ${esc(name.toUpperCase())}</div>
  <div class="chips" style="left:18px;top:18px;gap:14px;align-items:stretch">
    <div class="chip mag" style="font-family:JBM;font-style:normal;font-weight:800;font-size:30px;padding:6px 18px">${n}</div>
    <div class="title" id="t" data-max="900" style="position:static;transform:none;font-size:56px;line-height:60px;color:#fff">${esc(name.toUpperCase())}</div>
  </div>
  <div class="slash" style="clip-path:polygon(1150px 0,1162px 0,1146px 100%,1134px 100%)"></div>
  <div class="panel" style="width:110px;clip-path:polygon(16px 0,100% 0,100% 100%,0 100%)"></div>
  <div class="base" style="height:4px"></div>
</div>`;
}

function footerHtml() {
  // 1280x140 README footer strip
  return `<div class="stage" id="s" style="width:1280px;height:140px">
  <div class="rows" style="top:-10px;font-size:150px">${rowText}</div>
  <div class="panel" style="width:300px;clip-path:polygon(26px 0,100% 0,100% 100%,0 100%)"></div>
  <div class="slash" style="clip-path:polygon(952px 0,966px 0,940px 100%,926px 100%)"></div>
  <div class="logo" style="right:96px;top:14px;width:112px;height:112px">${logoSvg}</div>
  <div class="title" id="t" data-max="620" style="left:40px;bottom:50px;font-size:56px">PLAY GAMES · MAKE GAMES</div>
  <div class="url" style="left:44px;bottom:14px;font-size:18px">{ AfroPK }${repo ? ' · github.com/' + esc(repo) : ''}</div>
  <div class="base" style="height:6px"></div>
</div>`;
}

async function render(browser, html, file, scale) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: scale });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    // shrink the title until it fits its lane
    const t = document.getElementById('t');
    if (!t) return;
    const max = +t.dataset.max;
    let size = parseFloat(t.style.fontSize);
    while (t.scrollWidth > max && size > 40) { size -= 2; t.style.fontSize = size + 'px'; }
    // clamp description to 3 lines
    const d = document.getElementById('d');
    if (d) {
      const lh = parseFloat(getComputedStyle(d).lineHeight);
      let fs = parseFloat(d.style.fontSize);
      while (d.scrollHeight > lh * 3 + 2 && fs > 22) { fs -= 1; d.style.fontSize = fs + 'px'; }
    }
  });
  await page.locator('#s').screenshot({ path: file });
  await page.close();
  console.log('wrote', file);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
try {
  const want = (k) => only === 'all' || only.split(',').includes(k);
  if (want('header')) await render(browser, headerHtml(), join(out, 'header.png'), 2);
  if (want('social')) await render(browser, socialHtml(), join(out, 'social-preview.png'), 1);
  if (want('footer')) await render(browser, footerHtml(), join(out, 'footer.png'), 2);
  if (want('sections')) for (const [i, name] of sections.entries()) {
    await render(browser, sectionHtml(name, i), join(out, `section-${slug(name)}.png`), 2);
  }
} finally {
  await browser.close();
}
