import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";
import { pathToFileURL } from "url";

/**
 * look: lets a text-only local model see. Sends images (or screenshots of a web page it opens in Chrome via Playwright)
 * to a vision model and returns its answer as text. Default since 2026-11-20: OpenRouter claude-haiku-5.5 (see below);
 * nothing on this PC is swapped and the Pi session keeps running.
 * Replaces model-chain.ts / call_model (2026-11-02).
 */

// Since 2026-11-20: OpenRouter anthropic/claude-haiku-5.5 ($0.10/M in, $0.50/M out; ~$0.001 per large screenshot; reasoning
// switched off below). Picked after a real-screenshot test (~/look-bench/cases/user1.png): it was the only model that caught the
// clipped "YOU 11"/"YOUR TURN" labels and the "!" mark with no false alarms; Qwen and Gemma missed them and invented problems.
// Cheaper alternatives: PI_VISION_MODEL=qwen/qwen3.7-flash or google/gemma-4-26b-a4b-it (or restore look.ts.bak-20261120-qwen37flash).
// Previous default (2026-11-19): google/gemma-4-26b-a4b-it (29/33 in the vision benchmark, ~2 s, ~$0.04 per 1000 images):
// restore with PI_VISION_MODEL=google/gemma-4-26b-a4b-it or look.ts.bak-20261120-qwen37flash.
// Back to HomeLab E2B: PI_VISION_URL=http://192.168.0.117:8095/v1/chat/completions PI_VISION_MODEL=gemma4-e2b-vision
// (or restore look.ts.bak-20261119-homelab).
const VISION_URL = process.env.PI_VISION_URL || "https://openrouter.ai/api/v1/chat/completions";
const VISION_MODEL = process.env.PI_VISION_MODEL || "anthropic/claude-haiku-5.5";
// OpenRouter key: OPENROUTER_API_KEY, else openrouter.key from Pi's auth.json. Only sent to openrouter.ai.
function visionHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!/openrouter\.ai/i.test(VISION_URL)) return h;
  let key = process.env.OPENROUTER_API_KEY || "";
  if (!key) {
    try {
      const auth = JSON.parse(readFileSync(join(process.env.USERPROFILE || process.env.HOME || "", ".pi", "agent", "auth.json"), "utf8"));
      key = String(auth?.openrouter?.key || "");
    } catch {}
  }
  if (!key) throw new Error("look: no OpenRouter key (set OPENROUTER_API_KEY or openrouter.key in ~/.pi/agent/auth.json)");
  h.Authorization = `Bearer ${key}`;
  h["X-Title"] = "pi-look";
  return h;
}
// Page screenshots use the globally installed playwright package driving the installed Chrome (no browser download).
// Plain `chrome --headless --screenshot` can't go below ~500 px wide, so its "phone" shots are wrong.
function loadPlaywright() {
  return createRequire(join(process.env.APPDATA || "", "npm", "node_modules") + "/")("playwright");
}

const lookSchema = Type.Object({
  question: Type.String({
    description: "What to check or describe, e.g. 'Is anything overlapping, cut off, unstyled or unreadable?'",
  }),
  images: Type.Optional(Type.Array(Type.String(), { description: "PNG/JPG/WebP files to look at (paths)." })),
  page: Type.Optional(
    Type.String({
      description:
        "An HTML file path or http(s) URL. It is opened in Chrome (Playwright) at desktop (1280x800) and phone (375x812) size: overflow and console errors are measured, and both screenshots are checked.",
    }),
  ),
});

// Screenshots the page at desktop and phone size; also returns facts that need no vision model.
async function shootPage(url: string, dir: string) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome" });
  const shots: { label: string; file: string }[] = [];
  const facts: string[] = [];
  try {
    for (const [w, h, name] of [[1280, 800, "desktop"], [375, 812, "phone"]] as const) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(url, { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(800);
      const sw: number = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > w) {
        // Name the culprits: the outermost elements whose right edge passes the viewport, so the model can go
        // straight to the CSS instead of writing its own measuring scripts.
        const culprits: string[] = await page.evaluate((vw: number) => {
          const desc = (el: Element) => {
            const id = el.id ? "#" + el.id : "";
            const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
            return el.tagName.toLowerCase() + id + cls;
          };
          const out: string[] = [];
          for (const el of Array.from(document.body.querySelectorAll("*"))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= vw + 1) continue;
            const parent = el.parentElement;
            if (parent && parent !== document.body && parent.getBoundingClientRect().right > vw + 1) continue;
            const cs = getComputedStyle(el);
            const pcs = parent ? getComputedStyle(parent) : null;
            // The usual cause: a grid/flex item can't shrink below its content (grid `1fr` = minmax(auto, 1fr)).
            const inGrid = pcs && /grid/.test(pcs.display);
            const inFlex = pcs && /flex/.test(pcs.display);
            out.push(`${desc(el)} (right edge at ${Math.round(r.right)}px, width ${Math.round(r.width)}px` +
              `${cs.minWidth !== "0px" && cs.minWidth !== "auto" ? ", min-width " + cs.minWidth : ""}` +
              `${cs.gridTemplateColumns && cs.gridTemplateColumns !== "none" ? ", own grid columns " + cs.gridTemplateColumns : ""})` +
              (inGrid ? ` - it is a grid item of ${desc(parent!)} whose source columns don't shrink below content: write that grid's columns as minmax(0, 1fr) (not 1fr) in the rule that applies at this width, or give the item min-width: 0`
                : inFlex ? ` - it is a flex item of ${desc(parent!)}: give it min-width: 0 (and flex-wrap: wrap on the parent if needed)` : ""));
            if (out.length >= 5) break;
          }
          return out;
        }, w);
        facts.push(`${name} ${w}px: page is ${sw}px wide, so it scrolls sideways (horizontal overflow of ${sw - w}px). This is a real, repeatable layout bug, not a glitch. ` +
          (culprits.length ? `Elements sticking out past ${w}px: ${culprits.join("; ")}. Fix their CSS (fixed widths, min-width, grid columns that can't shrink, long unbroken text), then call look again.`
                           : `Find the element wider than the viewport, fix its CSS, then call look again.`));
      }
      for (const e of errors.filter((e) => !/favicon\.ico/.test(e)).slice(0, 5)) facts.push(`${name}: console error: ${e.slice(0, 200)}`);
      const out = join(dir, `${name}.png`);
      await page.screenshot({ path: out });
      shots.push({ label: `${name} ${w}px (${out})`, file: out });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return { shots, facts };
}

