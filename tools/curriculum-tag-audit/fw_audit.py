#!/opt/homebrew/bin/python3
"""Outsource the curriculum-tag audit to Fireworks DeepSeek v4 Flash.

First-pass only. Does not edit production tags, rebuild APKs, or deploy.
Writes the same packet / review.jsonl / checkpoint.json layout as the in-session
audit so an integrator can mix this run with `runs/grok/`.

Safe by default: plans the worklist and exits. Pass `--run` to call Fireworks.

  /opt/homebrew/bin/python3 tools/curriculum-tag-audit/fw_audit.py
  /opt/homebrew/bin/python3 tools/curriculum-tag-audit/fw_audit.py --run
  /opt/homebrew/bin/python3 tools/curriculum-tag-audit/fw_audit.py --run --grade 6 --code G6-L-6
  /opt/homebrew/bin/python3 tools/curriculum-tag-audit/fw_audit.py --run --limit-cards 20 --concurrency 16

Needs FIREWORKS_API_KEY in the environment or in `.env.local` (repo root or
`../hiraia/.env.local`). Use Homebrew Python 3.11+ (`hashlib.file_digest`).
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import sqlite3
import ssl
import sys
import threading
import time
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from queue import Empty, Queue
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RUN = ROOT / "tools/curriculum-tag-audit/runs/fw-dsv4"
DEFAULT_REUSE = ROOT / "tools/curriculum-tag-audit/runs/grok"
URL = "https://api.fireworks.ai/inference/v1/chat/completions"
MODEL = os.environ.get("FW_MODEL", "accounts/fireworks/models/deepseek-v4-flash-0731")
REVIEWER = "deepseek-v4-flash"
PRICE_IN = float(os.environ.get("FW_PRICE_IN", "0.14"))
PRICE_CACHED = float(os.environ.get("FW_PRICE_CACHED", "0.03"))
PRICE_OUT = float(os.environ.get("FW_PRICE_OUT", "0.28"))

SOURCE_PATHS = {
    "index": "packages/mobile/src/generated/cardsIndex.generated.json",
    "text": "packages/mobile/assets/data/cards.db",
    "source_tags": "rag/bank/curriculum-tags.json",
    "runtime_tags": "packages/mobile/src/generated/curriculumTags.generated.json",
    "exclusions": "packages/mobile/src/data/curriculumTagExclusions.json",
    "elementary": "rag/sources/curriculum-guides/matatag-elementary-competencies.json",
    "jhs": "rag/sources/curriculum-guides/matatag-jhs-competencies.json",
    "outline": "packages/mobile/src/generated/curriculumOutline.generated.json",
}

# README order for Grade 6 living things, then the rest of the catalogue.
G6_LIVING = ["G6-L-2", "G6-L-3", "G6-L-1", "G6-L-4", "G6-L-5", "G6-L-6", "G6-L-8", "G6-L-7"]
FORMAT_REQUIRED = {
    "G4-L-3": "drawing or diagram classifying Philippine animals/plants by habitat",
    "G4-L-4": "list or table of animals and plants in a named habitat",
    "G4-L-5": "flow chart comparing life-cycle stages",
    "G4-L-7": "drawn food chain of Philippine living things labeled herbivore/carnivore/omnivore",
    "G5-L-4": "table classifying living things into the named groups",
    "G5-F-8": "assembled/drawn simple circuit",
    "G6-L-3": "plan of a fair test of cutting/budding/layering/grafting",
    "G8-L-1": "labeled diagram tracing food through the digestive tract",
    "G8-L-8": "flow charts and labeled diagrams of carbon/oxygen/water cycles",
    "G9-L-7": "class discussion of threats to biodiversity and extinction",
}
ALLOWED_FLAGS = {
    "translation_mismatch",
    "possible_factual_error",
    "source_ambiguous",
    "grade_mismatch",
    "source_runtime_disagreement",
    "unknown_code",
}
VERDICTS = ("direct", "prerequisite_only", "related_only", "wrong", "uncertain")

REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["assigned_reviews", "proposed_codes", "replacement_evidence", "flags", "notes"],
    "properties": {
        "assigned_reviews": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["code", "verdict", "card_evidence", "reason"],
                "properties": {
                    "code": {"type": "string"},
                    "verdict": {"type": "string", "enum": list(VERDICTS)},
                    "card_evidence": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
        "proposed_codes": {"type": "array", "items": {"type": "string"}},
        "replacement_evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["code", "card_evidence", "reason"],
                "properties": {
                    "code": {"type": "string"},
                    "card_evidence": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
        "flags": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
    },
}


def catalog_text(entry) -> str:
    if isinstance(entry, dict):
        return entry.get("text") or ""
    return str(entry)


def system_prompt(catalog: dict) -> str:
    lines = []
    for code in sorted(catalog, key=lambda c: (catalog[c].get("grade", 99), c)):
        lines.append(f"{code}\t{catalog_text(catalog[code])}")
    fmt = "\n".join(f"- {k}: {v}" for k, v in FORMAT_REQUIRED.items())
    catalogue = "\n".join(lines)
    return f"""You are auditing MATATAG science curriculum tags on flash cards for an offline Grade 3–10 Filipino science tutor (Hiraia). Factual accuracy ranks above language fluency. You review tags; you do not rewrite card text or change production data.

TASK
For one card, judge EVERY assigned competency code against the full card text and the exact competency wording. A shared word, organism, domain, grade suffix, or labeler confidence is not enough. Ask: does this card give a student information needed to perform the action in the competency? It need not teach the entire competency, but must directly support a substantive part of it.

VERDICTS (one per assigned code)
- direct: explicitly supports the stated skill/concept at this curriculum placement.
- prerequisite_only: useful background, but does not teach this competency directly.
- related_only: same broad subject or vocabulary; no direct instructional support.
- wrong: contradicts the intended subject or is unrelated to it.
- uncertain: text, source, grade fit, or interpretation is insufficient to judge.

Only `direct` codes belong in proposed_codes. proposed_codes is the complete recommended set, primary first — not a list of additions. Empty proposed_codes is allowed (a good enrichment card can stay untagged). Never invent a code. Never force a card into a competency.

FORMAT-REQUIRED COMPETENCIES
If the competency names a representation or activity and the card does not use it, verdict is at most related_only (prerequisite_only only when the content is clearly required background):
{fmt}

