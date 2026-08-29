#!/usr/bin/env python3
# ============================================================================
# harvest_lrmds.py — LRMDS (lrmds.deped.gov.ph) harvest, local run. 2026-08-22.
#
# Flow (validated live): login via kamai headless browser (account needed —
# Download is 403 anonymous), read the JS-visible PHPSESSID from the kamai
# session, then bulk curl-style downloads of /download/<id> with that cookie.
# Enumerates detail IDs from the public search endpoint (no auth needed).
#
# Scope: language-relevant learner resources (Bisaya/Cebuano = the prize;
# Filipino/Tagalog = pedagogical-register bonus). English-medium resources get
# dropped later by the LID gate at pool-prep time.
#
# Output: /tmp/lrmds-harvest/docs.jsonl {"text","lrmds_id","queries"} (+ pdfs/)
# ============================================================================
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

OUT = Path(os.environ.get("LRMDS_OUT", "/tmp/lrmds-harvest"))
PDF_DIR = OUT / "pdfs"
STATE = OUT / "state.json"
QUERIES = os.environ.get("LRMDS_QUERIES", "").split() or [
    "binisaya", "cebuano", "sinugbuanong", "mother tongue", "mtb-mle",
    "basa pilipinas", "filipino", "tagalog"]
MIN_CHARS = 200
WORKERS = 2          # gov.ph WAF 403s under concurrency — 6 workers failed ~40%
DL_DELAY = 0.5
ILLEGAL = re.compile(r"[\000-\010\013-\014\016-\037]")  # openpyxl lesson (v3 crash)
UA = {"User-Agent": "Mozilla/5.0 (corpus research; hiraia project)"}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

class LocalSession:
    """Direct LRMDS session (no kamai): Symfony form login, local cookie jar.
    The kamai-cookie approach failed live — PHPSESSID is pinned to kamai's
    browser context (every download 403'd). Direct curl login works."""
    def __init__(self):
        import http.cookiejar, threading
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))
        self.lock = threading.Lock()
        self.login()

    def login(self):
        self.opener.open(urllib.request.Request(
            "https://lrmds.deped.gov.ph/login", headers=UA), timeout=60).read()
        data = urllib.parse.urlencode({
            "_username": "cryptoday", "_password": "qwerty1234",
            "_remember_me": "on", "_submit": ""}).encode()
        # login_check 302s to http://.../dashboard (port 80 hangs) — we only need
        # the Set-Cookie, so use a no-redirect opener sharing the same cookie jar
        nr = urllib.request.build_opener(NoRedirect(),
                                         urllib.request.HTTPCookieProcessor(self.jar))
        try:
            nr.open(urllib.request.Request(
                "https://lrmds.deped.gov.ph/login_check", data=data, headers=UA), timeout=60)
        except urllib.error.HTTPError as e:
            if e.code not in (301, 302, 303):
                raise
        print("[auth] local LRMDS session established", flush=True)

    def refresh(self):
        with self.lock:
            self.login()

def fetch(url, binary=False, session=None, retries=3):
    for i in range(retries):
        try:
            if session is not None:
                r = session.opener.open(urllib.request.Request(url, headers=UA), timeout=90)
            else:
                r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90)
            return r.read() if binary else r.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            if e.code == 403:
                return "403"
            if i == retries - 1:
                return None
            time.sleep(2 * (i + 1))
        except Exception:
            if i == retries - 1:
                return None
            time.sleep(2 * (i + 1))

def enumerate_ids():
    """Paginate the public search for each query; return {id: [queries]}."""
    id2q = {}
    for q in QUERIES:
        page = 0
        while True:
            page += 1
            url = ("https://lrmds.deped.gov.ph/search?query=" + urllib.parse.quote(q)
                   + f"&education_use_type_id=8&page={page}")
            html = fetch(url)
            if not html:
                break
            ids = re.findall(r'/detail/(?:\d+/)?(\d+)', html)
            if not ids:
                break
            new = 0
            for i in ids:
                if i not in id2q:
                    new += 1
                id2q.setdefault(i, [])
                if q not in id2q[i]:
                    id2q[i].append(q)
            if not new or page > 60:
                break
            time.sleep(0.3)
        print(f"[enum] {q}: cumulative {len(id2q)} ids", flush=True)
    return id2q

