#!/usr/bin/env python3
"""Card-fit compression for over-budget factoid language variants -> rag/pipeline/factoid-patches.json.

The feed's notebook page shows at most BUDGET (48) whitespace words of displayed text (the Q hook
plus the body for `qa` format; card-harness.mts flags >48). apply-card-fixes.py's 2026-07 sweep
hand-compressed the 66 variants that were in the pool then; every factoid wired since (the 18,816
engravings, Lane A) was never screened and gen-cards-pool.py applies no length gate. This is the same
instrument as a script: for every non-retired factoid whose displayed text exceeds the budget in ANY
language, ask Fireworks (qwen3.7-plus, the factoid writer) to compress THAT variant only -- same facts,
no new claims, same language, the English variant as the authoritative meaning -- and write the result
into the patch overlay under the ffct id, so assemble-factoids.py applies it on every re-assembly.
Self-verifying: a compression is accepted only if the displayed text is <= TARGET (46) words; failures
are retried with a tighter limit, then reported by id.

Every stream goes through Fireworks (AUP: LIVING_THINGS / body text never enters a Claude context) and
this script prints ids and counts only, never text.

  set -a; . ./.env.local; set +a
  python3 rag/pipeline/fw-compress-factoids.py --dry-run     # scan only: ids + counts
  python3 rag/pipeline/fw-compress-factoids.py               # compress + write the overlay
  # then, in this order (content under existing ids changes, which the assembler refuses by default):
  python3 rag/pipeline/assemble-factoids.py --check <pairs>
  python3 rag/pipeline/assemble-factoids.py --allow-content-change <pairs>
  python3 rag/pipeline/gen-cards-pool.py && python3 rag/pipeline/gen-cards-questions.py
"""
import argparse, json, os, re, sys, threading, time, urllib.error, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

FACTOIDS = 'rag/bank/factoids.jsonl'
PATCHES = 'rag/pipeline/factoid-patches.json'
MODEL = 'accounts/fireworks/models/qwen3p7-plus'           # fw-gen-factoids.py's writer
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
BUDGET = 48          # card-harness.mts long-factoid threshold (displayed words)
TARGET = 46          # apply-card-fixes.py acceptance
LIMITS = (40, 36, 32)  # asked-for ceiling per round: the model overshoots, so ask under the target
PER_CALL = 8
CONC = int(os.environ.get('FW_CONC', '8'))
LANG_NAME = {'tl': 'Tagalog', 'bis': 'Bisaya/Cebuano', 'en': 'English'}


def words(s):
    return len(re.findall(r'\S+', s or ''))


def display(fo, lang):
    body = (fo['text'].get(lang) or '').strip()
    q = ((fo.get('q') or {}).get(lang) or '').strip() if fo.get('format') == 'qa' else ''
    return f'{q}\n\n{body}' if q and body else body


def over_budget(rows):
    """[(row, lang)] for every displayed variant above BUDGET, bank order."""
    out = []
    for fo in rows:
        if fo.get('retired'):
            continue
        for lang in ('tl', 'en', 'bis'):
            if words(display(fo, lang)) > BUDGET:
                out.append((fo, lang))
    return out


