#!/usr/bin/env python3
"""Validate and render offline assessment authoring records; never edit a bank."""
import argparse
import copy
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUTHORING = ROOT / 'rag/assessment-authoring'
LANGS = ('en', 'tl', 'bis')
STATUSES = {'draft', 'source_checked', 'language_checked', 'ready_for_pilot', 'hold', 'retired'}


def duplicates(values):
    # Do not collapse operators, decimal points, letter case, units or punctuation.
    return [value for value, count in Counter(values).items() if count > 1]


def load_context(batch):
    raw = {key: (ROOT / source['path']).read_bytes() for key, source in batch['source_files'].items()}
    bank = {q['factId']: q for q in map(json.loads, raw['bank'].splitlines())}
    cards = {c['id']: c for c in json.loads(raw['cards'])['cards']}
    curriculum = json.loads(raw['curriculum'])
    codes = {c['code']: dict(c, grade=q['grade'], domain=q['domain'])
             for q in curriculum['quarters'] for c in q['competencies']}
    ledger = json.loads((AUTHORING / 'targets.json').read_text())
    targets = {t['id']: t for t in ledger['targets']}
    subcategories = {r['id']: r for r in csv.DictReader(raw['subcategory_inventory'].decode().splitlines())}
    return dict(raw=raw, bank=bank, cards=cards, codes=codes, ledger=ledger, targets=targets, subcategories=subcategories)


def validate_teaching_links(item, ctx, require):
    """Check traceable link evidence, not the author's semantic judgment itself."""
    item_id = item['id']
    for source in [item['provenance']['primary'], *item['provenance'].get('additional_teaching_cards', [])]:
        if 'teaching_link_hold' in source:
            hold = source['teaching_link_hold']
            require(isinstance(hold, dict) and all(isinstance(hold.get(key), str) and hold[key].strip()
                    for key in ('reason', 'review_receipt')), f'{item_id}: malformed teaching-link hold')
    primary_ids = item['provenance']['primary']['card_ids']
    links = item['provenance'].get('additional_teaching_cards', [])
    extra_ids = [link.get('card_id') for link in links]
    require(not duplicates(extra_ids), f'{item_id}: duplicate additional teaching links')
    require(not set(extra_ids) & set(primary_ids), f'{item_id}: redundant primary teaching link')
    expected = set(primary_ids) | set(extra_ids)
    recent = item['eligibility']['recent_learning']
    require(recent.get('window_days') == 14, f'{item_id}: unexpected recent exposure window')
    actual_ids = recent.get('source_card_ids', [])
    require(not duplicates(actual_ids), f'{item_id}: duplicate recent card IDs')
    require(set(actual_ids) == expected, f'{item_id}: recent cards lack matching reviewed provenance')
    for link in links:
        card_id = link.get('card_id')
        card = ctx['cards'].get(card_id)
        require(card is not None, f'{item_id}: unknown additional teaching card {card_id}')
        if card:
            require(link.get('fact_id') == card['factId'] and link.get('fact') == card['fact'],
                    f'{item_id}: additional teaching snapshot mismatch: {card_id}')
        require(link.get('knowledge_claim') == item['scope']['knowledge_claim'],
                f'{item_id}: teaching link claim mismatch: {card_id}')
        require(link.get('knowledge_family_id') == item['relationships']['knowledge_family_id'],
                f'{item_id}: teaching link family mismatch: {card_id}')
        require(link.get('review_status') == 'author_source_checked' and link.get('independent') is False,
                f'{item_id}: unsupported teaching link approval: {card_id}')
        require(link.get('reviewed_languages') == list(LANGS),
                f'{item_id}: incomplete teaching link languages: {card_id}')
        require(bool(link.get('conditions_note', '').strip()),
                f'{item_id}: missing teaching link conditions review: {card_id}')
        method = link.get('review_method')
        require(method in ('manual_same_claim_check', 'exact_primary_text_match'),
                f'{item_id}: unknown teaching link review method: {card_id}')
        if method == 'exact_primary_text_match':
            require(link.get('fact') == item['provenance']['primary']['fact'],
                    f'{item_id}: false exact teaching-text match: {card_id}')
        for lang in LANGS:
            excerpt = link.get('support', {}).get(lang)
            require(isinstance(excerpt, str) and bool(excerpt.strip()) and card is not None
                    and excerpt in card['fact'][lang],
                    f'{item_id}: unsupported {lang} teaching excerpt: {card_id}')


