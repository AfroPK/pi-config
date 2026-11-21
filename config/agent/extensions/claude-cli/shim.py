"""Local OpenAI-compatible endpoint that runs Pi's requests through the official Claude Code CLI.

It reuses the DirectSDK client from Hermes's official `claude-subscription-directsdk` plugin
(MIT, Nous Research), which drives the unmodified `claude` executable: one request-scoped
`claude -p` process per model call, billed by Anthropic against the Claude subscription the
CLI is logged into (its Agent SDK allowance). Pi keeps its own agent loop and tools; Claude
only proposes tool calls, which Pi executes.

Run with Hermes's venv Python (DirectSDK imports a few Hermes helpers and reads the plugin's
settings, e.g. extra_usage: stop, from Hermes's config.yaml):

    <hermes>/hermes-agent/venv/Scripts/python.exe shim.py --port 18766
"""
import argparse
import hashlib
import json
import logging
import os
import sys
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME") or Path(os.environ.get("LOCALAPPDATA", "")) / "hermes")
os.environ["HERMES_HOME"] = str(HERMES_HOME)
PLUGIN_DIR = Path(os.environ.get("CLAUDE_CLI_DIRECTSDK_DIR") or HERMES_HOME / "plugins" / "claude-subscription-directsdk")
for p in (HERMES_HOME / "hermes-agent", PLUGIN_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import directsdk  # noqa: E402  (flat import, as the plugin's own tests do)

LOG = logging.getLogger("claude-cli-shim")
MODELS = ["claude-fable-5-2", "claude-opus-5-5", "claude-opus-5-5[1m]", "claude-sonnet-5-5", "claude-haiku-5-5"]
EFFORTS = {"minimal": "low", "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"}

client = directsdk.Client(timeout=1800)
_active = 0
_last = time.monotonic()
_state = threading.Lock()


class CarrierCache:
    """Remember DirectSDK's replay carrier for each reply, so the exact native turn (thinking blocks and
    their signatures) is replayed when Pi sends the history back without it. Keyed by tool-call ids, else
    by the reply text. DirectSDK itself checks that the carrier still matches the message before using it."""

    def __init__(self, size=4000):
        self.size, self.items, self.lock = size, OrderedDict(), threading.Lock()

    @staticmethod
    def key(message):
        calls = message.get("tool_calls") or []
        if calls:
            return "tools:" + ",".join(sorted(str(c.get("id")) for c in calls))
        text = (message.get("content") or "").strip()
        return "text:" + hashlib.sha256(text.encode("utf-8")).hexdigest() if text else None

    def put(self, message, carrier):
        k = self.key(message)
        if not k:
            return
        with self.lock:
            self.items[k] = carrier
            self.items.move_to_end(k)
            while len(self.items) > self.size:
                self.items.popitem(last=False)

    def get(self, message):
        k = self.key(message)
        with self.lock:
            return self.items.get(k) if k else None


carriers = CarrierCache()


def _text(content):
    """OpenAI content as a plain string when it is only text parts."""
    if isinstance(content, list) and all(isinstance(p, dict) and p.get("type") == "text" for p in content):
        return "".join(p.get("text", "") for p in content)
    return content


_usage = {"at": 0.0, "data": None}
_usage_lock = threading.Lock()


def _plugin():
    """The plugin package itself (for its usage_windows formatter), loaded once under a private name."""
    mod = sys.modules.get("claude_cli_directsdk_plugin")
    if mod is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location("claude_cli_directsdk_plugin", PLUGIN_DIR / "__init__.py",
                                                      submodule_search_locations=[str(PLUGIN_DIR)])
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
    return mod


def plan_usage(max_age=60):
    """Plan limits from Claude Code's own zero-inference `get_usage` request (the same data as `/usage` in
    Claude Code and Hermes). Cached for max_age seconds, since each fetch spawns a short claude process."""
    with _usage_lock:
        if _usage["data"] is not None and time.monotonic() - _usage["at"] < max_age:
            return _usage["data"]
        import directsdk_setup
        limits, reason = directsdk_setup.fetch_usage()
        data = {"ok": limits is not None, "reason": reason, "windows": [], "details": []}
        if limits is not None:
            windows, details = _plugin().usage_windows(limits)
            data["windows"] = [{"label": w.label, "used_percent": w.used_percent,
                                "resets_at": w.reset_at.isoformat() if w.reset_at else None} for w in windows]
            data["details"] = list(details)
            _usage.update(at=time.monotonic(), data=data)
        return data


def translate(body):
    """Pi's openai-completions payload -> the kwargs DirectSDK's create() accepts."""
    messages = []
    replayed = missed = 0
    for m in body.get("messages") or []:
        m = dict(m)
        role = m.get("role")
        if role == "developer":
            m["role"] = role = "system"
        if role in ("system", "assistant"):
            m["content"] = _text(m.get("content"))
        if role == "assistant":
            m.pop("reasoning_content", None)
            m.pop("reasoning", None)
            if m.get("content") is None:
                m["content"] = ""
            if not m.get("reasoning_details"):
                carrier = carriers.get(m)
                if carrier is not None:
                    m["reasoning_details"] = [carrier]
                    replayed += 1
                else:
                    missed += 1
        messages.append(m)
    if replayed or missed:
        LOG.info("history: %d assistant turns replayed natively, %d rebuilt from text", replayed, missed)
    # System/developer messages must come first; merge any later ones into the first.
    system = [m for m in messages if m.get("role") == "system"]
    rest = [m for m in messages if m.get("role") != "system"]
    if len(system) > 1 or (system and messages[0].get("role") != "system"):
        system = [{"role": "system", "content": "\n\n".join(str(m.get("content") or "") for m in system)}]
    kw = {"model": body["model"], "messages": system + rest, "stream": bool(body.get("stream"))}
    if body.get("tools"):
        kw["tools"] = body["tools"]
    max_tokens = body.get("max_completion_tokens") or body.get("max_tokens")
    if isinstance(max_tokens, int) and max_tokens > 0:
        kw["max_tokens"] = max_tokens
    effort = body.get("reasoning_effort") or (body.get("reasoning") or {}).get("effort")
    if effort in EFFORTS:
        # enabled: True makes DirectSDK ask for display "summarized"; without it newer models return
        # empty (omitted) thinking and Pi shows nothing while Claude thinks.
        kw["extra_body"] = {"reasoning": {"enabled": True, "effort": EFFORTS[effort]}}
    elif effort == "none":
        kw["extra_body"] = {"reasoning": {"enabled": False}}
    if body.get("stream"):
        kw["stream_options"] = {"include_usage": True}
    return kw


def clean(chunk):
    """A DirectSDK chunk as plain OpenAI JSON; remembers the replay carrier of a finished reply."""
    data = chunk.model_dump()
    data.pop("_response", None)
    response = getattr(chunk, "_response", None)
    for choice in data.get("choices") or []:
        delta = choice.get("delta") or {}
        details = delta.pop("reasoning_details", None)
        if response is not None and details:
            message = response.model_dump()["choices"][0]["message"]
            carriers.put(message, details[0])
        choice["delta"] = {k: v for k, v in delta.items() if v is not None}
    usage = data.get("usage")
    if isinstance(usage, dict):
        data["usage"] = {k: usage[k] for k in ("prompt_tokens", "completion_tokens", "total_tokens",
                                               "prompt_tokens_details", "completion_tokens_details") if k in usage}
    return data


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # no request logging (payloads stay private)
        pass

    def _json(self, status, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", "/v1/health"):
            return self._json(200, {"ok": True, "service": "claude-cli-shim"})
        if self.path.rstrip("/") == "/v1/models":
            return self._json(200, {"object": "list", "data": [{"id": m, "object": "model"} for m in MODELS]})
        if self.path.split("?")[0].rstrip("/") == "/usage":
            try:
                return self._json(200, plan_usage(0 if "fresh" in self.path else 60))
            except Exception as exc:  # noqa: BLE001
                LOG.warning("usage fetch failed: %s", str(exc)[:300])
                return self._json(200, {"ok": False, "reason": str(exc), "windows": [], "details": []})
        self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        global _active, _last
        if self.path.rstrip("/") != "/v1/chat/completions":
            return self._json(404, {"error": {"message": "not found"}})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            kw = translate(body)
        except Exception as exc:
            return self._json(400, {"error": {"message": f"bad request: {exc}", "type": "invalid_request_error"}})
        with _state:
            _active += 1
        started = time.monotonic()
        try:
            if not kw["stream"]:
                result = client.chat.completions.create(**kw)
                data = result.model_dump()
                message = data["choices"][0]["message"]
                details = message.pop("reasoning_details", None)
                if details:
                    carriers.put(message, details[0])
                return self._json(200, data)
            self._stream(kw)
        except directsdk.RequestRejected as exc:
            self._json(400, {"error": {"message": str(exc), "type": "invalid_request_error"}})
        except Exception as exc:  # noqa: BLE001 - surfaced to Pi as an API error
            LOG.warning("request failed after %.1fs: %s", time.monotonic() - started, str(exc)[:300])
            try:
                self._json(502, {"error": {"message": str(exc), "type": "api_error"}})
            except OSError:
                pass
        finally:
            with _state:
                _active -= 1
                _last = time.monotonic()

    def _stream(self, kw):
        stream = client.chat.completions.create(**kw)
        headers_sent = False
        try:
            for chunk in stream:
                if not headers_sent:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    headers_sent = True
                self.wfile.write(b"data: " + json.dumps(clean(chunk)).encode("utf-8") + b"\n\n")
                self.wfile.flush()
            if not headers_sent:
                raise RuntimeError("Claude Code returned no response")
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            LOG.info("client disconnected; cancelling the claude process")
        except Exception as exc:
            if not headers_sent:
                raise
            LOG.warning("stream failed: %s", str(exc)[:300])
            try:
                err = {"error": {"message": str(exc), "type": "api_error"}}
                self.wfile.write(b"data: " + json.dumps(err).encode("utf-8") + b"\n\n")
                self.wfile.flush()
            except OSError:
                pass
        finally:
            stream.close()
            self.close_connection = True


def idle_watch(idle_seconds):
    while True:
        time.sleep(30)
        with _state:
            idle = _active == 0 and time.monotonic() - _last > idle_seconds
        if idle:
            LOG.info("idle for %ss, exiting", idle_seconds)
            os._exit(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18766)
    ap.add_argument("--idle", type=int, default=7200, help="exit after this many idle seconds (0 = never)")
    ap.add_argument("--log", default=str(Path(__file__).with_name("shim.log")))
    args = ap.parse_args()
    logging.basicConfig(filename=args.log, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # Requests must reach Anthropic through the CLI's own login, never an inherited endpoint override.
    for name in ("ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        os.environ.pop(name, None)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    if args.idle > 0:
        threading.Thread(target=idle_watch, args=(args.idle,), daemon=True).start()
    LOG.info("listening on 127.0.0.1:%s (directsdk from %s)", args.port, PLUGIN_DIR)
    server.serve_forever()


if __name__ == "__main__":
    main()