def call(prompt, key, attempt=0):
    body = json.dumps({'model': MODEL, 'temperature': 0.3, 'max_tokens': 16000,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300))
        m = r['choices'][0]['message']
        u = r.get('usage', {})
        return m.get('content') or '', m.get('reasoning_content') or '', u.get('prompt_tokens', 0), u.get('completion_tokens', 0)
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 6:
            ra = e.headers.get('Retry-After')
            time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
            return call(prompt, key, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(prompt, key, attempt + 1)
        raise


def arr_from(content, reasoning):
    for c in (content, reasoning):
        s = (c or '').strip()
        a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except Exception:
                pass
    return None


def prompt_for(items, limit):
    lines = []
    for i, (fo, lang) in enumerate(items):
        q = (fo.get('q') or {}) if fo.get('format') == 'qa' else {}
        lines.append(json.dumps({
            'i': i, 'id': fo['id'], 'lang': lang, 'language': LANG_NAME[lang], 'format': fo.get('format', 'straight'),
            'q': (q.get(lang) or '').strip(), 'text': fo['text'].get(lang, ''),
            'english_q': (q.get('en') or '').strip(), 'english_text': fo['text'].get('en', ''),
        }, ensure_ascii=False))
    return f'''You compress science feed cards for Filipino grade-5 (10-year-old) kids so they fit a small notebook page. Each input item is ONE language variant of a card ("lang": tl = Tagalog, bis = Bisaya/Cebuano, en = English) that is too long, plus the English version as the authoritative meaning.

Rewrite ONLY that language variant so that the question and the body TOGETHER are at most {limit} words (whitespace-separated). Rules:
- Keep every fact, number and name; drop only filler and repetition. Add NOTHING new (HARD RULE).
- Same language as the input variant, same warm kid-friendly voice; keep scientific/English key terms as the input does.
- If format is "qa": keep a short question in "q" and answer it in "text". If format is "straight": "q" must be "".

INPUT ITEMS (one JSON per line):
{chr(10).join(lines)}

Output ONLY a JSON array, one object per input item, same order:
{{"i":0,"id":"ffct-…","lang":"tl","q":"…","text":"…"}}'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='scan and report only; no API calls, no write')
    ap.add_argument('--factoids', default=FACTOIDS)
    ap.add_argument('--patches', default=PATCHES)
    a = ap.parse_args()

    rows = [json.loads(l) for l in open(a.factoids, encoding='utf-8') if l.strip()]
    todo = over_budget(rows)
    ids = sorted({fo['id'] for fo, _ in todo})
    print(f'scanned {len(rows)} factoids: {len(ids)} over {BUDGET} displayed words in some language, {len(todo)} variants')
    print('  by domain:', dict(Counter(fo['domain'] for fo, _ in todo if True)), '| by lang:', dict(Counter(l for _, l in todo)),
          '| max words:', max((words(display(fo, l)) for fo, l in todo), default=0))
    print('  ids:', ' '.join(ids))
    if a.dry_run or not todo:
        return 0
    key = os.environ.get('FIREWORKS_API_KEY')
    if not key:
        raise SystemExit('FIREWORKS_API_KEY missing — set -a; . ./.env.local; set +a')

    stats = Counter()
    lock = threading.Lock()
    accepted = {}                                       # (id, lang) -> {'q': .., 'text': ..}

    def do_call(items, limit):
        try:
            c, rc, pin, pout = call(prompt_for(items, limit), key)
        except Exception as e:
            with lock:
                stats['failed_calls'] += 1
            print(f'  FAIL call: {type(e).__name__}', flush=True)
            return
        got = {o.get('i'): o for o in (arr_from(c, rc) or []) if isinstance(o, dict)}
        with lock:
            stats['in'] += pin
            stats['out'] += pout
            stats['calls'] += 1
            for i, (fo, lang) in enumerate(items):
                o = got.get(i) or {}
                q = str(o.get('q') or '').strip() if fo.get('format') == 'qa' else ''
                text = str(o.get('text') or '').strip()
                shown = f'{q}\n\n{text}' if q and text else text
                if not text or o.get('lang', lang) != lang or (fo.get('format') == 'qa' and not q) or words(shown) > TARGET:
                    stats['rejected'] += 1
                    continue
                accepted[(fo['id'], lang)] = {'q': q, 'text': text}

    pending = list(todo)
    for limit in LIMITS:
        if not pending:
            break
        batches = [pending[i:i + PER_CALL] for i in range(0, len(pending), PER_CALL)]
        print(f'round (ask <= {limit} words): {len(pending)} variants in {len(batches)} calls', flush=True)
        with ThreadPoolExecutor(max_workers=CONC) as ex:
            for _ in as_completed([ex.submit(do_call, b, limit) for b in batches]):
                pass
        pending = [(fo, l) for fo, l in pending if (fo['id'], l) not in accepted]
        print(f'  accepted so far {len(accepted)}/{len(todo)}; still over: {len(pending)}', flush=True)
    still = sorted({f'{fo["id"]}:{l}' for fo, l in pending})

    d = json.load(open(a.patches, encoding='utf-8'))
    P = d['patches']
    for (i, lang), v in accepted.items():
        p = P.setdefault(i, {})
        p.setdefault('text', {})[lang] = v['text']
        if v['q']:
            p.setdefault('q', {})[lang] = v['q']
    P = {k: P[k] for k in sorted(P)}
    d['patches'] = P
    note = (f' 2026-08 card-fit sweep (fw-compress-factoids.py, qwen3.7-plus, <={TARGET} displayed words, same facts) covers the '
            f'{len(ids)} factoids the engraving wiring exposed.')
    if 'fw-compress-factoids.py' not in d.get('scheme', ''):
        d['scheme'] = d.get('scheme', '') + note
    tmp = a.patches + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
        f.write('\n')
    os.replace(tmp, a.patches)
    cost = stats['in'] / 1e6 * 0.22 + stats['out'] / 1e6 * 0.88
    print(f'accepted {len(accepted)}/{len(todo)} variants ({len({i for i, _ in accepted})} factoids) -> {a.patches} ({len(P)} patched ids); '
          f'rejected {stats["rejected"]} (retried); still over budget: {len(still)} {still[:20]}')
    print(f'fireworks: {stats["calls"]} calls (failed {stats["failed_calls"]}) | tokens in/out {stats["in"]:,}/{stats["out"]:,} | est cost ~${cost:.2f}')
    return 1 if still else 0


if __name__ == '__main__':
    sys.exit(main())
