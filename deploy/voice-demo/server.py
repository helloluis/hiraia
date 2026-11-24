#!/usr/bin/env python3
"""Hiraia voice demo: public text-to-speech for the hiraia.org "Hiraia Voices" section.

Serves the frozen Expanded Mini 1.0.0-preview.1 voices (the same bundle the site's samples
were rendered with) on loopback; nginx exposes it as POST /api/voice/synthesize.

  POST /api/voice/synthesize  {"text": "...", "voice": "fil" | "en"}  -> audio/mpeg
  GET  /api/voice/health                                             -> JSON status

Synthesis is the bundle's reference path (PhonemeFrontend.prepare, label_mode "target",
default scales 0.667/1.0/0.8), run per sentence chunk so memory and per-chunk latency stay
bounded. Mixed Tagalog-English text goes through whichever voice was chosen; there is no
language guessing.

Brand names (Hiraia, QVAC, Tala, ...) are spoken from the shared speech-only lexicon
pronunciation/brand-lexicon.json, layered over the frozen bundle's dictionary after the bundle
itself is verified. The lexicon is pinned by BRAND_LEXICON_SHA256; its URL rewrites change
only what is spoken, never the visitor's text, and run after the length cap.

Protection: hard 500-character cap (after normalisation, counted in code points), 4 KB body
cap, per-client sliding-window limits, one synthesis at a time with a short bounded queue, a
per-request deadline, and log lines that carry no text and no raw address (a keyed hash that
rotates daily, so repeat abuse is visible within a day and unlinkable after it).
"""
from __future__ import annotations

import collections
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import unicodedata
import wave
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_CHARS = 500
MAX_BODY = 4096
CHUNK_CHARS = 220
SAMPLE_RATE = 22050
SENTENCE_PAUSE_S = 0.18
DEADLINE_S = float(os.environ.get("VOICE_DEMO_DEADLINE_S", "25"))
QUEUE_WAIT_S = float(os.environ.get("VOICE_DEMO_QUEUE_WAIT_S", "12"))
MAX_WAITING = int(os.environ.get("VOICE_DEMO_MAX_WAITING", "4"))
THREADS = int(os.environ.get("VOICE_DEMO_THREADS", "2"))
# (window seconds, max requests) per client; all windows must pass.
LIMITS = ((60, 6), (3600, 40))
GLOBAL_LIMIT = (60, 60)
VOICES = {"fil": "tagalog", "en": "english"}
VOICE_IDS = {"fil": "hiraia-tl-expanded-mini@1.0.0-preview.1", "en": "hiraia-en-expanded-mini@1.0.0-preview.1"}
ALLOWED_ORIGINS = {o.strip() for o in os.environ.get(
    "VOICE_DEMO_ORIGINS", "https://hiraia.org,https://www.hiraia.org").split(",") if o.strip()}
SCALES = (0.667, 1.0, 0.8)
FFMPEG = os.environ.get("VOICE_DEMO_FFMPEG", "/usr/bin/ffmpeg")
# Shared speech-only lexicon (pronunciation/brand-lexicon.json). Pinned: a lexicon change must
# update this hash in the same commit, so a deployed server never runs an unreviewed pairing.
BRAND_LEXICON_SHA256 = "111c93a5c0e2269cee74a97110275a9e37046ac1da54c5348361dd81e35a57dd"

log = logging.getLogger("voice-demo")


class UserError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ---------------------------------------------------------------- text normalisation
_DASHES = re.compile(r"\s*[‒–—―−]+\s*|\s+-+\s+|(?<=\s)-+|-+(?=\s|$)")
_DROP = re.compile(r"[\"“”„«»()\[\]{}<>#@*_~^|\\/`=+¿¡]")
_KEEP_PUNCT = frozenset(".,!?;:'’-")
_SPACES = re.compile(r"\s+")
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)
_DIGIT = re.compile(r"\d")


def _brand_lexicon_path() -> Path:
    configured = os.environ.get("VOICE_DEMO_BRAND_LEXICON")
    if configured:
        return Path(configured)
    here = Path(__file__).resolve().parent
    deployed = here / "brand-lexicon.json"            # /opt/hiraia-voice-demo/brand-lexicon.json
    return deployed if deployed.exists() else here.parents[1] / "pronunciation" / "brand-lexicon.json"