HARD RULES FROM FIRST-PASS AUDITS
- Calibration: sleep-tiredness-builds-while-awake-g5 (ffct-10018) tagged G6-L-2 is wrong. Sleep pressure is not plant reproduction. Confidence 1.0 is not evidence.
- G6-L-2 is pollination, seed production, or vegetative propagation. Seed dispersal is related_only. Fungi are wrong for G6-L-2.
- G6-L-3 is a fair-test plan of cutting/budding/layering/grafting. A how-to of one method is G6-L-2 direct and G6-L-3 prerequisite_only.
- G6-L-6 is competition or predation only. Mutualism, commensalism, schooling, herd-protection, roosting, colony-size, seed-dispersal, and fruit-color are not G6-L-6 direct (often G3-L-7 and/or G6-L-8).
- Parasitism, disease vectors, and blood-feeding are G6-L-8 harm, not G6-L-6, unless the card actually teaches competition or predation.
- G6-L-5 needs producer, consumer, scavenger, or decomposer function — not merely who-eats-who.
- G6-L-1 is heart, blood, blood vessels, and how they work — not ABO/Rh trivia, first aid, ECG, or lifestyle advice.
- G6-L-4 needs the backbone vs no-backbone contrast with an example.
- Physics/chemistry/math strays on living-things tags are wrong + flag grade_mismatch.
- Read English first. Flag translation_mismatch if TL/Bisaya changes the meaning. Do not silently decide medical/scientific correctness; flag possible_factual_error instead.
- Cross-grade tags need a separate direct-support reason for each grade's wording.

EVIDENCE
card_evidence MUST be a short contiguous exact substring of the English card text (copy.en). Do not join across a question/answer break. Do not paraphrase. Do not include a trailing character that is not in the English text.

OUTPUT
Return JSON only, matching the schema. assigned_reviews must cover every assigned code exactly once. replacement_evidence is required for every proposed code that you did not already mark direct among the assigned codes. flags from: translation_mismatch, possible_factual_error, source_ambiguous, grade_mismatch, source_runtime_disagreement, unknown_code.

