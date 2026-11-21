import { Type } from "typebox";
import { spawn, execFileSync } from "child_process";
import { existsSync, mkdirSync, openSync, writeFileSync, rmSync, statSync } from "fs";
import { isAbsolute, join, resolve } from "path";

/**
 * generate_image: pixel-art generation with ComfyUI (SDXL + pixel-art-xl LoRA) on the same 12 GB GPU the agent's
 * own model uses. Inside one tool call it: unloads llama-swap's model, starts ComfyUI headless if needed, generates
 * every requested image, frees ComfyUI's VRAM (or stops the ComfyUI it started), and returns. The agent's next
 * request makes llama-swap reload its model on its own (~20 s plus re-reading the context).
 * Each image also gets a real pixel-grid version (box downscale, optional palette snap) and a .json with prompt+seed.
 * Set up 2026-11-02; ComfyUI lives in D:\AIWorkspace\ComfyUI (see the comfyui-rocm-setup memory / pixel-art skill).
 */

const COMFY_DIR = process.env.PI_COMFY_DIR || "D:/AIWorkspace/ComfyUI";
const COMFY = "http://127.0.0.1:8188";
const SWAP = process.env.PI_SWAP_URL || "http://127.0.0.1:8080";
const MAGICK = "C:/Program Files/ImageMagick-7.1.2-Q16-HDRI/magick.exe";
const LOCK = join(process.env.TEMP || "C:/Windows/Temp", "pi-generate-image.lock");

// House style: appended to every prompt so a whole game's assets match. Override per call with `style`.
const DEFAULT_STYLE = "pixel art, game asset, clean readable silhouette, crisp 1px dark outline, limited palette, " +
  "soft top-left lighting, detailed shading, centered, single object, plain flat background";
const DEFAULT_NEGATIVE = "3d render, photo, realistic, blurry, jpeg artifacts, text, watermark, signature, " +
  "multiple objects, cropped, frame, border, gradient background, noisy";