async function ask(question: string, file: string, signal?: AbortSignal): Promise<string> {
  const ext = file.toLowerCase().split(".").pop();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  const b64 = readFileSync(file).toString("base64");
  const res = await fetch(VISION_URL, {
    method: "POST",
    headers: visionHeaders(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 1200,
      temperature: 0.2,
      // Qwen and Haiku can reason first, which only burns output tokens on screenshot questions (OpenRouter only).
      ...(/openrouter\.ai/i.test(VISION_URL) && /qwen|haiku/i.test(VISION_MODEL) ? { reasoning: { enabled: false } } : {}),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question + "\nAnswer concretely: name what you see and where. If something is fine, say so briefly." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`vision server HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim() || "(empty answer)";
}

// Text-only models can't use image blocks (pasted, dropped, @file, or returned by read). Before each model call, save
// every image to a file and replace it with a note that points at `look`. Vision models (input includes "image") get
// the images as they are.
const IMAGE_DIR = join(tmpdir(), "pi-look-images");
function imageToNote(block: any): any {
  const ext = String(block.mimeType || "image/png").split("/")[1]?.replace("jpeg", "jpg") || "png";
  const data = String(block.data || "");
  const file = join(IMAGE_DIR, createHash("sha1").update(data).digest("hex").slice(0, 16) + "." + ext);
  if (!existsSync(file)) {
    mkdirSync(IMAGE_DIR, { recursive: true });
    writeFileSync(file, Buffer.from(data, "base64"));
  }
  const p = file.replace(/\\/g, "/");
  return { type: "text", text: `[image saved at ${p} - you can't see images directly; call look with images=["${p}"] and your question]` };
}

export default function (pi: ExtensionAPI) {
  pi.on("context", async (event, ctx) => {
    if ((ctx.model?.input ?? ["text"]).includes("image")) return;
    let changed = false;
    const messages = event.messages.map((m: any) => {
      if (!Array.isArray(m.content) || !m.content.some((c: any) => c?.type === "image")) return m;
      changed = true;
      return { ...m, content: m.content.map((c: any) => (c?.type === "image" ? imageToNote(c) : c)) };
    });
    if (changed) return { messages };
  });

  pi.registerTool({
    name: "look",
    label: "Look",
    description:
      "See images or a rendered web page through a vision model (Claude Haiku 5.5 on OpenRouter): returns a text description/answer. " +
      "Good at: what is happening in a frame, blank or error screens, broken or overlapping layout, unreadable text, missing elements, overall look. " +
      "Weaker at: very fine detail (thin lines, exact pixel positions, tiny text). Takes a few seconds per image.",
    promptSnippet: "Use look to see screenshots or check how a web page/UI you built actually renders",
    promptGuidelines: [
      "After building or changing a UI, call look with page=<the html file or URL> and ask about layout problems before saying done.",
      "When the user gives an image path, call look with images=[path] instead of reading the image file yourself.",
      "The Measured section is reliable; the vision answers come from a mid-size model and can miss detail, so verify a reported visual bug in the code before changing things, and never treat no complaints as proof the UI is good.",
    ],
    parameters: lookSchema,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const cwd = ctx && ctx.cwd ? ctx.cwd : process.cwd();
      const question = String(params.question || "Describe this image.");
      const shots: { label: string; file: string }[] = [];
      const facts: string[] = [];
      try {
        for (const p of Array.isArray(params.images) ? params.images : []) {
          const f = isAbsolute(String(p)) ? String(p) : resolve(cwd, String(p));
          if (!existsSync(f)) throw new Error(`image not found: ${p}`);
          shots.push({ label: String(p), file: f });
        }
        if (params.page) {
          const p = String(params.page);
          const url = /^(https?|file):\/\//i.test(p) ? p : pathToFileURL(isAbsolute(p) ? p : resolve(cwd, p)).href;
          const page = await shootPage(url, mkdtempSync(join(tmpdir(), "pi-look-")));
          shots.push(...page.shots);
          facts.push(...page.facts);
        }
        if (shots.length === 0) throw new Error("give images=[...] or page=...");
        const answers: string[] = [];
        for (const s of shots) {
          if (signal && signal.aborted) return { content: [{ type: "text", text: "[look cancelled]" }], details: undefined };
          onUpdate?.({ content: [{ type: "text", text: `looking at ${s.label}...` }], details: undefined });
          answers.push(`## ${s.label}\n${await ask(question, s.file, signal)}`);
        }
        const measured = params.page
          ? `## Measured in a real browser (facts, not opinions: fix every item; overflow-x: hidden hides it but is not a fix; you are not done while this section lists a problem)\n${facts.length ? facts.map((f) => "- " + f).join("\n") : "- no horizontal overflow, no console errors"}\n\n`
          : "";
        return { content: [{ type: "text", text: measured + answers.join("\n\n") }], details: undefined };
      } catch (err: any) {
        return { content: [{ type: "text", text: `[look error] ${err?.message || String(err)}` }], details: undefined };
      }
    },
  });
}