def sniff_ext(data):
    if data[:5] == b"%PDF-":
        return ".pdf"
    if data[:4] == b"\xd0\xcf\x11\xe0":
        return ".doc"    # OLE2 (legacy Word) — LRMDS has many; found 2026-08-22
    if data[:2] == b"PK":
        return ".docx"
    return None

def extract_text(dest):
    try:
        if dest.suffix == ".pdf":
            r = subprocess.run(["pdftotext", "-enc", "UTF-8", str(dest), "-"],
                               capture_output=True, timeout=120)
        else:  # .doc/.docx via macOS textutil
            r = subprocess.run(["textutil", "-convert", "txt", "-stdout", str(dest)],
                               capture_output=True, timeout=120)
        return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else None
    except Exception:
        return None

def process_one(args):
    rid, session = args
    existing = [p for p in PDF_DIR.glob(f"{rid}.*") if p.suffix in (".pdf", ".doc", ".docx")]
    if existing:
        dest = existing[0]
    else:
        url = f"https://lrmds.deped.gov.ph/download/{rid}"
        data = fetch(url, binary=True, session=session)
        for attempt in range(3):
            if data != "403":
                break
            session.refresh()
            time.sleep(1 + attempt)
            data = fetch(url, binary=True, session=session)
        ext = sniff_ext(data) if data and data != "403" else None
        if not ext:
            return (rid, None, "failed")
        dest = PDF_DIR / f"{rid}{ext}"
        dest.write_bytes(data)
        time.sleep(DL_DELAY)
    text = extract_text(dest)
    if not text:
        return (rid, None, "no_text")
    text = ILLEGAL.sub(" ", text).strip()
    if len(text) < MIN_CHARS:
        return (rid, None, "short")
    return (rid, text, "kept")

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PDF_DIR.mkdir(exist_ok=True)
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    if "id2q" not in state:
        id2q = enumerate_ids()
        state["id2q"] = id2q
        STATE.write_text(json.dumps(state))
    id2q = state["id2q"]
    done = set(state.get("done", []))
    todo = [r for r in sorted(id2q, key=int) if r not in done]
    print(f"[harvest] {len(id2q)} unique resources, {len(todo)} to fetch", flush=True)

    jar = LocalSession()
    out_path = OUT / "docs.jsonl"
    kept = failed = no_text = short = 0
    with open(out_path, "a", encoding="utf-8") as out:
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for n, (rid, text, status) in enumerate(
                    ex.map(process_one, [(r, jar) for r in todo])):
                if status == "kept":
                    out.write(json.dumps({"text": text, "lrmds_id": rid,
                                          "queries": id2q[rid]}, ensure_ascii=False) + "\n")
                    kept += 1
                elif status == "failed":
                    failed += 1
                elif status == "no_text":
                    no_text += 1
                else:
                    short += 1
                done.add(rid)
                if (n + 1) % 100 == 0:
                    out.flush()
                    state["done"] = sorted(done, key=int)
                    STATE.write_text(json.dumps(state))
                    print(f"[lrmds] {n+1}/{len(todo)} kept={kept} failed={failed} "
                          f"no_text={no_text} short={short}", flush=True)
    state["done"] = sorted(done, key=int)
    STATE.write_text(json.dumps(state))
    stats = {"resources": len(id2q), "kept": kept, "failed": failed,
             "no_text": no_text, "short": short}
    (OUT / "HARVEST-STATS.json").write_text(json.dumps(stats, indent=2))
    print(f"[LRMDS DONE] {stats}", flush=True)

if __name__ == "__main__":
    main()
