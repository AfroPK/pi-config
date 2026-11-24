/**
 * dictate — minimal voice dictation for pi, transcribed by Freddy's HomeLab
 * faster-whisper server instead of Deepgram.
 *
 * Adapted from amosblomqvist/pi-dictate (MIT, commit 3208b56). The key handling,
 * focus-aware delivery and level meter are upstream's; the audio/transcription
 * backend is replaced:
 *   - capture: ffmpeg (DirectShow) instead of sox `rec`, which is macOS-centric
 *   - transcription: one POST of the whole recording to an OpenAI-compatible
 *     /v1/audio/transcriptions endpoint on stop (the server does not stream)
 *   - clipboard fallback: Windows Set-Clipboard instead of pbcopy
 *
 * Press alt+m to start, alt+m again to stop and transcribe; alt+n cancels.
 * Text goes to whatever input is focused when the transcript arrives.
 *
 * Settings (environment variables, all optional):
 *   DICTATE_WHISPER_URL    server base URL      (default http://192.168.0.117:8020)
 *   DICTATE_WHISPER_MODEL  model name           (default whisper-1 = large-v3-turbo there)
 *   DICTATE_LANGUAGE       ISO language hint    (default: server's, which is "en")
 *   DICTATE_MIC            DirectShow input     (default the Focusrite "Analogue 1 + 2")
 *   DICTATE_FFMPEG         ffmpeg executable    (default "ffmpeg" on PATH)
 *   DICTATE_DEBUG=1        append lifecycle events to %TEMP%/dictate-debug.log
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, isKeyRelease, isKeyRepeat } from "@earendil-works/pi-tui";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WHISPER_URL = (process.env.DICTATE_WHISPER_URL ?? "http://192.168.0.117:8020").replace(/\/+$/, "");
const WHISPER_MODEL = process.env.DICTATE_WHISPER_MODEL ?? "whisper-1";
const LANGUAGE = process.env.DICTATE_LANGUAGE ?? "";
const MIC = process.env.DICTATE_MIC ?? "Analogue 1 + 2 (2- Focusrite USB Audio)";
const FFMPEG = process.env.DICTATE_FFMPEG ?? "ffmpeg";

const SAMPLE_RATE = 16000;
// Recordings shorter than this are almost always an accidental double-press;
// Whisper tends to hallucinate ("Thank you.") on near-empty audio.
const MIN_AUDIO_MS = 300;
// GTX 1060 transcribes roughly 10x real time; 120 s covers long dictations
// plus a cold model load.
const REQUEST_TIMEOUT_MS = 120_000;

const DEBUG = !!process.env.DICTATE_DEBUG;
const DEBUG_LOG = join(tmpdir(), "dictate-debug.log");
const dbg = (msg: string) => {
  if (!DEBUG) return;
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
};

type State = "idle" | "recording" | "stopping";

// ── Focus-aware delivery (upstream) ───────────────────────────────────────
// The TUI handle is captured once via a zero-height widget factory. With it we
// listen to ALL input before the focused component (so alt+m works inside
// dialogs) and inspect tui.focusedComponent to decide where text goes.
interface EditorLike {
  getText(): string;
  setText(text: string): void;
}
type Target =
  | { kind: "editor"; editor: EditorLike }
  | { kind: "typable"; component: { handleInput(data: string): void } };

const asEditorLike = (value: any): EditorLike | null =>
  value && typeof value.getText === "function" && typeof value.setText === "function" ? value : null;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

const METER_CELLS = 6;
const METER_TICK_MS = 60;
const PEAK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const METER_FLOOR_DB = -50;
const METER_CEILING_DB = -10;

/** Normalized RMS (0..1) of signed 16-bit little-endian PCM. */
export function rmsFromPcm16(buf: Buffer): number {
  const sampleCount = Math.floor(buf.length / 2);
  if (sampleCount === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount * 2; i += 2) {
    const s = buf.readInt16LE(i);
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / sampleCount) / 32768;
}