def validate(batch, ctx):
    errors, warnings = [], []

    def require(condition, message):
        if not condition:
            errors.append(message)

    for key, source in batch['source_files'].items():
        require(hashlib.sha256(ctx['raw'][key]).hexdigest() == source['sha256'], f'source hash changed: {key}')
    require(bool(batch.get('items')), 'batch has no items')
    require(not duplicates([i['id'] for i in batch['items']]), 'duplicate item IDs')
    for lang in LANGS:
        require(not duplicates([i['content']['stem'].get(lang, '') for i in batch['items']]), f'duplicate {lang} stems within batch')
    for item in batch['items']:
        item_id = item['id']
        for key in ('revision', 'batch_id', 'origin', 'status', 'scope', 'eligibility', 'uses',
                    'relationships', 'provenance', 'content', 'rationale', 'demand', 'review'):
            require(key in item, f'{item_id}: missing {key}')
        require(item.get('revision', 0) >= 1, f'{item_id}: invalid revision')
        require(item.get('batch_id') == batch['batch_id'], f'{item_id}: wrong batch ID')
        require(item.get('status') in STATUSES, f'{item_id}: invalid status')
        require(item.get('origin') in {'reuse', 'revise', 'new', 'alternate'}, f'{item_id}: invalid origin')
        if errors and any(f'{item_id}: missing' in e for e in errors):
            continue
        content = item['content']
        options = content['options']
        ids = [o['id'] for o in options]
        require(len(options) == 3 and len(set(ids)) == 3, f'{item_id}: expected three unique option IDs')
        require(content['correct_option_id'] in ids, f'{item_id}: invalid answer key')
        wrong_ids = set(ids) - {content['correct_option_id']}
        require(set(item['rationale']['distractors']) == wrong_ids, f'{item_id}: distractor rationales do not match wrong options')
        for lang in LANGS:
            texts = [content['stem'].get(lang), content['explanation'].get(lang)] + [o['text'].get(lang) for o in options]
            require(all(isinstance(t, str) and t.strip() for t in texts), f'{item_id}: missing/empty {lang} text')
            option_texts = [o['text'].get(lang, '') for o in options]
            require(not duplicates(option_texts), f'{item_id}: duplicate {lang} options')
        scope = item['scope']
        subcategory = ctx['subcategories'].get(scope['subcategory_id'])
        require(subcategory is not None, f'{item_id}: unknown subcategory')
        if subcategory:
            require(int(subcategory['grade']) == scope['material_grade'] and subcategory['domain'] == scope['domain'], f'{item_id}: subcategory grade/domain mismatch')
        code = ctx['codes'].get(scope['internal_competency_code'])
        require(code is not None, f'{item_id}: unknown curriculum code')
        if code:
            require(code['grade'] == scope['material_grade'] and code['domain'] == scope['domain'], f'{item_id}: curriculum grade/domain mismatch')
            require(code['text'] == scope['internal_competency_text'], f'{item_id}: curriculum text mismatch')
        target = ctx['targets'].get(scope['target_id'])
        require(target is not None, f'{item_id}: unknown target ID')
        if target:
            require(item_id in target['selected_draft_item_ids'], f'{item_id}: absent from target ledger')
            for field in ('subcategory_id', 'internal_competency_code', 'material_grade', 'domain', 'knowledge_claim'):
                require(scope[field] == target[field], f'{item_id}: ledger mismatch: {field}')
        for source in [item['provenance']['primary']] + item['provenance']['related']:
            require(bool(source['card_ids']), f'{item_id}: no source card')
            for card_id in source['card_ids']:
                card = ctx['cards'].get(card_id)
                require(card is not None and card.get('factId') == source['fact_id'], f'{item_id}: invalid source card {card_id}')
                if card:
                    require(card['fact'] == source['fact'], f'{item_id}: source card has a different text snapshot: {card_id}')
            first = ctx['cards'].get(source['card_ids'][0]) if source['card_ids'] else None
            if first:
                require(first['fact'] == source['fact'], f'{item_id}: fact snapshot differs from source')
            question_fact_id = source.get('bank_fact_id', source['fact_id'])
            require(ctx['bank'].get(question_fact_id) == source['bank_question'], f'{item_id}: bank snapshot differs from source')
        validate_teaching_links(item, ctx, require)
        for reference in item['provenance']['external_reference_ids']:
            require(reference in batch['references'], f'{item_id}: missing external reference {reference}')
        q = item['provenance']['primary']['bank_question']
        if item['origin'] == 'reuse':
            require(q is not None, f'{item_id}: reuse without source question')
            if q:
                unchanged = (content['stem'] == q['q'] and [o['text'] for o in options] == q['options']
                             and content['explanation'] == q['explanation']
                             and content['correct_option_id'] == f'o{q["answer"]+1}')
                require(unchanged, f'{item_id}: reuse label on modified content')
        require(item['eligibility']['current_grade']['calendar_alone_sufficient'] is False, f'{item_id}: calendar treated as coverage')
        require(item['eligibility']['prior_grade_readiness'].get('requires_school_year_curriculum_match') is True, f'{item_id}: prior-grade curriculum match omitted')
        require(item['review']['reviewer']['independent'] is False, f'{item_id}: self-review labelled independent')
        for hold in item['review']['holds']:
            require(item['status'] == 'hold', f'{item_id}: unresolved hold without hold status')
            warnings.append(dict(item_id=item_id, kind='hold', detail=hold))
        if item.get('production_ready') or item['status'] == 'ready_for_pilot':
            require(not item['review']['holds'], f'{item_id}: readiness conflicts with unresolved hold')
            require(bool(item['review'].get('teacher_review')), f'{item_id}: no teacher review for readiness')
            require(all(r['status'] != 'draft_pending_language_review' for r in item['review']['languages'].values()), f'{item_id}: draft languages marked ready')
        require(bool(item['relationships']['knowledge_family_id']) and bool(item['relationships']['form_family_id']), f'{item_id}: missing family IDs')
    return errors, warnings