def load_brand_lexicon(path: Path | None = None) -> dict:
    """Read and pin-check the shared lexicon; fail closed on any mismatch."""
    path = path or _brand_lexicon_path()
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != BRAND_LEXICON_SHA256:
        raise SystemExit(f"Brand lexicon {path} is {digest}, expected pinned {BRAND_LEXICON_SHA256}")
    lexicon = json.loads(raw)
    if lexicon.get("schema") != "hiraia-brand-lexicon/1":
        raise SystemExit("Unsupported brand lexicon schema")
    lexicon["sha256"] = digest
    lexicon["rewrites"] = [(re.compile(r["pattern"], re.IGNORECASE), r["replacement"])
                           for r in lexicon["speech_text_rewrites"]]
    return lexicon


BRAND = load_brand_lexicon()


def speech_rewrites(text: str) -> str:
    """Spoken forms for hiraia.org URLs (speech only; the visitor's text box is untouched)."""
    for pattern, replacement in BRAND["rewrites"]:
        text = pattern.sub(replacement, text)
    return text


def normalise(text: str, voice: str) -> str:
    """Map visitor text onto what the frozen frontend accepts, without changing words."""
    text = unicodedata.normalize("NFC", text)
    if len(text) > MAX_CHARS:
        raise UserError(413, "too_long", f"Please keep it to {MAX_CHARS} characters.")
    text = speech_rewrites(text)
    if _DIGIT.search(text):
        raise UserError(422, "digits", "Please spell out numbers in words (for example “tatlo” or “three”).")
    # Line breaks end a sentence; tabs are spaces.
    text = re.sub(r"([^.!?,;:\s])[ \t]*(\r\n|\r|\n)+", r"\1. ", text)
    text = re.sub(r"[\r\n]+", " ", text)
    text = text.replace("&", " and " if voice == "en" else " at ")
    text = text.replace("…", "...")
    text = _DASHES.sub(", ", text)
    text = _DROP.sub(" ", text)
    # Keep letters, marks, spaces and the punctuation the frontend reads; everything else
    # (emoji, symbols, other punctuation, control characters) is not spoken.
    text = "".join(ch if unicodedata.category(ch)[0] in "LMZ" or ch in _KEEP_PUNCT else " " for ch in text)
    text = _SPACES.sub(" ", text)
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"([,;:])(?:\s*[,;:])+", r"\1", text)
    text = re.sub(r"^[\s,.;:!?]+", "", text).strip()
    if not _LETTER.search(text):
        raise UserError(422, "empty", "Type a sentence with some words in it.")
    return text


def chunks(text: str) -> list[str]:
    """Sentence chunks of at most CHUNK_CHARS, splitting long ones at commas, then spaces."""
    out: list[str] = []
    for sentence in re.findall(r"[^.!?]+(?:[.!?]+|$)", text):
        sentence = sentence.strip()
        if not sentence or not _LETTER.search(sentence):
            continue
        while len(sentence) > CHUNK_CHARS:
            cut = max(sentence.rfind(m, 0, CHUNK_CHARS) for m in (", ", "; ", ": "))
            if cut < CHUNK_CHARS // 3:
                cut = sentence.rfind(" ", 0, CHUNK_CHARS)
            cut = cut + 1 if cut > 0 else CHUNK_CHARS  # keep the separator; hard cut if none
            head, sentence = sentence[:cut].strip(), sentence[cut:].strip()
            if _LETTER.search(head):
                out.append(head)
        if sentence and _LETTER.search(sentence):
            out.append(sentence)
    return out


