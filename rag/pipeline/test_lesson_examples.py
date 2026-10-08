"""Adversarial controls for inherited and newly selected reading examples."""
import copy
import unittest
from lesson_examples import copy_digest, digest, validate_examples


class ExampleGuards(unittest.TestCase):
    def setUp(self):
        self.card = dict(id='c', factId='f', fact={l: 'Ice melts.' for l in ('en', 'tl', 'bis')},
                         title={l: 'Ice' for l in ('en', 'tl', 'bis')}, cats=['state'])
        self.review = dict(schema=1, relatedCardIds={'g5:heat': ['c']}, cards={
            'c': dict(factId='f', copySha256=copy_digest(self.card), reviewedFor={
                'g5:heat': dict(kind='full-copy-review', reviewedAt='2026-10-08', reason='Melting example')})})
        self.lessons = {'g5:heat': dict(codes=['G5-M-6'], excludedCardIds=[], enrichment=[])}
        self.tags = {'c': ['G5-M-6', 5, 1, 1, [], ['G5-M-6']]}
        self.exclusions = {}
        self.overrides = {'f': dict(id='c', disposition='correct', notes='Evidence: review')}
        self.sources = {}
        self.superseded = set()

    def validate(self):
        return validate_examples(self.review, {'c': self.card}, self.lessons, self.tags, {'c'},
                                 self.exclusions, self.overrides, self.sources.__getitem__, self.superseded)

    def inherit(self):
        text = copy.deepcopy(self.card['fact'])
        self.sources = {
            'packet': {'c': dict(factId='f', copy=text, textHash=digest(text))},
            'review': {'c': dict(factId='f', disposition='recover_core', translationsChecked=True,
                                 textHash=digest(text), codes=['G5-M-6'], evidence=[dict(lesson='g5:heat')])}}
        self.review['cards']['c']['reviewedFor']['g5:heat'] = dict(
            kind='manual-recovery', reviewFile='review', packetFile='packet', reason='Prior manual approval')

    def test_full_copy_and_inherited_approval_are_accepted(self):
        self.assertEqual(self.validate(), {'g5:heat': ['c']})
        self.inherit()
        self.validate()

    def test_changed_text_or_title_in_any_language_is_rejected(self):
        original = copy.deepcopy(self.card)
        for field in ('fact', 'title'):
            for lang in ('en', 'tl', 'bis'):
                self.card = copy.deepcopy(original)
                self.card[field][lang] = 'Unreviewed replacement'
                with self.assertRaisesRegex(AssertionError, 'Changed example copy'):
                    self.validate()

    def test_changed_source_identity_is_rejected(self):
        self.card['factId'] = 'other'
        with self.assertRaisesRegex(AssertionError, 'identity'):
            self.validate()

    def test_global_or_grade_exclusion_is_respected(self):
        self.exclusions['f'] = 'scientific hold'
        with self.assertRaisesRegex(AssertionError, 'excluded'):
            self.validate()
        self.exclusions.clear()
        self.lessons['g5:heat']['excludedCardIds'] = ['c']
        with self.assertRaisesRegex(AssertionError, 'Grade-excluded'):
            self.validate()

    def test_another_lesson_cannot_borrow_an_approval(self):
        self.review['relatedCardIds'] = {'g5:other': ['c']}
        self.lessons['g5:other'] = self.lessons['g5:heat']
        with self.assertRaisesRegex(AssertionError, 'lesson evidence mismatch'):
            self.validate()

    def test_revoked_recovery_or_changed_prior_packet_is_rejected(self):
        self.inherit()
        self.sources['review']['c']['disposition'] = 'hold'
        with self.assertRaises(AssertionError):
            self.validate()
        self.inherit()
        self.sources['packet']['c']['copy']['en'] = 'Forged approval'
        with self.assertRaises(AssertionError):
            self.validate()

    def test_repinning_current_copy_does_not_forge_old_english_approval(self):
        self.inherit()
        self.card['fact']['en'] = 'Ice always melts at any temperature.'
        self.review['cards']['c']['copySha256'] = copy_digest(self.card)
        with self.assertRaisesRegex(AssertionError, 'Inherited English changed'):
            self.validate()

    def test_current_override_must_still_point_to_the_review(self):
        self.inherit()
        self.overrides['f']['notes'] = 'Evidence: newer-review'
        with self.assertRaisesRegex(AssertionError, 'superseded'):
            self.validate()

    def test_tags_and_category_cannot_alone_admit_examples(self):
        del self.review['cards']['c']
        with self.assertRaisesRegex(AssertionError, 'evidence/membership'):
            self.validate()

    def test_later_core_nonselection_blocks_older_recovery_evidence(self):
        self.inherit()
        self.superseded.add('c')
        with self.assertRaisesRegex(AssertionError, 'Newer core review rejected'):
            self.validate()

    def test_rejected_additional_copy_cannot_leak_through_another_approval(self):
        self.review['notAdmitted'] = [dict(id='c', reason='Incorrect science')]
        with self.assertRaisesRegex(AssertionError, 'Rejected additional copy'):
            self.validate()

    def test_current_copy_decision_binds_disposition_language_and_exact_lesson(self):
        proof = self.review['cards']['c']['reviewedFor']['g5:heat']
        proof['decisionFile'] = 'fresh-review'
        decision = dict(decision='accept', copySha256=copy_digest(self.card),
                        checkedLanguages=['en', 'tl', 'bis'], reviewedFor={'g5:heat': proof['reason']})
        self.sources['fresh-review'] = {'c': decision}
        self.validate()
        for field, bad in [('decision', 'hold'), ('copySha256', 'wrong'),
                           ('checkedLanguages', ['en']), ('reviewedFor', {'g5:other': proof['reason']})]:
            self.sources['fresh-review']['c'] = dict(decision, **{field: bad})
            with self.subTest(field=field), self.assertRaises(AssertionError):
                self.validate()


if __name__ == '__main__':
    unittest.main()