def control_checks(batch, ctx):
    cases = [
        ('missing translation', lambda d: d['items'][0]['content']['stem'].pop('bis'), 'missing/empty bis text'),
        ('empty explanation', lambda d: d['items'][0]['content']['explanation'].__setitem__('tl', ''), 'missing/empty tl text'),
        ('duplicate options', lambda d: d['items'][0]['content']['options'][1]['text'].__setitem__('en', d['items'][0]['content']['options'][0]['text']['en']), 'duplicate en options'),
        ('bad answer key', lambda d: d['items'][0]['content'].__setitem__('correct_option_id', 'absent'), 'invalid answer key'),
        ('unknown source card', lambda d: d['items'][0]['provenance']['primary']['card_ids'].__setitem__(0, 'nonexistent-control'), 'invalid source card'),
        ('unknown curriculum', lambda d: d['items'][0]['scope'].__setitem__('internal_competency_code', 'G3-INVALID'), 'unknown curriculum code'),
        ('unknown target', lambda d: d['items'][0]['scope'].__setitem__('target_id', 'nonexistent-control'), 'unknown target ID'),
        ('unknown subcategory', lambda d: d['items'][0]['scope'].__setitem__('subcategory_id', 'nonexistent-control'), 'unknown subcategory'),
        ('changed reuse', lambda d: (d['items'][0].__setitem__('origin', 'reuse'), d['items'][0]['content']['stem'].__setitem__('en', 'Changed control question?')), 'reuse'),
        ('unreviewed readiness', lambda d: (d['items'][0].__setitem__('status', 'ready_for_pilot'), d['items'][0]['review']['languages']['bis'].__setitem__('status', 'draft_pending_language_review')), 'draft languages marked ready'),
        ('false coverage', lambda d: d['items'][0]['eligibility']['current_grade'].__setitem__('calendar_alone_sufficient', True), 'calendar treated as coverage'),
        ('unreviewed recent card', lambda d: d['items'][0]['eligibility']['recent_learning']['source_card_ids'].append('unreviewed-control'), 'recent cards lack matching reviewed provenance'),
        ('wrong exposure window', lambda d: d['items'][0]['eligibility']['recent_learning'].__setitem__('window_days', 28), 'unexpected recent exposure window'),
    ]
    results = []
    for label, mutation, expected in cases:
        changed = copy.deepcopy(batch)
        mutation(changed)
        errors, _ = validate(changed, ctx)
        results.append(dict(control=label, passed=any(expected in e for e in errors)))
    # Synthetic metadata controls only. These never assert that another card
    # actually teaches this claim and are never written into the authoring bank.
    def link_control(mutation):
        changed = copy.deepcopy(batch)
        item = changed['items'][0]
        used = set(item['eligibility']['recent_learning']['source_card_ids'])
        card = next(c for cid, c in ctx['cards'].items() if cid not in used
                    and c['fact'] != item['provenance']['primary']['fact']
                    and all(isinstance(c['fact'].get(lang), str) and c['fact'][lang].strip() for lang in LANGS))
        link = dict(card_id=card['id'], fact_id=card['factId'], fact=copy.deepcopy(card['fact']),
                    knowledge_claim=item['scope']['knowledge_claim'],
                    knowledge_family_id=item['relationships']['knowledge_family_id'],
                    review_status='author_source_checked', independent=False,
                    reviewed_languages=list(LANGS), review_method='manual_same_claim_check',
                    support=copy.deepcopy(card['fact']),
                    conditions_note='Synthetic schema-control fixture; not a real semantic review.')
        item['provenance'].setdefault('additional_teaching_cards', []).append(link)
        item['eligibility']['recent_learning']['source_card_ids'].append(card['id'])
        mutation(link)
        return validate(changed, ctx)[0]

    link_cases = [
        ('stale additional teaching text', lambda l: l['fact'].__setitem__('tl', 'Changed control text'), 'additional teaching snapshot mismatch'),
        ('wrong additional teaching claim', lambda l: l.__setitem__('knowledge_claim', 'Another claim'), 'teaching link claim mismatch'),
        ('wrong additional teaching family', lambda l: l.__setitem__('knowledge_family_id', 'Another family'), 'teaching link family mismatch'),
        ('unreviewed teaching language', lambda l: l.__setitem__('reviewed_languages', ['en', 'tl']), 'incomplete teaching link languages'),
        ('invented teaching excerpt', lambda l: l['support'].__setitem__('bis', 'INVENTED-CONTROL-EXCERPT'), 'unsupported bis teaching excerpt'),
        ('false exact-text proof', lambda l: l.__setitem__('review_method', 'exact_primary_text_match'), 'false exact teaching-text match'),
        ('false independent link review', lambda l: l.__setitem__('independent', True), 'unsupported teaching link approval'),
    ]
    for label, mutation, expected in link_cases:
        results.append(dict(control=label, passed=any(expected in e for e in link_control(mutation))))
    for a, b in [('2 × 3', '2 + 3'), ('9.8 cm', '98 cm'), ('cm', 'cM'), ('π', 'α')]:
        results.append(dict(control=f'preserve distinction: {a} / {b}', passed=not duplicates([a, b])))
    results.append(dict(control='catch exact duplicate', passed=duplicates(['same', 'same']) == ['same']))
    return results