# ---------------------------------------------------------------- rate limiting
class RateLimiter:
    def __init__(self):
        self._hits: dict[str, collections.deque] = {}
        self._global: collections.deque = collections.deque()
        self._lock = threading.Lock()

    def check(self, key: str, now: float | None = None) -> int:
        """Return 0 if allowed (and record it), else the seconds to wait."""
        now = time.monotonic() if now is None else now
        longest = max(w for w, _ in LIMITS)
        with self._lock:
            hits = self._hits.setdefault(key, collections.deque())
            while hits and now - hits[0] > longest:
                hits.popleft()
            for window, limit in LIMITS:
                recent = [t for t in hits if now - t <= window]
                if len(recent) >= limit:
                    return max(1, int(window - (now - recent[0])) + 1)
            gw, gl = GLOBAL_LIMIT
            while self._global and now - self._global[0] > gw:
                self._global.popleft()
            if len(self._global) >= gl:
                return max(1, int(gw - (now - self._global[0])) + 1)
            hits.append(now)
            self._global.append(now)
            if len(self._hits) > 50000:  # bound memory under address churn
                for k in [k for k, d in self._hits.items() if not d or now - d[-1] > longest]:
                    del self._hits[k]
            return 0


class DailyHasher:
    """Keyed address hash with a random key that is replaced every UTC day (never stored)."""

    def __init__(self):
        self._day, self._key = None, b""

    def __call__(self, address: str) -> str:
        day = time.strftime("%Y%m%d", time.gmtime())
        if day != self._day:
            self._day, self._key = day, secrets.token_bytes(32)
        return hmac.new(self._key, address.encode(), hashlib.sha256).hexdigest()[:12]


# ---------------------------------------------------------------- synthesis
class Engine:
    def __init__(self, bundle: Path):
        sys.path.insert(0, str(bundle))
        sys.path.insert(0, str(bundle / "src"))
        import numpy as np
        import onnxruntime as ort
        import synthesize  # the bundle's reference CLI: integrity check
        from hiraia_voice.phoneme_frontend import DATA, PhonemeFrontend

        self.np = np
        self.manifest = synthesize.verify_bundle(bundle)
        frozen = PhonemeFrontend()
        if frozen.provenance != self.manifest["frontend"]:
            raise SystemExit("Frontend dependencies/data differ from the frozen bundle")
        self.frontend = self._with_brand_lexicon(PhonemeFrontend, DATA / "overrides.json",
                                                 bundle / "data" / "pronunciation" / "lexicon.json")
        layered = dict(self.frontend.provenance)
        for key in ("overrides_sha256", "dictionary_sha256"):
            layered[key] = self.manifest["frontend"][key]
        if layered != self.manifest["frontend"] or self.frontend.id_map != frozen.id_map:
            raise SystemExit("Brand lexicon layer changed more than the overrides and dictionary")
        del frozen
        self.sessions = {}
        for language in VOICES.values():
            directory = bundle / "models" / language
            config = json.loads((directory / "model.onnx.json").read_text())
            if config["phoneme_id_map"] != self.frontend.id_map or config["audio"]["sample_rate"] != SAMPLE_RATE:
                raise SystemExit("Model and frontend inventories differ")
            options = ort.SessionOptions()
            options.intra_op_num_threads = THREADS
            options.inter_op_num_threads = 1
            options.enable_cpu_mem_arena = False  # return activation memory between requests
            self.sessions[language] = ort.InferenceSession(str(directory / "model.onnx"), sess_options=options,
                                                           providers=["CPUExecutionProvider"])
        self.scales = np.asarray(SCALES, dtype=np.float32)
        self.models = {v: self.manifest["models"][language] for v, language in VOICES.items()}

    @staticmethod
    def _with_brand_lexicon(frontend_class, overrides_path: Path, dictionary_path: Path):
        """Frozen overrides/dictionary plus the brand entries, written to a private temp dir."""
        import tempfile
        overrides = json.loads(overrides_path.read_text())
        overrides["entries"] = overrides["entries"] + BRAND["tagalog_overrides"]
        dictionary = json.loads(dictionary_path.read_text())
        dictionary["entries"] = dictionary["entries"] + BRAND["dictionary_entries"]
        work = Path(tempfile.mkdtemp(prefix="hiraia-voice-brand-"))
        (work / "overrides.json").write_text(json.dumps(overrides, ensure_ascii=False))
        (work / "lexicon.json").write_text(json.dumps(dictionary, ensure_ascii=False))
        return frontend_class(overrides_path=work / "overrides.json", dictionary_path=work / "lexicon.json")

    def synthesize(self, text: str, voice: str, deadline: float):
        np = self.np
        language = VOICES[voice]
        prepared = []
        for part in chunks(text):
            try:
                prepared.append(self.frontend.prepare(part, language, label_mode="target", allow_provisional=True))
            except Exception as error:  # frontend rejections are about the visitor's text
                word = re.search(r"'([^']{1,40})'", str(error))
                hint = f" “{word.group(1)}”" if word else " a word"
                other = "English" if voice == "fil" else "Filipino"
                raise UserError(422, "unreadable",
                                f"The {'Filipino' if voice == 'fil' else 'English'} voice couldn't read{hint}. "
                                f"Try spelling it differently, or switch to the {other} voice.") from None
        if not prepared:
            raise UserError(422, "empty", "Type a sentence with some words in it.")
        pieces, pause = [], np.zeros(int(SAMPLE_RATE * SENTENCE_PAUSE_S), dtype=np.float32)
        for index, item in enumerate(prepared):
            if time.monotonic() > deadline:
                raise UserError(503, "timeout", "That took too long. Please try a shorter sentence.")
            ids = np.asarray([item.phoneme_ids], dtype=np.int64)
            samples = self.sessions[language].run(None, {
                "input": ids, "input_lengths": np.asarray([ids.shape[1]], dtype=np.int64),
                "scales": self.scales})[0].reshape(-1)
            if not samples.size or not np.isfinite(samples).all():
                raise RuntimeError("invalid waveform")
            if index:
                pieces.append(pause)
            pieces.append(samples.astype(np.float32))
        audio = np.concatenate(pieces)
        if audio.size > 90 * SAMPLE_RATE:
            raise RuntimeError("waveform too long")
        pcm = np.clip(np.rint(audio * 32768), -32768, 32767).astype("<i2")
        return pcm, len(prepared)