function rmsToBlock(rms: number): string {
  if (rms <= 0) return PEAK_BLOCKS[0]!;
  const db = 20 * Math.log10(rms);
  const t = Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB)));
  return PEAK_BLOCKS[Math.floor(t * (PEAK_BLOCKS.length - 1))]!;
}

/** Wrap mono 16-bit PCM in a minimal RIFF/WAVE header. */
export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** POST a WAV to an OpenAI-compatible transcription endpoint and return the text. */
export async function transcribe(
  wav: Buffer,
  opts: { url?: string; model?: string; language?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "dictation.wav");
  form.append("model", opts.model ?? WHISPER_MODEL);
  form.append("response_format", "json");
  const language = opts.language ?? LANGUAGE;
  if (language) form.append("language", language);
  const res = await fetch(`${opts.url ?? WHISPER_URL}/v1/audio/transcriptions`, {
    method: "POST",
    body: form,
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  const data: any = await res.json();
  return typeof data?.text === "string" ? data.text.replace(/\s+/g, " ").trim() : "";
}

function copyToClipboard(text: string): void {
  if (process.platform === "win32") {
    // clip.exe mangles non-ASCII; Set-Clipboard with UTF-8 stdin does not.
    const p = spawn(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
      ],
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
    );
    p.stdin.end(text);
  } else {
    const p = spawn(process.platform === "darwin" ? "pbcopy" : "xclip", process.platform === "darwin" ? [] : ["-selection", "clipboard"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    p.stdin.end(text);
  }
}

function recorderArgs(): string[] {
  const input =
    process.platform === "win32"
      ? ["-f", "dshow", "-audio_buffer_size", "20", "-i", `audio=${MIC}`]
      : process.platform === "darwin"
        ? ["-f", "avfoundation", "-i", `:${MIC}`]
        : ["-f", "pulse", "-i", MIC];
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    ...input,
    "-ac", "1",
    "-ar", String(SAMPLE_RATE),
    "-f", "s16le",
    "-flush_packets", "1",
    "-",
  ];
}

export default function (pi: ExtensionAPI) {
  let state: State = "idle";
  let rec: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let chunks: Buffer[] = [];
  let recStderr = "";
  let activeCtx: ExtensionContext | null = null;
  let abort: AbortController | null = null;
  let spinnerTimer: NodeJS.Timeout | null = null;
  let spinnerFrame = 0;
  // Session generation: handlers from an older session no-op so a late exit
  // or HTTP reply can never tear down or write into the current one.
  let generation = 0;
  let meterTimer: NodeJS.Timeout | null = null;
  let meter: number[] = new Array(METER_CELLS).fill(0);
  let currentLevel = 0;

  const setStatus = (msg: string | undefined) => {
    activeCtx?.ui.setStatus("dictate", msg);
  };

  const stopSpinner = () => {
    if (spinnerTimer) clearInterval(spinnerTimer);
    spinnerTimer = null;
  };

  const stopMeter = () => {
    if (meterTimer) clearInterval(meterTimer);
    meterTimer = null;
  };

  const startMeter = () => {
    stopMeter();
    meter = new Array(METER_CELLS).fill(0);
    currentLevel = 0;
    const render = () => {
      const dot = activeCtx?.ui.theme.fg("error", "●") ?? "●";
      setStatus(`${dot} ${meter.map(rmsToBlock).join("")} listening…`);
    };
    render();
    meterTimer = setInterval(() => {
      meter.shift();
      meter.push(currentLevel);
      render();
    }, METER_TICK_MS);
  };

  const startSpinner = (suffix: string) => {
    stopSpinner();
    spinnerFrame = 0;
    setStatus(`${SPINNER_FRAMES[0]} ${suffix}`);
    spinnerTimer = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      setStatus(`${SPINNER_FRAMES[spinnerFrame]} ${suffix}`);
    }, SPINNER_INTERVAL_MS);
  };

  let tuiHandle: any = null;
  let removeInputListener: (() => void) | null = null;
  let lastCtx: ExtensionContext | null = null;

  const resolveTarget = (): Target | null => {
    const focused = tuiHandle?.getFocusedComponent?.() ?? tuiHandle?.focusedComponent;
    if (!focused) return null;
    const editor = asEditorLike(focused) ?? asEditorLike(focused.editor);
    if (editor) return { kind: "editor", editor };
    if (typeof focused.handleInput === "function") return { kind: "typable", component: focused };
    return null;
  };

  /** Put the transcript into whatever is focused now; clipboard if nothing is. */
  const deliver = (ctx: ExtensionContext, text: string) => {
    if (!text) return;
    if (!tuiHandle) {
      const current = ctx.ui.getEditorText() ?? "";
      const sep = current && !/\s$/.test(current) ? " " : "";
      ctx.ui.setEditorText(current + sep + text);
      return;
    }
    const target = resolveTarget();
    if (target?.kind === "editor") {
      const current = target.editor.getText() ?? "";
      const sep = current && !/\s$/.test(current) ? " " : "";
      target.editor.setText(current + sep + text);
      tuiHandle.requestRender?.();
      return;
    }
    if (target?.kind === "typable") {
      target.component.handleInput(text);
      tuiHandle.requestRender?.();
      return;
    }
    try {
      copyToClipboard(text);
    } catch {}
    ctx.ui.notify("Dictation finished but no input field is focused — transcript copied to clipboard", "warning");
  };

  const killRecorder = () => {
    if (!rec) return;
    try {
      rec.kill();
    } catch {}
    rec = null;
  };

  const cleanup = () => {
    generation++;
    dbg(`cleanup → gen ${generation}`);
    stopSpinner();
    stopMeter();
    killRecorder();
    abort?.abort();
    abort = null;
    chunks = [];
    state = "idle";
    setStatus(undefined);
    activeCtx = null;
  };

  const startDictation = (ctx: ExtensionContext) => {
    activeCtx = ctx;
    chunks = [];
    recStderr = "";
    state = "recording";
    const myGeneration = ++generation;
    dbg(`start (gen ${myGeneration}) mic=${MIC}`);
    startMeter();

    let proc: ChildProcessByStdio<null, Readable, Readable>;
    try {
      proc = spawn(FFMPEG, recorderArgs(), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e: any) {
      ctx.ui.notify(`Could not start ffmpeg: ${e.message}`, "error");
      cleanup();
      return;
    }
    rec = proc;

    proc.stdout.on("data", (chunk: Buffer) => {
      if (myGeneration !== generation) return;
      chunks.push(chunk);
      currentLevel = rmsFromPcm16(chunk);
    });
    proc.stderr.on("data", (d: Buffer) => {
      recStderr = (recStderr + d.toString()).slice(-400);
    });
    proc.on("error", (err) => {
      if (myGeneration !== generation) return;
      ctx.ui.notify(`ffmpeg error: ${err.message} (is ffmpeg on PATH? set DICTATE_FFMPEG)`, "error");
      cleanup();
    });
    proc.on("exit", (code) => {
      if (myGeneration !== generation) return;
      dbg(`ffmpeg exit ${code} (gen ${myGeneration}) ${recStderr.trim()}`);
      // An exit while still recording means the device failed to open or vanished.
      if (state === "recording") {
        const why = recStderr.trim().split(/\r?\n/).pop() || `exit code ${code}`;
        ctx.ui.notify(`Microphone capture stopped: ${why}. Check DICTATE_MIC ("${MIC}").`, "error");
        cleanup();
      }
    });
  };

  const stopDictation = () => {
    if (state !== "recording" || !activeCtx) return;
    const ctx = activeCtx;
    const myGeneration = generation;
    state = "stopping";
    stopMeter();
    killRecorder();
    const pcm = Buffer.concat(chunks);
    chunks = [];
    const ms = (pcm.length / 2 / SAMPLE_RATE) * 1000;
    dbg(`stop (gen ${myGeneration}) ${Math.round(ms)} ms audio`);
    if (ms < MIN_AUDIO_MS) {
      ctx.ui.notify("Recording too short — nothing transcribed", "info");
      cleanup();
      return;
    }

    startSpinner("transcribing…");
    abort = new AbortController();
    const timer = setTimeout(() => abort?.abort(), REQUEST_TIMEOUT_MS);
    transcribe(pcmToWav(pcm), { signal: abort.signal })
      .then((text) => {
        if (myGeneration !== generation) return; // cancelled meanwhile
        dbg(`transcript (gen ${myGeneration}): ${JSON.stringify(text)}`);
        if (!text) ctx.ui.notify("No speech recognised", "info");
        else deliver(ctx, text);
      })
      .catch((err: any) => {
        if (myGeneration !== generation) return;
        const reason = err?.name === "AbortError" ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err?.message ?? String(err);
        ctx.ui.notify(`Whisper transcription failed (${WHISPER_URL}): ${reason}`, "error");
      })
      .finally(() => {
        clearTimeout(timer);
        if (myGeneration === generation) cleanup();
      });
  };

  /** Discard the recording or the in-flight transcription. */
  const cancelDictation = () => {
    if (state === "idle") return;
    dbg(`cancel in state ${state}`);
    cleanup();
  };

  const toggleDictation = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (state === "idle") {
      if (tuiHandle && !resolveTarget()) {
        ctx.ui.notify("No input field is focused — dictation not started", "warning");
        return;
      }
      startDictation(ctx);
    } else if (state === "recording") {
      stopDictation();
    }
    // Presses while transcribing are ignored; alt+n cancels.
  };

  const onGlobalInput = (data: string) => {
    // Kitty terminals also send repeat/release events; only presses toggle.
    if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;
    if (matchesKey(data, Key.alt("m"))) {
      dbg(`alt+m state=${state}`);
      if (lastCtx) toggleDictation(lastCtx);
      return { consume: true };
    }
    if (matchesKey(data, Key.alt("n"))) {
      dbg(`alt+n state=${state}`);
      cancelDictation();
      return { consume: true };
    }
    return undefined;
  };

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    if (ctx.mode !== "tui" || tuiHandle) return;
    ctx.ui.setWidget("dictate-tui-handle", (tui: any) => {
      tuiHandle = tui;
      removeInputListener = tui.addInputListener(onGlobalInput);
      return { render: () => [], invalidate: () => {} };
    });
  });

  pi.registerShortcut(Key.alt("m"), {
    description: "Toggle voice dictation (HomeLab Whisper)",
    handler: async (ctx) => {
      toggleDictation(ctx);
    },
  });

  pi.registerShortcut(Key.alt("n"), {
    description: "Cancel voice dictation (discard transcript)",
    handler: async () => {
      cancelDictation();
    },
  });

  pi.registerCommand("dictate-check", {
    description: "Check the dictation mic and Whisper server",
    handler: async (_args, ctx) => {
      try {
        const res = await fetch(`${WHISPER_URL}/health`, { signal: AbortSignal.timeout(5000) });
        ctx.ui.notify(
          `Whisper ${WHISPER_URL}: ${res.ok ? "reachable" : `HTTP ${res.status}`} · model ${WHISPER_MODEL} · mic "${MIC}"`,
          res.ok ? "info" : "warning",
        );
      } catch (e: any) {
        ctx.ui.notify(`Whisper ${WHISPER_URL} unreachable: ${e?.message ?? e}`, "error");
      }
    },
  });

  pi.on("session_shutdown", () => {
    if (state !== "idle") cleanup();
    removeInputListener?.();
    removeInputListener = null;
  });
}
