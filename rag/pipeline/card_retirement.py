"""Exact card retirements shared by pool assembly and the SQLite build.

The registry is append-only: a retired card ID must never identify another card.
Assembly may exclude a matching retired identity; the database build must instead
reject it so the pool, index and database cannot silently disagree. All languages
belong to that same retirement. Historical Tala catalog entries are not removed.
"""
import hashlib
import json
from pathlib import Path
import re

REGISTRY = Path(__file__).with_name('card-retirements.json')
_CARD_ID = re.compile(r'^(?:ffct|dcard)-\d+$')
_SHA256 = re.compile(r'^[0-9a-f]{64}$')


class CardRetirementError(ValueError):
    """Retirement provenance or an input identity is inconsistent."""


def _object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise CardRetirementError(f'duplicate JSON key: {key}')
        out[key] = value
    return out


def _json(data, label):
    try:
        return json.loads(data, object_pairs_hook=_object)
    except (ValueError, UnicodeError) as exc:
        raise CardRetirementError(f'unreadable {label}: {exc}') from exc


def _pinned_json(parent, pin, label):
    if not isinstance(pin, dict) or not isinstance(pin.get('file'), str):
        raise CardRetirementError(f'missing {label} file pin')
    rel = Path(pin['file'])
    path = (parent / rel).resolve()
    if rel.is_absolute() or not path.is_relative_to(parent.resolve()):
        raise CardRetirementError(f'{label} must stay within the registry directory')
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise CardRetirementError(f'cannot read {label}: {path}') from exc
    if hashlib.sha256(data).hexdigest() != pin.get('sha256'):
        raise CardRetirementError(f'{label} hash mismatch: {path}')
    return _json(data, label)


def _check_identity(card, record):
    fact = card.get('fact')
    english = fact.get('en') if isinstance(fact, dict) else None
    if (card.get('id') != record['card_id'] or
            card.get('factId') != record['fact_id'] or
            not isinstance(english, str) or
            hashlib.sha256(english.encode('utf-8')).hexdigest() != record['original_english_sha256']):
        raise CardRetirementError(
            f"retired card identity changed: {record['card_id']}; "
            'its ID may not be reused or silently rebound to different English')


def load_retirements(path=None):
    """Validate the ledger and its original-card/tombstone pins; no missing-file bypass."""
    path = Path(path) if path is not None else REGISTRY
    try:
        doc = _json(path.read_bytes(), 'card retirement registry')
    except OSError as exc:
        raise CardRetirementError(f'cannot read required card retirement registry: {path}') from exc
    if not isinstance(doc, dict) or doc.get('schema') != 'hiraia.card-retirements/v1':
        raise CardRetirementError('unsupported card retirement registry schema')
    entries = doc.get('retirements')
    if not isinstance(entries, list) or not entries:
        raise CardRetirementError('card retirement registry must contain its historical retirements')
    result = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise CardRetirementError('invalid card retirement record')
        cid = entry.get('card_id')
        if not isinstance(cid, str) or not _CARD_ID.fullmatch(cid):
            raise CardRetirementError('invalid retired card ID')
        if cid in result:
            raise CardRetirementError(f'duplicate retired card ID in registry: {cid}')
        if (not isinstance(entry.get('fact_id'), str) or not entry['fact_id'] or
                not isinstance(entry.get('original_english_sha256'), str) or
                not _SHA256.fullmatch(entry['original_english_sha256'])):
            raise CardRetirementError(f'invalid retired identity pin: {cid}')
        original = _pinned_json(path.parent, entry.get('original_card'), 'original card')
        if not isinstance(original, dict):
            raise CardRetirementError(f'original card is not an object: {cid}')
        _check_identity(original, entry)
        tombstone = _pinned_json(path.parent, entry.get('tombstone'), 'retirement tombstone')
        if (not isinstance(tombstone, dict) or
                tombstone.get('schema') != 'hiraia.card-retirement-tombstone/v1' or
                tombstone.get('decision') != 'retired' or
                tombstone.get('scope') != 'all_languages' or
                tombstone.get('id_reuse_forbidden') is not True or
                any(tombstone.get(key) != entry[key] for key in
                    ('card_id', 'fact_id', 'original_english_sha256'))):
            raise CardRetirementError(f'inconsistent retirement tombstone: {cid}')
        result[cid] = entry
    return result


def _partition(cards, retirements):
    if not isinstance(cards, list):
        raise CardRetirementError('card inventory must be a list')
    retained, retired, seen = [], [], set()
    for card in cards:
        cid = card.get('id') if isinstance(card, dict) else None
        if not isinstance(cid, str) or not cid:
            raise CardRetirementError('card inventory contains a missing or invalid ID')
        if cid in seen:
            raise CardRetirementError(f'duplicate card ID in input: {cid}')
        seen.add(cid)
        if cid in retirements:
            _check_identity(card, retirements[cid])
            retired.append(cid)
        else:
            retained.append(card)
    return retained, retired


def exclude_retired_cards(cards, *, retirements=None):
    """Assembly only: return original active objects in order, without mutating inputs."""
    registry = load_retirements() if retirements is None else retirements
    return _partition(cards, registry)[0]


def assert_no_retired_cards(cards, *, retirements=None):
    """Build preflight: reject stale input before any output is opened or removed."""
    registry = load_retirements() if retirements is None else retirements
    _, retired = _partition(cards, registry)
    if retired:
        raise CardRetirementError(
            'retired card(s) remain in the app pool: ' + ', '.join(retired) +
            '; remove them from the reviewed pool before building; '
            'the database build will not silently filter its input')