def encode_mp3(pcm, timeout: float) -> bytes:
    raw = io.BytesIO()
    with wave.open(raw, "wb") as writer:
        writer.setparams((1, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
        writer.writeframes(pcm.tobytes())
    result = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0",
                             "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1"],
                            input=raw.getvalue(), capture_output=True, timeout=max(1.0, timeout), check=True)
    return result.stdout


# ---------------------------------------------------------------- HTTP
class App:
    def __init__(self, engine: Engine | None):
        self.engine = engine
        self.limiter = RateLimiter()
        self.hasher = DailyHasher()
        self.slot = threading.Semaphore(1)
        self.waiting = 0
        self.waiting_lock = threading.Lock()
        self.started = time.time()
        self.served = 0


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "hiraia-voice-demo"
        sys_version = ""
        protocol_version = "HTTP/1.1"
        timeout = 15

        def log_message(self, *args):  # default access log would include paths/addresses
            pass

        def _client(self) -> str:
            # nginx sets X-Real-IP from the migration-aware client address; loopback only.
            return (self.headers.get("X-Real-IP") or self.client_address[0]).strip()[:64]

        def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict, extra: dict | None = None):
            self._send(status, json.dumps(payload).encode(), "application/json", extra)

        def do_GET(self):
            if self.path.split("?")[0] != "/api/voice/health":
                return self._json(404, {"error": "not_found"})
            ok = app.engine is not None
            self._json(200 if ok else 503, {
                "ok": ok, "voices": {v: {"id": VOICE_IDS[v], "model_sha256": m["model_sha256"],
                                         "model_bytes": m["model_bytes"]} for v, m in app.engine.models.items()} if ok else {},
                "pronunciation": {"brand_lexicon": BRAND["version"], "sha256": BRAND["sha256"],
                                  "entries": len(BRAND["dictionary_entries"]) + len(BRAND["tagalog_overrides"]),
                                  "rewrites": len(BRAND["rewrites"])},
                "max_chars": MAX_CHARS, "uptime_s": int(time.time() - app.started), "served": app.served})

        def do_POST(self):
            began = time.monotonic()
            status, code, voice, chars, seconds, parts = 500, "error", "-", 0, 0.0, 0
            client = self._client()
            try:
                if self.path.split("?")[0] != "/api/voice/synthesize":
                    raise UserError(404, "not_found", "Not found.")
                origin = self.headers.get("Origin")
                if origin and origin not in ALLOWED_ORIGINS:
                    raise UserError(403, "origin", "This demo only runs on hiraia.org.")
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_BODY:
                    raise UserError(413, "too_long", f"Please keep it to {MAX_CHARS} characters.")
                if "application/json" not in (self.headers.get("Content-Type") or ""):
                    raise UserError(415, "content_type", "Send JSON.")
                try:
                    body = json.loads(self.rfile.read(length))
                except (ValueError, UnicodeDecodeError):
                    raise UserError(400, "bad_json", "That request couldn't be read.") from None
                if not isinstance(body, dict) or not isinstance(body.get("text"), str):
                    raise UserError(400, "bad_request", "Type a sentence to hear it.")
                voice = body.get("voice", "fil")
                if voice not in VOICES:
                    raise UserError(400, "bad_voice", "Choose the Filipino or English voice.")
                chars = len(body["text"])
                if chars > MAX_CHARS:
                    raise UserError(413, "too_long", f"Please keep it to {MAX_CHARS} characters.")
                text = normalise(body["text"], voice)
                wait = app.limiter.check(client)
                if wait:
                    raise UserError(429, "rate_limited", "You've tried a lot of sentences! Please wait a moment and try again.")
                if app.engine is None:
                    raise UserError(503, "unavailable", "The voice demo is starting up. Please try again shortly.")
                with app.waiting_lock:
                    if app.waiting >= MAX_WAITING:
                        raise UserError(503, "busy", "The voices are busy right now. Please try again in a few seconds.")
                    app.waiting += 1
                try:
                    if not app.slot.acquire(timeout=QUEUE_WAIT_S):
                        raise UserError(503, "busy", "The voices are busy right now. Please try again in a few seconds.")
                finally:
                    with app.waiting_lock:
                        app.waiting -= 1
                try:
                    deadline = began + DEADLINE_S
                    pcm, parts = app.engine.synthesize(text, voice, deadline)
                    seconds = len(pcm) / SAMPLE_RATE
                    audio = encode_mp3(pcm, deadline - time.monotonic() + 5)
                finally:
                    app.slot.release()
                status, code = 200, "ok"
                app.served += 1
                self._send(200, audio, "audio/mpeg", {"X-Audio-Seconds": f"{seconds:.2f}"})
            except UserError as error:
                status, code = error.status, error.code
                extra = {"Retry-After": "60"} if status in (429, 503) else None
                self._json(status, {"error": code, "message": error.message}, extra)
            except Exception as error:  # noqa: BLE001
                status, code = 500, type(error).__name__
                log.exception("synthesis failed")
                self._json(500, {"error": "error", "message": "Something went wrong. Please try again."})
            finally:
                # Minimal abuse-prevention metadata only: no text, no raw address.
                log.info("status=%s code=%s voice=%s chars=%d parts=%d audio_s=%.2f ms=%d client=%s",
                         status, code, voice, chars, parts, seconds,
                         int((time.monotonic() - began) * 1000), app.hasher(client))

    return Handler


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout)
    bundle = Path(os.environ.get("VOICE_DEMO_BUNDLE", Path(__file__).resolve().parent / "bundle")).resolve()
    host = os.environ.get("VOICE_DEMO_HOST", "127.0.0.1")
    port = int(os.environ.get("VOICE_DEMO_PORT", "8139"))
    start = time.monotonic()
    engine = Engine(bundle)
    # Warm both voices so the first visitor does not pay the first-run allocation cost.
    for voice in VOICES:
        engine.synthesize("Kumusta.", voice, time.monotonic() + 60)
    log.info("ready in %.1fs bundle=%s threads=%d", time.monotonic() - start, bundle.name, THREADS)
    server = ThreadingHTTPServer((host, port), make_handler(App(engine)))
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
