#!/usr/bin/env python3
# ============================================================================
# harvest_bloom.py — BloomLibrary tl+ceb harvest (runs ON the pod; stdlib only).
# Method: memory bloomlibrary-cebuano-access — Parse API for book metadata,
# public S3 bucket BloomLibraryBooks for the book HTML (<baseUrl><Title>.htm,
# verified 2026-08-22: S3 ListBucket on the objectId prefix shows the layout;
# the bloomdigital/index.htm path from the older probe 404s on current books).
#
# Per book: fetch the .htm, extract ONLY the target-language text (Bloom books
# are multilingual; text lives in lang-tagged divs), keep CC/public-domain
# licenses (brief: "CC-licensed"). One doc per book.
#
# Output: /workspace/corpus/raw/bloomlibrary-{tl,ceb}/books.jsonl
#   {"text": ..., "bloom_id": ..., "title": ..., "license": ...}
# ============================================================================
import json, re, sys, time, urllib.parse, urllib.request
from html.parser import HTMLParser
from pathlib import Path

RAW = Path("/workspace/corpus/raw")
PARSE = "https://bloom-parse-server-production.azurewebsites.net/parse"
APPID = "R6qNTeumQXjJCMutAJYAwPtip1qBulkFyLefkCE5"
HDR = {"X-Parse-Application-Id": APPID}
UA = {"User-Agent": "Mozilla/5.0 (corpus harvest; contact: hiraia project)"}
MIN_CHARS = 50  # matches prep_pools pre-trim

# Parse `language` class objectIds, resolved 2026-08-22 via
# classes/language?where={"isoCode": ...}. ceb has 5 community entries; tl has
# Filipino(fil) + Tagalog(tl). ("hJWYirJcAD" is a mislabeled 'English' entry — skipped.)
LANGS = {
    "tl":  {"pointers": ["i6YEieQEDU", "0aVxdYFJrp"], "html_langs": {"tl", "fil", "tgl"}},
    "ceb": {"pointers": ["G9t7cRlOBo", "MoInyfAWMt", "p2kdtdxDrQ", "VzntXqtRsJ", "cSTKqEoCFX"],
            "html_langs": {"ceb"}},
}

def license_ok(lic: str) -> bool:
    lic = (lic or "").lower()
    return lic.startswith("cc") or lic in {"public-domain", "pdm", "publicdomain"}

def get_json(url, retries=3):
    for i in range(retries):
        try:
            return json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers=HDR), timeout=60).read().decode())
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))

def fetch(url, retries=2):
    for i in range(retries):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=60).read().decode("utf-8", "ignore")
        except Exception:
            if i == retries - 1:
                return None
            time.sleep(2 * (i + 1))

class LangTextExtractor(HTMLParser):
    """Collect character data only while inside an element whose lang matches."""
    def __init__(self, wanted):
        super().__init__(convert_charrefs=True)
        self.wanted = wanted
        self.stack = []        # (tag, lang_or_None)
        self.cur_lang = None   # innermost lang on the stack
        self.saw_any_lang = False
        self.skip_depth = 0    # inside script/style
        self.chunks = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style"):
            self.skip_depth += 1
        lang = a.get("lang") or a.get("xml:lang")
        if lang:
            lang = lang.lower().split("-")[0]
            self.saw_any_lang = True
        self.stack.append(lang)
        if lang:
            self.cur_lang = lang
        elif tag == "html":
            self.cur_lang = lang  # reset at root if html carries lang
        if tag in ("div", "p", "br"):
            self.chunks.append("\n")

    def handle_startendtag(self, tag, attrs):
        if tag == "br":
            self.chunks.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip_depth:
            self.skip_depth -= 1
        if self.stack:
            popped = self.stack.pop()
            if popped:
                # recompute innermost lang
                self.cur_lang = next((l for l in reversed(self.stack) if l), None)
        if tag in ("div", "p"):
            self.chunks.append("\n")

    def handle_data(self, data):
        if self.skip_depth:
            return
        if self.cur_lang in self.wanted and data.strip():
            self.chunks.append(data)

def extract_text(html: str, wanted):
    p = LangTextExtractor(wanted)
    p.feed(html)
    if p.saw_any_lang:
        text = "".join(p.chunks)
    else:
        # no lang markup at all: take the whole page (LID gate downstream decides)
        text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S)
        text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()