def text_cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def render_batch(batch, report):
    origins = ', '.join(f'{count} {origin}' for origin, count in report['origin_counts'].items())
    grade = batch['scope']['material_grade']
    readiness_grade = batch['scope'].get('intended_readiness_student_grade')
    readiness = f'incoming Grade {readiness_grade} readiness using Grade {grade} material' if readiness_grade else f'Grade {grade} retention after confirmed coverage'
    coverage = ', '.join(f'{name}: {count}' for name, count in batch['scope']['domain_distribution'].items())
    held = [item['id'] for item in batch['items'] if item['review']['holds']]
    lines = [f'# {batch["title"]}', '',
             f'Drafted in-session; created {batch["created_at"]}. Intended use after review: **{readiness}**.', '',
             '**Authoring sample, not an assembled student assessment.** These items measure specific Hiraia knowledge; they do not establish mastery of an entire curriculum competency.', '',
             f'Coverage: {coverage}.', '',
             f'[Question design plan](../../../docs/ASSESSMENT-QUESTION-DESIGN-PLAN-20260928.md) · [Structured records]({batch["batch_id"]}.json) · [Target ledger](../targets.md)', '',
             f'Origins: {origins}. Mechanical errors: {len(report["errors"])}. Known-bad controls and distinction checks: {sum(c["passed"] for c in report["controls"])}/{len(report["controls"])} passed.', '',
             'English, Tagalog and Cebuano are present for all items. Language checks here are source/corpus-informed self-review, not native-speaker approval. Pilot readiness is recorded per item in the structured file.', '',
             f'Explicit item holds: {", ".join(held) if held else "none in this batch; routine language, curriculum and teacher review is still pending"}.', '',
             'Revisions replace candidate wording and do not add to the new-item count. Alternate forms and new items do not add to a validated pool until their review gates pass. Parallel-form equivalence remains untested.', '',
             '| Item | Origin | English question | Correct answer |', '|---|---|---|---|']
    for item in batch['items']:
        c = item['content']
        answer = next(o['text']['en'] for o in c['options'] if o['id'] == c['correct_option_id'])
        lines.append(f'| {item["id"]} | {item["origin"]} | {text_cell(c["stem"]["en"])} | {text_cell(answer)} |')
    lines += ['', 'Canonical option order is for editing. The eventual app must persist a shuffled presentation order per attempt. Do not treat the displayed answer-position mix as an assessment blueprint.', '',
              '## Review decisions that affect selection', '',
              '- Grade suffixes in source fact IDs are not assessment grade assignments. Each narrow claim has a separate curriculum mapping; teacher confirmation is pending.',
              '- Mappings use the local August 2023 guide extract. Match the applicable published curriculum and learner cohort before enabling a prior-grade route; these drafts do not certify the current school-year mapping.',
              '- Current-grade eligibility requires specific Hiraia exposure or teacher-confirmed coverage. The calendar alone cannot establish eligibility.',
              '- Review equivalent knowledge families and cross-item cues before placing questions together in an actual assessment. Multiple examples of reuse, or several records with the same stem, are not independent competency coverage.',
              '- A revised item must not be served alongside its original as if they were separate knowledge targets.',
              '- A single correct or incorrect answer cannot establish a grade level or persistent weakness.', '']
    lines += [f'- {note}' for note in batch.get('review_notes', [])]
    lines.append('')
    for item in batch['items']:
        c, s, review = item['content'], item['scope'], item['review']
        letters = {o['id']: chr(65+n) for n, o in enumerate(c['options'])}
        source = item['provenance']['primary']
        lines += [f'## {item["id"]} — {s["knowledge_claim"]}', '',
                  f'**Revision / origin / status:** {item["revision"]} / {item["origin"]} / {item["status"]}.', '',
                  f'**Target:** `{s["target_id"]}` · `{s["subcategory_id"]}` · internal `{s["internal_competency_code"]}` (not an official DepEd identifier).', '',
                  f'**Curriculum relationship:** {s["internal_competency_text"]}. This item checks only the narrower claim in the heading.', '',
                  f'**Source:** `{source["fact_id"]}`; cards: {", ".join(f"`{cid}`" for cid in source["card_ids"])}. Bank item version: {source["bank_question"].get("v", 1) if source["bank_question"] else "no bank question for this primary fact"}.', '',
                  f'**Question provenance:** `{source.get("bank_fact_id", source["fact_id"])}` in the newer merged bank. A different card fact ID is an explicit reviewed knowledge link, not an ID substitution.' if source['bank_question'] else '**Question provenance:** newly authored from the linked knowledge sources.', '',
                  f'**Supporting evidence:** {item["provenance"]["supporting_statement"]}', '',
                  f'**Family:** `{item["relationships"]["knowledge_family_id"]}`; form equivalence is unvalidated.', '',
                  f'**Use and eligibility:** {readiness.capitalize()} candidate; recent-learning candidate only after exposure to this knowledge. Supporting recall/recognition, not evidence of completing a practical activity.', '',
                  f'**Correct option:** {letters[c["correct_option_id"]]} (`{c["correct_option_id"]}`).', '']
        for lang, name in [('en', 'English'), ('tl', 'Tagalog'), ('bis', 'Cebuano')]:
            lines += [f'### {name}', '', c['stem'][lang], '']
            lines += [f'- {letters[o["id"]]}: {o["text"][lang]}' for o in c['options']]
            lines += ['', f'**Explanation:** {c["explanation"][lang]}', '']
        lines += ['**Distractor review:**', '']
        lines += [f'- {letters[oid]}: {reason}' for oid, reason in item['rationale']['distractors'].items()]
        lines += ['', f'**Selection decision:** {review["selection_decision"]}', '',
                  f'**Language evidence:** {review["languages"]["bis"]["evidence"]}', '',
                  '**Remaining limits and holds:**', '']
        lines += [f'- {limit}' for limit in review['remaining_limitations']]
        lines += [f'- HOLD ({", ".join(h["languages"])}): {h["reason"]}' for h in review['holds']]
        lines += ['- Teacher, native-language and student-pilot reviews have not occurred.', '']
        for ref_id in item['provenance']['external_reference_ids']:
            ref = batch['references'][ref_id]
            lines += [f'**External check:** [{ref["title"]}]({ref["url"]}) — {ref["support"]} {ref["review"]}', '']
        for link in item['provenance'].get('additional_teaching_cards', []):
            lines += [f'**Additional teaching link:** `{link["card_id"]}` / `{link["fact_id"]}` — '
                      f'{link["conditions_note"]} Method: {link["review_method"]}; author check only.', '']
    lines += ['## Continue from here', '',
              'Keep unresolved holds explicit and continue the authorized inventory and authoring work. Inspect existing candidates target by target before writing additional forms. Review the current work queue in [STATUS.md](../STATUS.md).', '',
              'Use the structured JSON as the editable record, update the revision and provenance on substantive edits, and regenerate this Markdown with the documented command. Do not integrate these drafts into the shipping bank yet.', '']
    return '\n'.join(lines)


