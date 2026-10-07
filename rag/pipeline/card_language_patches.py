"""Apply reviewed language edits after editorial assembly, without hiding source drift.

The registry stores complete before/after text context. English, Tagalog, emphasis,
identity and other card fields cannot be changed by this overlay. A source rebuild
may contain the reviewed old Cebuano or the already-applied Cebuano; anything else
requires review. The local apply command additionally checks the full card hash.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = Path(__file__).with_name("card-language-patches.json")
SCHEMA = "hiraia.reviewed-card-language-patches/v1"


def context(card: dict) -> dict:
    return {key: copy.deepcopy(card.get(key))
            for key in ("id", "factId", "fact", "title", "emphasis")}


def check_edit(before: dict, after: dict) -> None:
    """Only the two approved Cebuano strings may differ; exact spans survive."""
    if before == after:
        raise ValueError("language patch must change text")
    expected = copy.deepcopy(before)
    for field in ("fact", "title"):
        if not isinstance(before.get(field), dict) or not isinstance(after.get(field), dict):
            raise ValueError(f"language patch requires a {field} object")
        value = after[field].get("bis")
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"language patch requires nonblank {field}.bis")
        expected[field]["bis"] = value
    if expected != after:
        raise ValueError("language patch changes protected fields")
    old_body, new_body = before["fact"]["bis"], after["fact"]["bis"]
    if old_body.count("\n\n") != new_body.count("\n\n"):
        raise ValueError("language patch changes paragraph layout")
    for span in (before.get("emphasis") or {}).get("bis", []):
        if not isinstance(span, str) or not span or span not in old_body or span not in new_body:
            raise ValueError("language patch loses an exact emphasis span")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key in language patch provenance: {key}")
        result[key] = value
    return result


def _card_hash(card: dict) -> str:
    # Same full-card encoding as the immutable local approval and apply command.
    return hashlib.sha256((json.dumps(card, ensure_ascii=False, indent=2) + "\n").encode()).hexdigest()


def _load_approval(ref: dict, cache: dict) -> dict[str, dict]:
    if (not isinstance(ref, dict) or not isinstance(ref.get("path"), str) or not ref["path"] or
            not isinstance(ref.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", ref["sha256"]) or
            type(ref.get("bytes")) is not int or ref["bytes"] <= 0):
        raise ValueError("language patch requires a complete review path/size/SHA256 pin")
    path = (ROOT / ref["path"]).resolve()
    if not path.is_relative_to(ROOT.resolve()):
        raise ValueError("language patch review path must stay within the repository")
    key = (path, ref["sha256"], ref["bytes"])
    if key in cache:
        return cache[key]
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ValueError(f"cannot read language patch review: {path}") from exc
    if len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != ref["sha256"]:
        raise ValueError(f"language patch review byte pin mismatch: {path}")
    doc = json.loads(raw, object_pairs_hook=_unique_object)
    if (not isinstance(doc, dict) or
            doc.get("schema") != "hiraia.cebuano-readability-reviewed-edits/v1" or
            doc.get("status") != "reviewed_for_local_application" or
            not isinstance(doc.get("accepted"), list)):
        raise ValueError(f"language patch review is not an approved local edit plan: {path}")
    accepted = {}
    for row in doc["accepted"]:
        if not isinstance(row, dict):
            raise ValueError("invalid accepted language review row")
        cid, before, after = row.get("card_id"), row.get("before_card"), row.get("after_card")
        if not isinstance(cid, str) or not cid or cid in accepted:
            raise ValueError("invalid or duplicate accepted language review ID")
        if (row.get("decision") != "apply_reviewed_cebuano_edit" or
                not isinstance(before, dict) or not isinstance(after, dict) or
                before.get("id") != cid or after.get("id") != cid or
                _card_hash(before) != row.get("source_card_sha256") or
                _card_hash(after) != row.get("candidate_card_sha256")):
            raise ValueError(f"unapproved or inconsistent full-card review pins: {cid}")
        check_edit(before, after)
        accepted[cid] = row
    cache[key] = accepted
    return accepted


def load_registry(path: Path = REGISTRY) -> dict[str, dict]:
    """Bind each overlay to exact bytes and a unique accepted row in its approval."""
    doc = json.loads(Path(path).read_bytes(), object_pairs_hook=_unique_object)
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA or not isinstance(doc.get("patches"), list):
        raise ValueError("invalid card language patch registry")
    result, approvals = {}, {}
    for entry in doc["patches"]:
        if (not isinstance(entry, dict) or not isinstance(entry.get("before"), dict) or
                not isinstance(entry.get("after"), dict)):
            raise ValueError("invalid language patch context")
        before, after = entry["before"], entry["after"]
        card_id = before.get("id")
        if not isinstance(card_id, str) or not card_id or card_id in result:
            raise ValueError("invalid or duplicate language patch ID")
        if set(before) != {"id", "factId", "fact", "title", "emphasis"}:
            raise ValueError(f"unexpected language patch context: {card_id}")
        check_edit(before, after)
        approved = _load_approval(entry.get("review"), approvals).get(card_id)
        if (approved is None or context(approved["before_card"]) != before or
                context(approved["after_card"]) != after):
            raise ValueError(f"language patch does not match its accepted review row: {card_id}")
        result[card_id] = entry
    return result


def apply_patches(cards: list[dict], *, require_applied: bool = False,
                  registry: dict[str, dict] | None = None) -> list[dict]:
    """Return a copy; validate the whole selection before the caller writes anything."""
    patches = load_registry() if registry is None else registry
    seen = set()
    out = []
    for card in cards:
        card_id = card["id"]
        if card_id in seen:
            raise ValueError(f"duplicate card ID: {card_id}")
        seen.add(card_id)
        entry = patches.get(card_id)
        if entry is None:
            out.append(card)
            continue
        before, after = entry["before"], entry["after"]
        check_edit(before, after)
        current = context(card)
        if current != after:
            if current != before:
                raise ValueError(f"language patch source drift: {card_id}")
            if require_applied:
                raise ValueError(f"reviewed language patch not applied to pool: {card_id}")
        amended = copy.deepcopy(card)
        for field in ("fact", "title"):
            amended[field]["bis"] = after[field]["bis"]
        out.append(amended)
    missing = set(patches) - seen
    if missing:
        raise ValueError(f"language patch IDs absent from pool: {sorted(missing)}")
    return out
