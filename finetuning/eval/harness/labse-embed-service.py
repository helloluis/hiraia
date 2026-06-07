#!/usr/bin/env python3
"""Faithful LaBSE query-embedding service for the chat driver — transformers
raw-CLS, the EXACT method rag/scripts/build-vectors.py used for the corpus blob
and the verified device-equivalent (parity 0.99999 vs QVAC's @qvac/embed-llamacpp
GGUF). We embed QUERIES the same way so the driver's hybrid retrieval lives in the
identical vector space as the phone — not the ~0.99 approximation `llama-server
--pooling cls` gives.

OpenAI-ish: POST /v1/embeddings {"input": "<text>"} -> {"data":[{"embedding":[...]}]}
(raw CLS, NOT normalized — the driver L2-normalizes, matching device embdNormalize:2).
GET /health -> 200.

  finetuning/.convert-venv/bin/python finetuning/eval/harness/labse-embed-service.py [PORT]
"""
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch
from transformers import AutoTokenizer, AutoModel

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
DEV = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"loading sentence-transformers/LaBSE on {DEV} ...", flush=True)
TOK = AutoTokenizer.from_pretrained("sentence-transformers/LaBSE")
MODEL = AutoModel.from_pretrained("sentence-transformers/LaBSE").to(DEV).eval()

def embed(text: str):
    enc = TOK([text], return_tensors="pt", padding=True, truncation=True, max_length=192).to(DEV)
    with torch.no_grad():
        cls = MODEL(**enc).last_hidden_state[:, 0]  # raw CLS, no dense head (== corpus + device)
    return cls[0].cpu().tolist()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        if self.path != "/v1/embeddings":
            self.send_response(404); self.end_headers(); return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        text = body.get("input", "")
        if isinstance(text, list): text = text[0] if text else ""
        out = json.dumps({"data": [{"embedding": embed(text)}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

print(f">> LaBSE embed service ready on :{PORT} (transformers raw-CLS = device-equivalent)", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