const schema = Type.Object({
  images: Type.Array(Type.Object({
    name: Type.String({ description: "File name without extension, e.g. 'seed_gold'" }),
    prompt: Type.String({ description: "What to draw (the subject). The house style is added automatically." }),
    seed: Type.Optional(Type.Integer({ description: "Fixed seed to reproduce or vary an earlier image" })),
  }), { description: "1-8 images per call; batch related assets in one call (the GPU hand-off costs ~1-2 min per call)" }),
  out_dir: Type.Optional(Type.String({ description: "Folder for results (default: art/generated in the project)" })),
  pixel_size: Type.Optional(Type.Integer({ description: "Target sprite size in pixels for the real pixel-grid copy, e.g. 32 or 64 (default 64)" })),
  palette: Type.Optional(Type.String({ description: "PNG whose colours are the game palette; the pixel copy is snapped to it" })),
  colors: Type.Optional(Type.Integer({ description: "If no palette: reduce the pixel copy to this many colours (default 16)" })),
  keep_background: Type.Optional(Type.Boolean({ description: "Keep the generated background in the pixel copy (default: cut the subject out to transparency, for sprites). Use true for tiles, backgrounds, full scenes." })),
  style: Type.Optional(Type.String({ description: "Replaces the default house style text appended to every prompt" })),
  negative: Type.Optional(Type.String({ description: "Replaces the default negative prompt" })),
  steps: Type.Optional(Type.Integer({ description: "Sampling steps (default 25)" })),
  width: Type.Optional(Type.Integer({ description: "Generation width (default 1024)" })),
  height: Type.Optional(Type.Integer({ description: "Generation height (default 1024)" })),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function http(method: string, url: string, body?: unknown, timeoutMs = 30_000) {
  const res = await fetch(url, {
    method, signal: AbortSignal.timeout(timeoutMs),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

async function comfyUp() {
  try { await http("GET", COMFY + "/system_stats", undefined, 3000); return true; } catch { return false; }
}

function workflow(prompt: string, negative: string, seed: number, steps: number, w: number, h: number, prefix: string) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "LoraLoader", inputs: { model: ["1", 0], clip: ["1", 1], lora_name: "pixel-art-xl.safetensors", strength_model: 1.0, strength_clip: 1.0 } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "sdxl_vae_fp16_fix.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: negative } },
    "6": { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["2", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], seed, steps, cfg: 6.5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: prefix } },
  };
}

export default function (pi) {
  pi.registerTool({
    name: "generate_image",
    label: "Generate image",
    description:
      "Generate detailed pixel-art images (SDXL + pixel-art LoRA in ComfyUI) and get real pixel-grid sprites back. " +
      "Handles the GPU itself: your own model is unloaded during generation and reloads on your next turn, so a call " +
      "takes ~1-2 minutes plus ~20 s per extra image. Batch related assets into ONE call.",
    promptSnippet: "Use generate_image for detailed pixel art (sprites, items, board pieces); then clean up the pixel copy",
    promptGuidelines: [
      "Batch: put all related images (variants of one asset, a set of items) in one generate_image call.",
      "Write the subject only in each prompt (materials, shape, colours, viewpoint); the house style is added for you. Keep one style per game by passing the same `style` and `palette` every time.",
      "Results: <name>.png (full detail, 1024 px fake pixel art) and <name>_px.png (real sprite at pixel_size). Use the _px file in the game after cleanup in Aseprite; keep the .json (prompt+seed) to regenerate.",
      "Check each result (view it, or call look) before using it; regenerate with a new seed or a sharper prompt if it misses.",
    ],
    parameters: schema,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const say = (t: string) => onUpdate?.({ content: [{ type: "text", text: t }], details: undefined });
      const cwd = ctx && ctx.cwd ? ctx.cwd : process.cwd();
      const images = (params.images || []).slice(0, 8);
      if (images.length === 0) return { content: [{ type: "text", text: "[generate_image] no images requested" }], details: undefined };
      const outDir = params.out_dir ? (isAbsolute(params.out_dir) ? params.out_dir : resolve(cwd, params.out_dir)) : resolve(cwd, "art/generated");
      mkdirSync(outDir, { recursive: true });
      const style = params.style ?? DEFAULT_STYLE;
      const negative = params.negative ?? DEFAULT_NEGATIVE;
      const steps = params.steps ?? 25, w = params.width ?? 1024, h = params.height ?? 1024;
      const px = params.pixel_size ?? 64;

      // One generation at a time across all Pi sessions (a stale lock older than 30 min is ignored)
      if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs < 30 * 60_000) {
        return { content: [{ type: "text", text: "[generate_image] another generation is running; try again in a few minutes" }], details: undefined };
      }
      writeFileSync(LOCK, String(process.pid));
      let started: ReturnType<typeof spawn> | null = null;
      const lines: string[] = [];
      const t0 = Date.now();
      try {
        // 1. Free the GPU from the agent's own model (llama-swap keeps running and reloads on the next request)
        say("unloading the language model to free the GPU...");
        try { await http("POST", SWAP + "/api/models/unload", undefined, 60_000); } catch { /* llama-swap not running: fine */ }

        // 2. ComfyUI up (start it headless if it isn't running)
        if (!(await comfyUp())) {
          say("starting ComfyUI...");
          const log = openSync(join(COMFY_DIR, "comfyui-agent.log"), "w");
          // --disable-all-custom-nodes: the workflow only uses built-in nodes, and ComfyUI-Manager's startup work made
          // cold starts ~3.5 min slower (measured: 81 s server + 106 s first step vs 13 s + 33 s for the first image)
          started = spawn(join(COMFY_DIR, "venv/Scripts/python.exe"), ["main.py", "--listen", "127.0.0.1", "--port", "8188", "--disable-all-custom-nodes"],
            { cwd: COMFY_DIR, stdio: ["ignore", log, log], windowsHide: true });
          for (let i = 0; i < 180 && !(await comfyUp()); i++) {
            if (signal?.aborted) throw new Error("cancelled");
            if (started.exitCode !== null) throw new Error(`ComfyUI exited early (code ${started.exitCode}); see ${COMFY_DIR}/comfyui-agent.log`);
            await sleep(1000);
          }
          if (!(await comfyUp())) throw new Error("ComfyUI did not start within 3 minutes");
        }

        // 3. Queue every image, then collect results in order
        const jobs: { name: string; seed: number; prompt: string; id: string }[] = [];
        for (const img of images) {
          const seed = img.seed ?? Math.floor(Math.random() * 2 ** 31);
          const prompt = `${img.prompt}, ${style}`;
          const prefix = `agent/${img.name}`;
          const r = await (await http("POST", COMFY + "/prompt", { prompt: workflow(prompt, negative, seed, steps, w, h, prefix) })).json() as any;
          jobs.push({ name: img.name, seed, prompt, id: r.prompt_id });
        }
        for (const [i, job] of jobs.entries()) {
          say(`generating ${i + 1}/${jobs.length}: ${job.name}...`);
          let entry: any = null;
          for (let k = 0; k < 900 && !entry; k++) {
            if (signal?.aborted) throw new Error("cancelled");
            const hist = await (await http("GET", `${COMFY}/history/${job.id}`)).json() as any;
            if (hist[job.id]) entry = hist[job.id];
            else await sleep(2000);
          }
          if (!entry) throw new Error(`${job.name}: timed out`);
          if (entry.status?.status_str !== "success") throw new Error(`${job.name}: ${JSON.stringify(entry.status).slice(0, 400)}`);
          const out = Object.values(entry.outputs as Record<string, any>).flatMap((o: any) => o.images || [])[0];
          const q = new URLSearchParams({ filename: out.filename, subfolder: out.subfolder || "", type: out.type || "output" });
          const png = Buffer.from(await (await http("GET", `${COMFY}/view?${q}`, undefined, 60_000)).arrayBuffer());
          const full = join(outDir, `${job.name}.png`), small = join(outDir, `${job.name}_px.png`), preview = join(outDir, `${job.name}_px_preview.png`);
          writeFileSync(full, png);
          // Real pixel grid. Default: cut the subject out (flood-fill the flat background from the 4 corners to
          // transparent), crop tight, pad to a square, box-filter it down to fill the sprite (1 px margin), make alpha
          // hard (pixel art has no half-transparent edges), then palette snap / colour reduction. 8x preview on grey.
          const snap = params.palette ? ["-remap", isAbsolute(params.palette) ? params.palette : resolve(cwd, params.palette)] : ["-colors", String(params.colors ?? 16)];
          const cut = params.keep_background ? [] : ["-alpha", "set", "-fuzz", "12%", "-fill", "none",
            "-draw", "color 0,0 floodfill", "-draw", `color ${w - 1},0 floodfill`, "-draw", `color 0,${h - 1} floodfill`, "-draw", `color ${w - 1},${h - 1} floodfill`,
            "-trim", "+repage", "-background", "none", "-gravity", "center", "-extent", "%[fx:max(w,h)]x%[fx:max(w,h)]"];
          execFileSync(MAGICK, [full, ...cut, "-filter", "box", "-resize", `${px - 2}x${px - 2}`, "-background", "none", "-gravity", "center",
            "-extent", `${px}x${px}`, "-channel", "A", "-threshold", "50%", "+channel", "-dither", "None", ...snap, small], { timeout: 60_000 });
          execFileSync(MAGICK, [small, "-filter", "point", "-resize", `${px * 8}x${px * 8}`, "-background", "#3a3a4a", "-flatten", preview], { timeout: 60_000 });
          writeFileSync(join(outDir, `${job.name}.json`), JSON.stringify({ prompt: job.prompt, negative, seed: job.seed, steps, width: w, height: h, pixel_size: px, palette: params.palette ?? null, model: "sd_xl_base_1.0 + pixel-art-xl" }, null, 2));
          lines.push(`- ${job.name}: ${small.replace(/\\/g, "/")} (${px}x${px}, preview ${preview.replace(/\\/g, "/")}; full ${full.replace(/\\/g, "/")}; seed ${job.seed})`);
        }
        return { content: [{ type: "text", text: `Generated ${jobs.length} image(s) in ${Math.round((Date.now() - t0) / 1000)} s:\n${lines.join("\n")}\n` +
          "Your model reloads on your next turn (~20 s). Check each _px file before using it." }], details: undefined };
      } catch (err: any) {
        return { content: [{ type: "text", text: `[generate_image error] ${err?.message || String(err)}` + (lines.length ? `\nFinished before the error:\n${lines.join("\n")}` : "") }], details: undefined };
      } finally {
        // 4. Give the GPU back: stop the ComfyUI we started, or ask a running one to drop its models
        if (started) {
          try { execFileSync("taskkill", ["/PID", String(started.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
        } else {
          try { await http("POST", COMFY + "/free", { unload_models: true, free_memory: true }, 30_000); } catch {}
        }
        try { rmSync(LOCK, { force: true }); } catch {}
      }
    },
  });
}