CATALOGUE (code, then exact competency text — propose only from this list)
{catalogue}
"""


def load_key() -> str:
    if os.environ.get("FIREWORKS_API_KEY"):
        return os.environ["FIREWORKS_API_KEY"]
    for path in (ROOT / ".env.local", ROOT.parent / "hiraia" / ".env.local", Path.home() / "Code" / "hiraia" / ".env.local"):
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            if line.startswith("FIREWORKS_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("FIREWORKS_API_KEY missing — export it or put it in .env.local")


def read_json(rel: str):
    return json.loads((ROOT / rel).read_text())


def fingerprint_sources():
    hashes = {key: hashlib.file_digest((ROOT / path).open("rb"), "sha256").hexdigest() for key, path in SOURCE_PATHS.items()}
    snapshot = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
    return snapshot, hashes


def load_catalog():
    catalog = {}
    for key in ("elementary", "jhs"):
        doc = read_json(SOURCE_PATHS[key])
        for quarter in doc["quarters"]:
            for c in quarter["competencies"]:
                catalog[c["code"]] = {
                    **c,
                    "grade": quarter["grade"],
                    "quarter": quarter["quarter"],
                    "domain": quarter["domain"],
                    "content": quarter.get("content"),
                    "source_file": SOURCE_PATHS[key],
                    "source": doc.get("source"),
                }
    return catalog


def assigned_for(card, raw, runtime):
    source = raw.get(card["id"], {}) or {}
    live = runtime.get(card["id"])
    extra = []
    if live:
        extra = live[5] if len(live) > 5 else ([live[0]] if live[0] else [])
    codes = list(
        dict.fromkeys(
            [
                *(source.get("codes") or ([source["competency"]] if source.get("competency") else [])),
                *extra,
            ]
        )
    )
    return codes, source, live


def load_bank(catalog):
    raw = read_json(SOURCE_PATHS["source_tags"])["factoids"]
    runtime = read_json(SOURCE_PATHS["runtime_tags"])
    exclusions = read_json(SOURCE_PATHS["exclusions"])
    cards = read_json(SOURCE_PATHS["index"])["cards"]
    rows = []
    for card in cards:
        codes, source, live = assigned_for(card, raw, runtime)
        rows.append((card, codes, source, live))
    rows.sort(key=lambda row: (row[0]["factId"] not in exclusions, row[0]["factId"], row[0]["id"]))
    return rows, exclusions


def filter_queue(rows, catalog, grade, code):
    out = []
    for card, codes, source, live in rows:
        if code and code not in codes:
            continue
        if grade and not any(catalog.get(c, {}).get("grade") == grade for c in codes):
            continue
        if code is None and grade is None:
            if codes:
                continue
        out.append((card, codes, source, live))
    return out


def packet_stem(code: str | None, offset: int) -> str:
    if not code:
        return f"untagged-{offset:04d}"
    parts = code.split("-")
    if len(parts) >= 3:
        return f"{parts[0].lower()}-{parts[1].lower()}{parts[2]}-{offset:04d}"
    return f"{code.lower()}-{offset:04d}"


def filter_grade(catalog, code: str | None):
    if not code:
        return None
    return catalog.get(code, {}).get("grade")


def ingest_review_line(index: dict, line: str, snapshot: str) -> None:
    if not line.strip():
        return
    obj = json.loads(line)
    key = (obj.get("fact_id"), obj.get("item_sha256"))
    if not key[0] or not key[1]:
        return
    prev = index.get(key)
    if prev is None or (prev.get("snapshot") != snapshot and obj.get("snapshot") == snapshot):
        index[key] = obj


def load_reuse(dirs: list[Path], snapshot: str) -> dict:
    """Map (fact_id, item_sha256) -> review. Prefer same-snapshot, else rebase by hash."""
    index = {}
    for d in dirs:
        if not d.is_dir():
            continue
        for path in sorted(d.glob("*.review.jsonl")):
            for line in path.read_text().splitlines():
                ingest_review_line(index, line, snapshot)
        partial = d / "partial"
        if partial.is_dir():
            for path in sorted(partial.glob("*.jsonl")):
                for line in path.read_text().splitlines():
                    ingest_review_line(index, line, snapshot)
    return index


def lookup_reuse(snapshot, item, assigned, index):
    obj = index.get((item["fact_id"], item["item_sha256"]))
    if not obj:
        return None
    by_code = {a["code"]: a for a in obj.get("assigned_reviews", [])}
    if set(by_code) != set(assigned):
        return None
    out = dict(obj)
    out["assigned_reviews"] = [by_code[c] for c in assigned]
    out["snapshot"] = snapshot
    return out


def evidence_haystack(item) -> str:
    return item["copy"].get("en") or item["copy"].get("tl") or item["copy"].get("bis") or ""


def validate_model_obj(raw, item, catalog):
    """Return (review_fields, error). review_fields lacks identity/disposition."""
    assigned = item["assigned_codes"]
    en = evidence_haystack(item)
    if not isinstance(raw, dict):
        return None, "model output is not an object"
    reviews = raw.get("assigned_reviews") or []
    by_code = {}
    for row in reviews:
        if not isinstance(row, dict):
            return None, "assigned_reviews entry is not an object"
        code = row.get("code")
        if code in by_code:
            return None, f"duplicate assigned review {code}"
        by_code[code] = row
    if set(by_code) != set(assigned):
        return None, f"assigned_reviews {sorted(by_code)} != {assigned}"
    verdicts = {}
    assigned_reviews = []
    for code in assigned:
        row = by_code[code]
        verdict = row.get("verdict")
        if verdict not in VERDICTS:
            return None, f"bad verdict {verdict!r} for {code}"
        ev = (row.get("card_evidence") or "").strip()
        if not ev or ev not in en:
            return None, f"card_evidence not an exact EN substring for {code}: {ev!r}"
        reason = (row.get("reason") or "").strip()
        if len(reason) < 12:
            return None, f"reason too short for {code}"
        cat = catalog.get(code)
        if not cat:
            return None, f"unknown assigned code {code}"
        assigned_reviews.append(
            {
                "code": code,
                "verdict": verdict,
                "card_evidence": ev,
                "competency_evidence": catalog_text(cat),
                "reason": reason,
            }
        )
        verdicts[code] = verdict

    proposed = list(dict.fromkeys(raw.get("proposed_codes") or []))
    for code in proposed:
        if code not in catalog:
            return None, f"proposed code not in catalogue: {code}"
    replacement = []
    for row in raw.get("replacement_evidence") or []:
        if not isinstance(row, dict):
            return None, "replacement_evidence entry is not an object"
        code = row.get("code")
        ev = (row.get("card_evidence") or "").strip()
        reason = (row.get("reason") or "").strip()
        if code not in catalog:
            return None, f"replacement code not in catalogue: {code}"
        if not ev or ev not in en:
            return None, f"replacement card_evidence not in EN for {code}: {ev!r}"
        replacement.append(
            {
                "code": code,
                "card_evidence": ev,
                "competency_evidence": catalog_text(catalog[code]),
                "reason": reason or f"{code} is directly supported by the card.",
            }
        )

    flags = [f for f in (raw.get("flags") or []) if f in ALLOWED_FLAGS]
    notes = (raw.get("notes") or "").strip()

    if any(verdicts[c] == "uncertain" for c in assigned):
        disposition = "uncertain"
        if not proposed:
            proposed = list(assigned)
    else:
        directs = [c for c in assigned if verdicts[c] == "direct"]
        extras = [c for c in proposed if c not in assigned]
        # Rebuild proposed: assigned directs in assigned order, then extras.
        rebuilt = list(directs) + [c for c in extras if c not in directs]
        if not directs and not extras:
            rebuilt = []
        for extra in extras:
            if extra in assigned and verdicts.get(extra) == "direct":
                continue
            if not any(r["code"] == extra for r in replacement):
                if extra not in assigned:
                    return None, f"missing replacement_evidence for {extra}"
        for extra in rebuilt:
            if extra in assigned and verdicts.get(extra) == "direct":
                continue
            if extra not in assigned and not any(r["code"] == extra for r in replacement):
                return None, f"missing replacement_evidence for {extra}"
        try:
            disposition = disposition_of(rebuilt, assigned, verdicts)
        except ValueError as e:
            return None, str(e)
        proposed = rebuilt

    return {
        "disposition": disposition,
        "assigned_reviews": assigned_reviews,
        "proposed_codes": proposed,
        "replacement_evidence": replacement,
        "flags": flags,
        "notes": notes,
    }, None


def disposition_of(proposed, assigned, verdicts) -> str:
    directs = [c for c in assigned if verdicts[c] == "direct"]
    if not proposed:
        if directs:
            raise ValueError(f"exclude but has directs {directs}")
        return "exclude"
    if not set(directs) <= set(proposed):
        raise ValueError(f"proposed {proposed} missing directs {directs}")
    if any(c not in assigned for c in proposed):
        return "correct"
    if proposed == assigned:
        if directs != assigned:
            raise ValueError("keep-shaped but not all direct")
        return "keep"
    if set(proposed) == set(directs):
        return "correct"
    raise ValueError(f"proposed {proposed} != directs {directs}")


def build_item(card, codes, source, live, exclusions, db):
    text = db.execute("SELECT * FROM card_text WHERE id=?", (card["id"],)).fetchone()
    if text is None:
        raise SystemExit("Missing card text: " + card["id"])
    item = {
        "id": card["id"],
        "fact_id": card["factId"],
        "topic": card["topic"],
        "categories": card.get("cats", []),
        "copy": dict(text),
        "assigned_codes": codes,
        "source_tag": source,
        "runtime_tag": live,
        "existing_exclusion": exclusions.get(card["factId"]),
    }
    item["item_sha256"] = hashlib.sha256(json.dumps(item, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return item


def write_packet(path: Path, snapshot, hashes, filt, offset, items, total, catalog, outline):
    packet = {
        "schema_version": 1,
        "snapshot": snapshot,
        "source_sha256": hashes,
        "source_paths": SOURCE_PATHS,
        "filter": filt,
        "offset": offset,
        "next_offset": offset + len(items),
        "total_in_filter": total,
        "items": items,
        "competency_catalog": catalog,
        "outline": outline,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as f:
        json.dump(packet, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return packet


def open_cards_db(*, immutable: bool = True):
    """Read-only. Prefer immutable=1 so other readers cannot lock us; fall back if the file is mid-replace."""
    db_path = ROOT / SOURCE_PATHS["text"]
    q = "mode=ro&immutable=1" if immutable else "mode=ro"
    uri = f"file:{db_path}?{q}"
    last = None
    for attempt in range(8):
        try:
            db = sqlite3.connect(uri, uri=True, timeout=30)
            db.row_factory = sqlite3.Row
            return db
        except sqlite3.OperationalError as e:
            last = e
            if "locked" not in str(e).lower() or attempt == 7:
                raise
            time.sleep(0.25 * (attempt + 1))
    raise last


def load_or_export_packet(path, snapshot, hashes, filt, offset, queue_slice, total, catalog, outline, exclusions):
    if path.exists():
        packet = json.loads(path.read_text())
        if packet.get("snapshot") != snapshot:
            raise SystemExit(f"existing packet snapshot mismatch: {path}")
        if packet.get("offset") != offset:
            raise SystemExit(f"existing packet offset mismatch: {path}")
        return packet
    items = []
    last_missing = None
    for use_imm in (True, True, False):
        items = []
        try:
            with open_cards_db(immutable=use_imm) as db:
                for card, codes, source, live in queue_slice:
                    items.append(build_item(card, codes, source, live, exclusions, db))
            last_missing = None
            break
        except SystemExit as e:
            if "Missing card text" not in str(e):
                raise
            last_missing = e
            time.sleep(0.4)
        except sqlite3.DatabaseError as e:
            last_missing = e
            time.sleep(0.4)
    if last_missing:
        raise last_missing
    return write_packet(path, snapshot, hashes, filt, offset, items, total, catalog, outline)


def user_payload(item, catalog):
    copy = item["copy"]
    assigned = []
    for code in item["assigned_codes"]:
        entry = catalog.get(code) or {}
        assigned.append(
            {
                "code": code,
                "text": catalog_text(entry),
                "grade": entry.get("grade"),
                "quarter": entry.get("quarter"),
                "domain": entry.get("domain"),
                "content": entry.get("content"),
                "format_required": FORMAT_REQUIRED.get(code),
            }
        )
    src_codes = (item.get("source_tag") or {}).get("codes")
    live = item.get("runtime_tag")
    live_codes = live[5] if live and len(live) > 5 else (live[:1] if live else None)
    return {
        "fact_id": item["fact_id"],
        "id": item["id"],
        "topic": item.get("topic"),
        "title_en": copy.get("title_en"),
        "en": copy.get("en"),
        "title_tl": copy.get("title_tl"),
        "tl": copy.get("tl"),
        "title_bis": copy.get("title_bis"),
        "bis": copy.get("bis"),
        "assigned_codes": item["assigned_codes"],
        "assigned_competencies": assigned,
        "source_codes": src_codes,
        "runtime_codes": live_codes,
        "existing_exclusion": item.get("existing_exclusion"),
    }


def extract_json(text: str):
    text = (text or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    a, b = text.find("{"), text.rfind("}")
    if a >= 0 and b > a:
        try:
            return json.loads(text[a : b + 1])
        except json.JSONDecodeError:
            return None
    return None


class HttpsPool:
    """Keep-alive HTTPS connections so 80 workers are not 80 fresh TLS handshakes."""

    def __init__(self, url: str, size: int, timeout: int):
        parsed = urlparse(url)
        self.host = parsed.hostname
        self.port = parsed.port or 443
        self.path = parsed.path or "/"
        self.size = max(1, size)
        self.timeout = timeout
        self.ctx = ssl.create_default_context()
        self._free: Queue = Queue()
        self._n = 0
        self._lock = threading.Lock()

    def _connect(self):
        return http.client.HTTPSConnection(self.host, self.port, timeout=self.timeout, context=self.ctx)

    def acquire(self):
        try:
            return self._free.get_nowait()
        except Empty:
            pass
        with self._lock:
            if self._n < self.size:
                self._n += 1
                return self._connect()
        return self._free.get()

    def release(self, conn, ok: bool):
        if not ok or conn is None:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            with self._lock:
                self._n = max(0, self._n - 1)
            return
        self._free.put(conn)

    def post(self, body: bytes, headers: dict, timeout: int):
        conn = self.acquire()
        try:
            conn.timeout = timeout
            conn.request("POST", self.path, body=body, headers=headers)
            resp = conn.getresponse()
            raw = resp.read()
            hdrs = {k: v for k, v in resp.getheaders()}
            status = resp.status
            self.release(conn, ok=status < 500)
            return status, hdrs, raw
        except Exception:
            self.release(conn, ok=False)
            raise


class StartLimiter:
    """Space request starts so a concurrency burst does not trip adaptive TPM 429s."""

    def __init__(self, rpm: int):
        self.min_interval = 60.0 / max(1, rpm)
        self.lock = threading.Lock()
        self.next_t = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            t = max(now, self.next_t)
            self.next_t = t + self.min_interval
            delay = t - now
        if delay > 0:
            time.sleep(delay)


class Fireworks:
    def __init__(
        self,
        key,
        model,
        timeout,
        max_retries,
        reasoning_effort="low",
        max_tokens=4096,
        pool_size=32,
        max_rpm=180,
    ):
        self.key = key
        self.model = model
        self.timeout = timeout
        self.max_retries = max_retries
        self.reasoning_effort = reasoning_effort
        self.max_tokens = max_tokens
        self.drop_reasoning = False
        self.lock = threading.Lock()
        self.http = HttpsPool(URL, pool_size, timeout)
        self.limiter = StartLimiter(max_rpm)
        self.ratelimit = {}
        self.usage = {"prompt": 0, "cached": 0, "completion": 0, "reasoning": 0, "calls": 0, "failed": 0, "http_429": 0}

    def cost(self) -> float:
        uncached = max(0, self.usage["prompt"] - self.usage["cached"])
        return (
            uncached / 1e6 * PRICE_IN
            + self.usage["cached"] / 1e6 * PRICE_CACHED
            + self.usage["completion"] / 1e6 * PRICE_OUT
        )

    def chat(self, messages, max_tokens=None):
        max_tokens = self.max_tokens if max_tokens is None else max_tokens
        formats = [
            {
                "type": "json_schema",
                "json_schema": {"name": "curriculum_tag_review", "schema": REVIEW_SCHEMA},
            },
            {"type": "json_object"},
        ]
        last_err = None
        for fmt_i, fmt in enumerate(formats):
            body = {
                "model": self.model,
                "temperature": 0.0,
                "max_tokens": max_tokens,
                "messages": messages,
                "response_format": fmt,
            }
            if self.reasoning_effort and not self.drop_reasoning:
                body["reasoning_effort"] = self.reasoning_effort
            body["prompt_cache_key"] = "hiraia-curriculum-tag-audit-v1"
            data = json.dumps(body).encode()
            headers = {"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
            for attempt in range(self.max_retries + 1):
                try:
                    self.limiter.wait()
                    status, hdrs, raw = self.http.post(data, headers, self.timeout)
                    rl = {k: v for k, v in hdrs.items() if k.lower().startswith("x-ratelimit")}
                    if rl:
                        with self.lock:
                            self.ratelimit = rl
                    if status >= 400:
                        detail = raw.decode("utf-8", "replace")[:500]
                        if (
                            status == 400
                            and self.reasoning_effort
                            and not self.drop_reasoning
                            and "reasoning" in detail.lower()
                        ):
                            print(f"  warning: dropping reasoning_effort ({detail[:160]})", flush=True)
                            self.drop_reasoning = True
                            body.pop("reasoning_effort", None)
                            data = json.dumps(body).encode()
                            continue
                        if status == 400 and fmt_i == 0 and "response_format" in detail.lower():
                            last_err = RuntimeError(f"HTTP 400: {detail}")
                            break
                        if status in (429, 500, 502, 503, 529) and attempt < self.max_retries:
                            if status == 429:
                                with self.lock:
                                    self.usage["http_429"] += 1
                            ra = hdrs.get("Retry-After") or hdrs.get("retry-after")
                            time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
                            continue
                        with self.lock:
                            self.usage["failed"] += 1
                        raise RuntimeError(f"HTTP {status}: {detail}")
                    payload = json.loads(raw)
                    msg = payload["choices"][0]["message"]
                    usage = payload.get("usage") or {}
                    prompt = usage.get("prompt_tokens") or 0
                    completion = usage.get("completion_tokens") or 0
                    cached = (
                        (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
                        or usage.get("cached_tokens")
                        or 0
                    )
                    reasoning = (
                        (usage.get("completion_tokens_details") or {}).get("reasoning_tokens")
                        or (usage.get("output_tokens_details") or {}).get("reasoning_tokens")
                        or 0
                    )
                    with self.lock:
                        self.usage["prompt"] += prompt
                        self.usage["cached"] += cached
                        self.usage["completion"] += completion
                        self.usage["reasoning"] += reasoning
                        self.usage["calls"] += 1
                    return msg.get("content") or "", usage
                except (TimeoutError, json.JSONDecodeError, OSError, http.client.HTTPException) as e:
                    last_err = e
                    if attempt < self.max_retries:
                        time.sleep(min(90, 2 ** (attempt + 1)))
                        continue
                    with self.lock:
                        self.usage["failed"] += 1
                    raise
        with self.lock:
            self.usage["failed"] += 1
        raise RuntimeError(f"request failed: {last_err}")


def snippet_en(item, n=80) -> str:
    en = (evidence_haystack(item) or "").strip()
    if not en:
        return ""
    line = en.split("\n")[0].strip() or en
    return line[:n]


def fallback_uncertain(item, catalog, snapshot, err: str):
    """Keep the remaining run moving if a card still fails after retries."""
    ev = snippet_en(item)
    en = evidence_haystack(item)
    if ev and ev not in en:
        ev = en[: min(80, len(en))]
    assigned_reviews = []
    for code in item["assigned_codes"]:
        cat = catalog.get(code) or {}
        assigned_reviews.append(
            {
                "code": code,
                "verdict": "uncertain",
                "card_evidence": ev,
                "competency_evidence": catalog_text(cat),
                "reason": f"Model output failed validation after retries: {err}"[:400],
            }
        )
    return {
        "snapshot": snapshot,
        "fact_id": item["fact_id"],
        "id": item["id"],
        "item_sha256": item["item_sha256"],
        "reviewer": REVIEWER,
        "reviewed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "disposition": "uncertain",
        "assigned_reviews": assigned_reviews,
        "proposed_codes": list(item["assigned_codes"]),
        "replacement_evidence": [],
        "flags": [],
        "notes": f"model-fail fallback: {err}",
    }


def review_item(fw: Fireworks, sys_prompt: str, item, catalog, snapshot, repair_tries, raw_dir: Path, max_tokens=None):
    payload = user_payload(item, catalog)
    messages = [
        {"role": "system", "content": sys_prompt},
        {
            "role": "user",
            "content": "Audit this card. Return JSON.\n" + json.dumps(payload, ensure_ascii=False),
        },
    ]
    last_err = "no output"
    tokens = fw.max_tokens if max_tokens is None else max_tokens
    for attempt in range(repair_tries + 1):
        content, usage = fw.chat(messages, max_tokens=tokens)
        raw_dir.mkdir(parents=True, exist_ok=True)
        (raw_dir / f"{item['fact_id']}.json").write_text(
            json.dumps({"content": content, "usage": usage, "attempt": attempt}, ensure_ascii=False, indent=2) + "\n"
        )
        parsed = extract_json(content)
        fields, err = validate_model_obj(parsed, item, catalog)
        if fields:
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            return {
                "snapshot": snapshot,
                "fact_id": item["fact_id"],
                "id": item["id"],
                "item_sha256": item["item_sha256"],
                "reviewer": REVIEWER,
                "reviewed_at": now,
                **fields,
            }
        last_err = err or "unparseable JSON"
        completion = (usage or {}).get("completion_tokens") or 0
        if not isinstance(parsed, dict) and completion >= int(tokens * 0.9):
            tokens = min(16384, max(tokens * 2, tokens + 2048))
            last_err = f"truncated JSON at max_tokens={tokens // 2}: {last_err}"
        messages.append({"role": "assistant", "content": content or ""})
        messages.append(
            {
                "role": "user",
                "content": (
                    "Validation failed: "
                    + last_err
                    + "\nFix the JSON. card_evidence must be a contiguous exact substring of this English text:\n"
                    + json.dumps(item["copy"].get("en") or "", ensure_ascii=False)
                ),
            }
        )
    raise RuntimeError(f"{item['fact_id']}: {last_err}")


def load_session_state(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {"snapshot": None, "filters": []}


def render_session_md(state: dict) -> str:
    parts = []
    for filt in state.get("filters", []):
        t = filt["totals"]
        lines = [
            f"# {filt['title']} first-pass session ({REVIEWER})",
            "",
            f"Filter: `{filt['label']}`. Snapshot `{state['snapshot'][:16]}…`. Total in filter: **{filt['total']}**.",
            "",
            "| Packet | Offset | Cards | Keep | Correct | Exclude | Uncertain | Assignments |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for pkt in filt["packets"]:
            c = pkt["counts"]
            lines.append(
                f"| {pkt['stem']} | {pkt['offset']} | {c['cards']} | {c['keep']} | {c['correct']} | "
                f"{c['exclude']} | {c['uncertain']} | {c['assignments_reviewed']} |"
            )
        lines.append(
            f"| **session** | | **{t['cards']}** | **{t['keep']}** | **{t['correct']}** | "
            f"**{t['exclude']}** | **{t['uncertain']}** | **{t['assignments_reviewed']}** |"
        )
        lines += ["", filt.get("extras") or "", "", "## Resume", "", "```sh", filt["next_command"], "```", ""]
        parts.append("\n".join(lines))
    return "\n".join(parts).rstrip() + "\n"


def record_packet(state, title, label, snapshot, total, stem, offset, counts, next_cmd, extras):
    state["snapshot"] = snapshot
    block = None
    for filt in state["filters"]:
        if filt["title"] == title:
            block = filt
            break
    if block is None:
        block = {
            "title": title,
            "label": label,
            "total": total,
            "packets": [],
            "totals": {"cards": 0, "assignments_reviewed": 0, "keep": 0, "correct": 0, "exclude": 0, "uncertain": 0},
            "next_command": next_cmd,
            "extras": extras,
        }
        state["filters"].append(block)
    if not any(p["stem"] == stem for p in block["packets"]):
        block["packets"].append({"stem": stem, "offset": offset, "counts": counts})
        for k, v in counts.items():
            block["totals"][k] = block["totals"].get(k, 0) + v
    block["next_command"] = next_cmd
    block["extras"] = extras
    block["total"] = total
    return block["totals"]


def code_queue(catalog, scope: str, grade, code):
    if code:
        g = grade if grade is not None else filter_grade(catalog, code)
        return [(g, code)]
    if scope == "untagged":
        return [(None, None)]
    ordered = list(G6_LIVING)
    rest = [c for c in sorted(catalog, key=lambda x: (catalog[x].get("grade", 99), x)) if c not in ordered]
    codes = ordered + rest
    if grade is not None:
        codes = [c for c in codes if catalog.get(c, {}).get("grade") == grade]
    pairs = [(catalog[c]["grade"], c) for c in codes]
    if scope == "all":
        pairs.append((None, None))
    return pairs


def relpath(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def fw_next_command(run_dir: Path, grade, code, offset, snapshot, extra_args: str) -> str:
    parts = [
        "/opt/homebrew/bin/python3 tools/curriculum-tag-audit/fw_audit.py --run",
        f"--run-dir {relpath(run_dir)}",
    ]
    if grade is not None:
        parts.append(f"--grade {grade}")
    if code:
        parts.append(f"--code {code}")
    parts.append(f"--offset {offset}")
    parts.append(f"--expect-snapshot {snapshot}")
    if extra_args:
        parts.append(extra_args)
    return " ".join(parts)


def parse_reasoning_effort(value: str):
    """Fireworks DeepSeek V4 promotes string 'low'/'medium' to 'high'. Integer caps are real."""
    v = (value or "low").strip().lower()
    if v.isdigit():
        return int(v)
    aliases = {
        "low": 256,
        "medium": 512,
        "none": "none",
        "off": "none",
        "false": "none",
        "high": "high",
        "max": "max",
    }
    return aliases.get(v, value)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run", action="store_true", help="Call Fireworks. Default is plan-only.")
    p.add_argument("--run-dir", type=Path, default=DEFAULT_RUN)
    p.add_argument("--reuse-dir", type=Path, action="append", help="Existing first-pass reviews to reuse (repeatable). Default: runs/grok")
    p.add_argument("--scope", choices=("remaining", "tagged", "all", "untagged"), default="remaining")
    p.add_argument("--grade", type=int, choices=range(3, 11))
    p.add_argument("--code", help="Single competency filter, e.g. G6-L-6")
    p.add_argument("--offset", type=int, default=0, help="Start offset inside the first filter")
    p.add_argument("--packet-size", type=int, default=50)
    p.add_argument("--limit-cards", type=int, default=0, help="Stop after N new model reviews (0 = no cap)")
    p.add_argument("--concurrency", type=int, default=32)
    p.add_argument("--timeout", type=int, default=180)
    p.add_argument("--retries", type=int, default=6)
    p.add_argument("--repair", type=int, default=1, help="Repair attempts after a validation miss")
    p.add_argument(
        "--reasoning-effort",
        default=os.environ.get("FW_REASONING_EFFORT", "low"),
        help="low (256-token cap), medium (512), none, high, max, or an integer budget. "
        "String 'low' is remapped to 256 because Fireworks promotes it to high on DeepSeek V4.",
    )
    p.add_argument("--max-tokens", type=int, default=4096, help="Completion cap including reasoning tokens.")
    p.add_argument(
        "--max-rpm",
        type=int,
        default=180,
        help="Client-side start-rate cap. Fireworks adaptive generated TPM is ~112.5k now (~230 RPM at our token size).",
    )
    p.add_argument("--model", default=MODEL)
    p.add_argument("--expect-snapshot")
    p.add_argument("--print-prompt", action="store_true")
    p.add_argument("--max-packets", type=int, default=0, help="Stop after N packets written (0 = no cap)")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    args.reasoning_effort = parse_reasoning_effort(str(args.reasoning_effort))
    if args.packet_size < 1 or args.packet_size > 100:
        raise SystemExit("packet-size must be 1–100 (batch.py limit)")
    snapshot, hashes = fingerprint_sources()
    if args.expect_snapshot and args.expect_snapshot != snapshot:
        raise SystemExit("Source snapshot changed. Rebase by fact_id; do not continue by old offsets.")
    catalog = load_catalog()
    if args.code and args.code not in catalog:
        raise SystemExit(f"Unknown competency code {args.code}")
    if args.print_prompt:
        sys.stdout.write(system_prompt(catalog))
        return 0

    run_dir = args.run_dir if args.run_dir.is_absolute() else ROOT / args.run_dir
    run_dir.mkdir(parents=True, exist_ok=True)
    reuse_dirs = args.reuse_dir or [DEFAULT_REUSE]
    reuse_dirs = [p if p.is_absolute() else ROOT / p for p in reuse_dirs]
    reuse = load_reuse(reuse_dirs + [run_dir], snapshot)
    reuse_by_fid: dict[str, list] = {}
    for (fid, _sha), obj in reuse.items():
        reuse_by_fid.setdefault(fid, []).append(obj)

    rows, exclusions = load_bank(catalog)
    outline = read_json(SOURCE_PATHS["outline"])
    sys_prompt = system_prompt(catalog)
    pairs = code_queue(catalog, args.scope if not args.code else "tagged", args.grade, args.code)

    def reusable_row(card, codes) -> bool:
        for obj in reuse_by_fid.get(card["factId"], []):
            by = {a["code"] for a in obj.get("assigned_reviews", [])}
            if by == set(codes) and obj.get("id") == card["id"]:
                return True
        return False

    plan = []
    remaining_calls = 0
    unique_todo = 0
    seen_cards: set[tuple] = set()
    for grade, code in pairs:
        q = filter_queue(rows, catalog, grade, code)
        already_n = 0
        todo_n = 0
        for card, codes, _s, _l in q:
            key = (card["id"], tuple(codes))
            is_reused = reusable_row(card, codes)
            if is_reused:
                already_n += 1
            else:
                todo_n += 1
                if key not in seen_cards:
                    unique_todo += 1
            seen_cards.add(key)
        plan.append({"grade": grade, "code": code, "total": len(q), "already": already_n, "todo": todo_n})
        remaining_calls += todo_n

    print(f"snapshot {snapshot}")
    print(f"model    {args.model}")
    print(f"reasoning {args.reasoning_effort}  max_tokens={args.max_tokens}  max_rpm={args.max_rpm}")
    print(f"run-dir  {run_dir}")
    print(f"reuse    {', '.join(str(p) for p in reuse_dirs)} ({len(reuse)} first-pass rows)")
    print(f"scope    {args.scope}" + (f" grade={args.grade}" if args.grade else "") + (f" code={args.code}" if args.code else ""))
    print("filter                      total  reused   todo")
    shown = 0
    for row in plan:
        if row["todo"] == 0 and args.scope == "remaining":
            continue
        label = row["code"] or "untagged"
        print(f"  {label:<24} {row['total']:6d} {row['already']:7d} {row['todo']:6d}")
        shown += 1
        if shown >= 40 and not args.run:
            rest_todo = sum(r["todo"] for r in plan) - sum(r["todo"] for r in plan if r["todo"] and shown <= 40)
            break
    print(f"filter-membership remaining: {remaining_calls} (upper bound; cards repeat across codes)")
    print(f"unique cards still needing a first-pass: {unique_todo}")
    print(f"est cost ~${unique_todo * 0.0006:.2f}–${unique_todo * 0.0012:.2f} at Flash list prices (very rough)")
    if not args.run:
        print("\nPlan only. Pass --run to call Fireworks. Example:")
        print("  /opt/homebrew/bin/python3 tools/curriculum-tag-audit/fw_audit.py --run --limit-cards 20")
        return 0

    key = load_key()
    fw = Fireworks(
        key,
        args.model,
        args.timeout,
        args.retries,
        args.reasoning_effort,
        args.max_tokens,
        pool_size=max(1, args.concurrency),
        max_rpm=max(1, args.max_rpm),
    )
    session_path = run_dir / "SESSION.md"
    state_path = run_dir / "session-state.json"
    session_state = load_session_state(state_path)
    raw_dir = run_dir / "raw"
    start_offset = args.offset
    new_reviews = 0
    packets_written = 0
    t0 = time.time()
    pool = ThreadPoolExecutor(max_workers=max(1, args.concurrency))
    prefetch: dict | None = None
    try:
      for grade, code in pairs:
        q = filter_queue(rows, catalog, grade, code)
        total = len(q)
        if total == 0:
            continue
        filt = {"grade": grade, "code": code}
        filter_label = f"--grade {grade} --code {code}" if code else "--untagged"
        offset = start_offset if (code == args.code or (args.code is None and pairs[0] == (grade, code))) else 0
        start_offset = 0
        session_totals = {"cards": 0, "assignments_reviewed": 0, "keep": 0, "correct": 0, "exclude": 0, "uncertain": 0}
        extras = (
            f"{code or 'untagged'} first-pass via {REVIEWER}. "
            "Reuse grok first-pass by (snapshot, fact_id, item_sha256) when assigned codes match."
        )
        while offset < total:
            if args.max_packets and packets_written >= args.max_packets:
                print("hit --max-packets; stopping", flush=True)
                return 0
            if args.limit_cards and new_reviews >= args.limit_cards:
                print("hit --limit-cards; stopping", flush=True)
                return 0
            limit = min(args.packet_size, total - offset)
            if args.limit_cards:
                limit = min(limit, args.limit_cards - new_reviews)
            stem = packet_stem(code, offset)
            pkt_path = run_dir / f"{stem}.packet.json"
            rev_path = run_dir / f"{stem}.review.jsonl"
            ck_path = run_dir / f"{stem}.checkpoint.json"
            if rev_path.exists() and ck_path.exists():
                ck = json.loads(ck_path.read_text())
                if not ck.get("unfinished_ids"):
                    session_totals = record_packet(
                        session_state,
                        code or "untagged",
                        filter_label,
                        snapshot,
                        total,
                        stem,
                        offset,
                        ck.get("counts") or {},
                        ck.get("next_command") or fw_next_command(run_dir, grade, code, ck.get("next_offset", offset + limit), snapshot, ""),
                        extras,
                    )
                    offset = ck.get("next_offset", offset + limit)
                    continue
            pre = prefetch if prefetch and prefetch.get("offset") == offset else None
            unfinished = []
            if pre:
                prefetch = None
                packet = pre["packet"]
                items = pre["items"]
                reviews = list(pre["reviews"])
                to_call = pre["to_call"]
                futs = pre["futs"]
                pkt_path = pre["pkt_path"]
                rev_path = pre["rev_path"]
                ck_path = pre["ck_path"]
                limit = pre["limit"]
                stem = pre["stem"]
            else:
                packet = load_or_export_packet(
                    pkt_path, snapshot, hashes, filt, offset, q[offset : offset + limit], total, catalog, outline, exclusions
                )
                items = packet["items"]
                reviews = []
                to_call = []
                for it in items:
                    reused = lookup_reuse(snapshot, it, it["assigned_codes"], reuse)
                    if reused:
                        reviews.append(reused)
                        reuse[(it["fact_id"], it["item_sha256"])] = reused
                    else:
                        to_call.append(it)
                futs = None
            if to_call:
                if futs is None:
                    print(
                        f"{stem}: {len(items)} cards ({len(to_call)} model, {len(reviews)} reuse) "
                        f"offset {offset}/{total}",
                        flush=True,
                    )
                    futs = {
                        pool.submit(review_item, fw, sys_prompt, it, catalog, snapshot, args.repair, raw_dir): it
                        for it in to_call
                    }
                by_id = {}
                # Overlap the next packet's calls on the same pool so a straggler
                # does not idle the other workers.
                next_off = offset + len(items)
                if (
                    next_off < total
                    and prefetch is None
                    and not (args.max_packets and packets_written + 1 >= args.max_packets)
                    and not (args.limit_cards and new_reviews + len(to_call) >= args.limit_cards)
                ):
                    nlimit = min(args.packet_size, total - next_off)
                    nstem = packet_stem(code, next_off)
                    npkt_path = run_dir / f"{nstem}.packet.json"
                    nrev_path = run_dir / f"{nstem}.review.jsonl"
                    nck_path = run_dir / f"{nstem}.checkpoint.json"
                    if not (nrev_path.exists() and nck_path.exists()):
                        npacket = load_or_export_packet(
                            npkt_path, snapshot, hashes, filt, next_off,
                            q[next_off : next_off + nlimit], total, catalog, outline, exclusions,
                        )
                        nreviews = []
                        nto_call = []
                        for nit in npacket["items"]:
                            reused = lookup_reuse(snapshot, nit, nit["assigned_codes"], reuse)
                            if reused:
                                nreviews.append(reused)
                                reuse[(nit["fact_id"], nit["item_sha256"])] = reused
                            else:
                                nto_call.append(nit)
                        nfuts = {
                            pool.submit(review_item, fw, sys_prompt, nit, catalog, snapshot, args.repair, raw_dir): nit
                            for nit in nto_call
                        }
                        prefetch = {
                            "offset": next_off,
                            "stem": nstem,
                            "packet": npacket,
                            "items": npacket["items"],
                            "reviews": nreviews,
                            "to_call": nto_call,
                            "futs": nfuts,
                            "pkt_path": npkt_path,
                            "rev_path": nrev_path,
                            "ck_path": nck_path,
                            "limit": nlimit,
                        }
                        if nto_call:
                            print(
                                f"{nstem}: {len(npacket['items'])} cards ({len(nto_call)} model, {len(nreviews)} reuse) "
                                f"offset {next_off}/{total} (pipelined)",
                                flush=True,
                            )
                for fut in as_completed(futs):
                    it = futs[fut]
                    try:
                        obj = fut.result()
                        by_id[it["fact_id"]] = obj
                        reuse[(it["fact_id"], it["item_sha256"])] = obj
                        new_reviews += 1
                    except Exception as e:
                        print(f"  FAIL {it['fact_id']}: {e}", flush=True)
                        unfinished.append(it["id"])
                for it in to_call:
                    if it["fact_id"] in by_id:
                        reviews.append(by_id[it["fact_id"]])
            if unfinished:
                retry_ids = set(unfinished)
                still = []
                for it in to_call:
                    if it["id"] not in retry_ids:
                        continue
                    print(f"  retry {it['fact_id']} at max_tokens={min(16384, fw.max_tokens * 2)}", flush=True)
                    try:
                        obj = review_item(
                            fw, sys_prompt, it, catalog, snapshot, max(args.repair, 2), raw_dir,
                            max_tokens=min(16384, fw.max_tokens * 2),
                        )
                        reviews.append(obj)
                        reuse[(it["fact_id"], it["item_sha256"])] = obj
                        new_reviews += 1
                    except Exception as e:
                        print(f"  FAIL {it['fact_id']} after retry: {e}", flush=True)
                        still.append(it)
                unfinished = [it["id"] for it in still]
                if still:
                    (run_dir / "skips").mkdir(exist_ok=True)
                    skip_path = run_dir / "skips" / "model-fail.jsonl"
                    with skip_path.open("a") as skip_f:
                        for it in still:
                            obj = fallback_uncertain(it, catalog, snapshot, "unrecoverable after retries")
                            reviews.append(obj)
                            reuse[(it["fact_id"], it["item_sha256"])] = obj
                            skip_f.write(json.dumps({"fact_id": it["fact_id"], "id": it["id"], "stem": stem}) + "\n")
                            print(f"  fallback uncertain {it['fact_id']}", flush=True)
                    unfinished = []
            # Keep packet order
            by_fact = {r["fact_id"]: r for r in reviews}
            missing = [it["fact_id"] for it in items if it["fact_id"] not in by_fact]
            if missing:
                raise SystemExit(f"{stem} missing reviews for {missing}")
            ordered = [by_fact[it["fact_id"]] for it in items]
            if rev_path.exists():
                raise SystemExit(f"REFUSING overwrite {rev_path}")
            if ck_path.exists() and json.loads(ck_path.read_text()).get("unfinished_ids"):
                ck_path.unlink()
            elif ck_path.exists():
                raise SystemExit(f"REFUSING overwrite {ck_path}")
            counts = {"cards": 0, "assignments_reviewed": 0, "keep": 0, "correct": 0, "exclude": 0, "uncertain": 0}
            hashes_done = []
            for it, obj in zip(items, ordered):
                counts["cards"] += 1
                counts["assignments_reviewed"] += len(it["assigned_codes"])
                counts[obj["disposition"]] += 1
                hashes_done.append(it["item_sha256"])
            rev_path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in ordered))
            next_offset = packet["next_offset"]
            next_cmd = fw_next_command(run_dir, grade, code, next_offset, snapshot, "")
            session_totals = record_packet(
                session_state, code or "untagged", filter_label, snapshot, total, stem, offset, counts, next_cmd, extras
            )
            ck = {
                "reviewer": REVIEWER,
                "filter": filt,
                "packet": relpath(pkt_path),
                "review": relpath(rev_path),
                "snapshot": snapshot,
                "offset": offset,
                "next_offset": next_offset,
                "total_in_filter": total,
                "limit": limit,
                "completed_item_hashes": hashes_done,
                "unfinished_ids": [],
                "session_totals_after_this_batch": dict(session_totals),
                "counts": counts,
                "next_command": next_cmd,
                "usage": dict(fw.usage),
                "est_cost_usd": round(fw.cost(), 4),
            }
            ck_path.write_text(json.dumps(ck, indent=2) + "\n")
            packets_written += 1
            state_path.write_text(json.dumps(session_state, indent=2) + "\n")
            session_path.write_text(render_session_md(session_state))
            print(
                f"  wrote {stem} keep={counts['keep']} correct={counts['correct']} "
                f"exclude={counts['exclude']} uncertain={counts['uncertain']} "
                f"asn={counts['assignments_reviewed']} cost~${fw.cost():.3f} "
                f"calls={fw.usage['calls']} reasoning={fw.usage['reasoning']} "
                f"429={fw.usage['http_429']} gen_tpm={fw.ratelimit.get('X-Ratelimit-Limit-Tokens-Generated', '?')} "
                f"over={fw.ratelimit.get('X-Ratelimit-Over-Limit', '?')} "
                f"elapsed={(time.time()-t0)/60:.1f}m",
                flush=True,
            )
            offset = next_offset
        print(f"filter {code or 'untagged'} complete ({session_totals['cards']}/{total})", flush=True)
      print(
        f"DONE calls={fw.usage['calls']} failed={fw.usage['failed']} "
        f"tokens in/cached/out/reason {fw.usage['prompt']}/{fw.usage['cached']}/{fw.usage['completion']}/{fw.usage['reasoning']} "
        f"est ${fw.cost():.2f} in {(time.time()-t0)/60:.1f}m",
        flush=True,
      )
      return 0
    finally:
        pool.shutdown(wait=False)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