def htm_url(book):
    base = (book.get("baseUrl") or "").strip()
    if not base:
        return None
    # baseUrl ends with an ENCODED slash ("%2f") on current records — strip either
    # form before joining, or S3 sees a double-slash key and 404s (hit 2026-08-22).
    b = base[:-3] if base.lower().endswith("%2f") else base.rstrip("/")
    # the .htm filename equals the last (folder) segment of baseUrl, URL-decoded
    folder = urllib.parse.unquote(b.rsplit("/", 1)[-1].replace("+", " "))
    return b + "/" + urllib.parse.quote(folder) + ".htm"

def htm_url_via_listing(book):
    """Fallback: list the bucket prefix and pick the newest-looking .htm key.
    Old books are keyed by <uploader-email>/<bookInstanceId>/<title>/ (decode the
    baseUrl path), new ones by <objectId>/ — handle both."""
    prefix = None
    m = re.match(r"https://s3\.amazonaws\.com/BloomLibraryBooks/(.+)$", book.get("baseUrl") or "")
    if m:
        prefix = urllib.parse.unquote(m.group(1)).replace("+", " ")
    if not prefix:
        prefix = book["objectId"] + "/"
    url = ("https://s3.amazonaws.com/BloomLibraryBooks?list-type=2&prefix="
           + urllib.parse.quote(prefix) + "&max-keys=1000")
    body = fetch(url)
    if not body:
        return None
    keys = re.findall(r"<Key>([^<]+)</Key>", body)
    htms = [k for k in keys if k.lower().endswith(".htm")]
    if not htms:
        return None
    key = sorted(htms)[-1]  # upload-timestamp segment sorts newest-last
    return "https://s3.amazonaws.com/BloomLibraryBooks/" + urllib.parse.quote(key)

def harvest(lang):
    cfg = LANGS[lang]
    ptrs = [{"__type": "Pointer", "className": "language", "objectId": p} for p in cfg["pointers"]]
    where = json.dumps({"langPointers": {"$in": ptrs}, "inCirculation": True})
    books, skip = [], 0
    while True:
        q = {"where": where, "limit": "1000", "skip": str(skip),
             "keys": "title,baseUrl,license,pageCount"}
        page = get_json(f"{PARSE}/classes/books?{urllib.parse.urlencode(q)}").get("results", [])
        books.extend(page)
        if len(page) < 1000:
            break
        skip += 1000
    # dedupe by objectId (a book tagged both fil+tl shows up once already via $in,
    # but keep this for safety)
    seen, uniq = set(), []
    for b in books:
        if b["objectId"] not in seen:
            seen.add(b["objectId"])
            uniq.append(b)
    print(f"[bloom-{lang}] {len(uniq)} unique books in circulation", flush=True)

    out_dir = RAW / f"bloomlibrary-{lang}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "books.jsonl"
    kept = skipped_lic = skipped_fetch = skipped_short = 0
    bytes_out = 0
    with open(out_path, "w", encoding="utf-8") as out:
        for i, b in enumerate(uniq):
            if not license_ok(b.get("license")):
                skipped_lic += 1
                continue
            url = htm_url(b)
            html = fetch(url) if url else None
            if html is None:
                alt = htm_url_via_listing(b)
                html = fetch(alt) if alt else None
            if html is None:
                skipped_fetch += 1
                continue
            text = extract_text(html, cfg["html_langs"])
            if len(text) < MIN_CHARS:
                skipped_short += 1
                continue
            line = json.dumps({"text": text, "bloom_id": b["objectId"],
                               "title": b.get("title", ""), "license": b.get("license", "")},
                              ensure_ascii=False) + "\n"
            out.write(line)
            kept += 1
            bytes_out += len(line.encode("utf-8"))
            if (i + 1) % 100 == 0:
                print(f"[bloom-{lang}] {i+1}/{len(uniq)} kept={kept}", flush=True)
            time.sleep(0.05)  # be polite to S3
    stats = {"books_seen": len(uniq), "kept": kept, "skipped_license": skipped_lic,
             "skipped_fetch": skipped_fetch, "skipped_short": skipped_short, "bytes": bytes_out}
    (out_dir / "HARVEST-STATS.json").write_text(json.dumps(stats, indent=2))
    print(f"[bloom-{lang} DONE] {stats}", flush=True)

if __name__ == "__main__":
    for lang in (sys.argv[1:] or ["ceb", "tl"]):  # ceb first (smaller)
        harvest(lang)
