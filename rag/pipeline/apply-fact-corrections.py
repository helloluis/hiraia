#!/usr/bin/env python3
"""Apply the adjudicated fact corrections to science-facts.jsonl. Conservative:
 - apply only CLEAR errors (gpt-oss "wrong", or qwen-wrong + gpt-oss-misleading);
 - CONCEPTUAL clear-errors -> use gpt-oss's corrected sentence (model-agreed, safe);
 - NUMERIC clear-errors -> use a WEB-verified correction if we have one, else QUARANTINE
   (keep original text, mark unverified, exclude from future quiz gen) — never blind-fix a number;
 - web-CONFIRMED-correct facts (e.g. Emden 2021) -> mark reviewed:true, no change;
 - oversimplifications (gpt-oss "misleading" only) and false flags -> leave untouched.
Backs up first; writes a change-log + lists of changed/quarantined factIds.
"""
import os, json, re, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, '..', 'bank', 'science-facts.jsonl')

# WEB-verified corrections (substring of original -> new english, all mark reviewed:true)
WEB_FIXES = [
    ('deepest-diving mammal', "The Cuvier's beaked whale is the deepest-diving mammal, recorded diving close to 3,000 meters — far deeper than the sperm whale."),
    ('steel at about 5,000 meters per second', "Sound travels very fast through solids like steel — about 5,960 meters per second — and even faster through diamond."),
    ('La Nina is officially declared', "La Niña is officially declared when the central Pacific sea surface temperature stays 0.5°C or more below average for about five consecutive months."),
    ('Signal No. 5 was added in 2022 for super typhoons with winds over 220', "PAGASA's Tropical Cyclone Wind Signal No. 5, for super typhoons, is raised for winds of at least 185 km/h — PAGASA lowered this threshold from 220 km/h in 2022."),
]
WEB_CONFIRMED_OK = ['Emden Deep', '2021']  # original was right; just mark reviewed

def numericish(orig, corr, reason, note):
    txt = (orig + ' ' + corr + ' ' + reason + ' ' + note).lower()
    return bool(re.search(r'\b(19|20)\d{2}\b', txt) or re.search(r'\d+\s?(km|m/s|°|kelvin|kph|km/h|percent|%|meters|kg|years|months|days|species|°c|°f|m\b)', txt)
                or re.search(r'\bnot\b.*\d', reason.lower()))

facts = {json.loads(l)['id']: json.loads(l) for l in open(BANK)}
adj = [json.loads(l) for l in open(os.path.join(HERE, 'flagged-facts-adjudicated.jsonl'))]

changed, quarantined, webfixed, reviewed_ok = [], [], [], []
for r in adj:
    fid = r['factId']
    if fid not in facts:
        continue
    g = r['gptoss_judgment']; qv = r['qwen_verdict']
    orig = facts[fid]['fact'].get('en', '')
    # WEB-verified overrides apply UNCONDITIONALLY (I checked these against sources,
    # so they beat both model judgments — e.g. PAGASA, which gpt-oss wrongly called "fine").
    if all(k in orig for k in WEB_CONFIRMED_OK):
        facts[fid]['reviewed'] = True; reviewed_ok.append(fid); continue
    wf = next((new for sub, new in WEB_FIXES if sub in orig), None)
    if wf:
        facts[fid]['fact']['en'] = wf; facts[fid]['fact']['tl'] = ''; facts[fid]['fact']['bis'] = ''
        facts[fid]['reviewed'] = True; facts[fid]['_retranslate'] = True
        webfixed.append((fid, orig, wf)); continue
    # everything else: only act on CLEAR errors
    clear_error = (g == 'wrong') or (qv == 'wrong' and g == 'misleading')
    if not clear_error:
        continue
    if numericish(orig, r['corrected'], r['qwen_reason'], r['note']):
        # numeric clear-error we did NOT web-verify -> quarantine, do not touch text
        facts[fid]['unverified'] = True; quarantined.append(fid); continue
    # conceptual clear-error -> apply gpt-oss correction
    if r['corrected']:
        facts[fid]['fact']['en'] = r['corrected']; facts[fid]['fact']['tl'] = ''; facts[fid]['fact']['bis'] = ''
        facts[fid]['_retranslate'] = True
        changed.append((fid, orig, r['corrected']))

shutil.copy(BANK, BANK + '.pre-correction.bak')
with open(BANK, 'w') as f:
    for fid, fc in facts.items():
        f.write(json.dumps(fc, ensure_ascii=False) + '\n')

# change-log
log = os.path.join(HERE, 'fact-correction-changelog.md')
with open(log, 'w') as f:
    f.write(f'# Fact correction change-log\n\n')
    f.write(f'- conceptual corrections applied: **{len(changed)}**\n')
    f.write(f'- web-verified numeric fixes: **{len(webfixed)}**\n')
    f.write(f'- web-confirmed correct (kept, marked reviewed): **{len(reviewed_ok)}**\n')
    f.write(f'- numeric quarantined (text kept, excluded from quiz pending source check): **{len(quarantined)}**\n\n')
    f.write('## Web-verified numeric fixes\n')
    for fid, o, n in webfixed:
        f.write(f'- `{fid}`\n  - was: {o}\n  - now: {n}\n')
    f.write('\n## Conceptual corrections (sample of 30)\n')
    for fid, o, n in changed[:30]:
        f.write(f'- `{fid}`\n  - was: {o[:160]}\n  - now: {n[:160]}\n')

# factIds whose en CHANGED -> their quiz questions are now stale
stale_quiz_factids = set(f[0] for f in changed) | set(f[0] for f in webfixed)
with open(os.path.join(HERE, 'facts-changed-retranslate.txt'), 'w') as f:
    f.write('\n'.join(sorted(stale_quiz_factids)) + '\n')
with open(os.path.join(HERE, 'facts-quarantined.txt'), 'w') as f:
    f.write('\n'.join(sorted(quarantined)) + '\n')

print(f'conceptual fixed {len(changed)} | web-fixed {len(webfixed)} | web-ok {len(reviewed_ok)} | quarantined {len(quarantined)}')
print(f'facts whose en changed (need re-translate + quiz regen): {len(stale_quiz_factids)}')
print(f'backed up -> {os.path.basename(BANK)}.pre-correction.bak ; changelog -> {os.path.basename(log)}')