def render_ledger(ledger):
    lines = ['# Assessment target ledger', '', ledger['coverage'], '',
             'Selected drafts and pilot-ready forms are tracked separately in the structured ledger. The counts below describe the entire subcategory, not suitable variants of the precise claim. Rotation demand remains unquantified until the blueprint and exposure constraints are simulated.', '',
             '| Target | Narrow knowledge claim | Internal mapping | Selected draft | Broad subcategory stems |', '|---|---|---|---|---|']
    for target in ledger['targets']:
        lines.append(f'| `{target["id"]}` | {text_cell(target["knowledge_claim"])} | `{target["internal_competency_code"]}` | {", ".join(target["selected_draft_item_ids"])} | {target["subcategory_inventory"]["distinct_3_option_english_stems"]} |')
    lines += ['', 'Candidate fact IDs, source stems, search limitations and next actions are recorded in [targets.json](targets.json). This starting ledger does not establish a new generation budget or a complete 335-subcategory inventory.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch', type=Path, default=AUTHORING/'batches/001-grade3-foundations.json')
    parser.add_argument('--render', action='store_true', help='write readable Markdown, target ledger and validation report after checks pass')
    args = parser.parse_args()
    batch = json.loads(args.batch.read_text())
    ctx = load_context(batch)
    errors, warnings = validate(batch, ctx)
    controls = control_checks(batch, ctx)
    errors += [f'control failed: {c["control"]}' for c in controls if not c['passed']]
    length_flags = {}
    for lang in LANGS:
        flagged = []
        for item in batch['items']:
            opts = item['content']['options']
            lengths = {o['id']: len(o['text'].get(lang, '')) for o in opts}
            answer = item['content']['correct_option_id']
            if answer in lengths and all(lengths[answer] > length for oid, length in lengths.items() if oid != answer):
                flagged.append(item['id'])
        length_flags[lang] = flagged
    report = dict(checked_at=datetime.now(timezone.utc).isoformat(timespec='seconds'), batch_id=batch['batch_id'],
                  item_count=len(batch['items']), language_versions=len(batch['items'])*len(LANGS),
                  origin_counts=dict(Counter(i['origin'] for i in batch['items'])),
                  status_counts=dict(Counter(i['status'] for i in batch['items'])),
                  errors=errors, warnings=warnings, controls=controls,
                  sole_longest_correct_options=length_flags,
                  duplicate_policy='Exact Unicode string equality. Semantic checks remain targeted author review.',
                  limitations=['These are mechanical checks, not proof of scientific validity, fluency, difficulty or form equivalence.',
                               'Corpus attestation does not certify a newly authored translation.',
                               'No native-language, teacher or student-pilot review is recorded.'])
    if args.render and not errors:
        args.batch.with_suffix('.md').write_text(render_batch(batch, report))
        args.batch.with_suffix('.validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
        (AUTHORING/'targets.md').write_text(render_ledger(ctx['ledger']))
    print(json.dumps(dict(items=report['item_count'], languages=report['language_versions'], origins=report['origin_counts'],
                          errors=errors, holds=len(warnings), controls_passed=sum(c['passed'] for c in controls),
                          controls_total=len(controls), sole_longest_correct_options=length_flags), ensure_ascii=False, indent=2))
    raise SystemExit(1 if errors else 0)


if __name__ == '__main__':
    main()
