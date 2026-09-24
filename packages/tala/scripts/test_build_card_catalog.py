"""python3 -m unittest discover -s packages/tala/scripts -p 'test_*.py'"""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).with_name('build-card-catalog.py'))
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)

CARDS_TS = """
const TITLE_MINOR = new Set(
  (
    'a an and of the ' +
    // Tagalog / Cebuano particles and linkers
    'mga ng ug'
  ).split(' ')
);
"""

SUPPLEMENT_TS = """
import grade4 from './grade4LessonSupplement.json';
import grade3 from './grade3LessonSupplement.json';
export const supplement = {
  cards: [...grade3.cards, ...grade4.cards],
  questions: { ...grade3.questions, ...grade4.questions },
};
"""


def index(cards, taxonomy, questions=(), version='v1'):
    return {'taxonomy': [{'id': t, 'parent': None, 'label_en': label, 'label_tl': '', 'label_bis': ''}
                         for t, label in taxonomy],
            'cards': [{'id': i, 'factId': f, 'cats': cats} for i, f, cats in cards],
            'questionFactIds': list(questions), 'dbVersion': version}


def records(text):
    rows = [l.split('\t') for l in text.splitlines() if l and not l.startswith('#')]
    order = [r[1] for r in rows if r[0] == 'T']
    return ({r[1]: r[2] for r in rows if r[0] == 'T'},
            {r[1]: [order[int(i)] for i in r[2].split(',')] for r in rows if r[0] == 'C'},
            {r[1]: [order[int(i)] for i in r[2].split(',')] for r in rows if r[0] == 'F'})


class TitleCaseTests(unittest.TestCase):
    minor = catalog.title_minor(CARDS_TS)

    def test_reads_the_minor_words_out_of_cards_ts(self):
        self.assertEqual(self.minor, {'a', 'an', 'and', 'of', 'the', 'mga', 'ng', 'ug'})

    def test_matches_the_student_apps_pill_casing(self):
        cases = {
            'states of matter': 'States of Matter',
            'the moon and the sun': 'The Moon and the Sun',   # first word always capitalised
            'things we are made of': 'Things We Are Made Of',  # ...and the last
            'dna, genes and chromosomes': 'Dna, Genes and Chromosomes',  # data is lower-cased upstream
            'pH scale': 'pH Scale',                            # a word with a capital is left alone
            '(ñandu) birds': '(Ñandu) Birds',
            '  mga   hayop ': 'Mga Hayop',
            '': '',
        }
        for label, pill in cases.items():
            self.assertEqual(catalog.title_case(label, self.minor), pill)

    def test_the_real_cards_ts_still_declares_the_list(self):
        words = catalog.title_minor(open(catalog.CARDS_TS, encoding='utf-8').read())
        self.assertTrue({'of', 'and', 'the', 'mga', 'ug'} <= words)

    def test_a_changed_declaration_fails_loudly(self):
        with self.assertRaises(SystemExit):
            catalog.title_minor('const TITLE_MINOR = new Set(WORDS);')


class Sandbox(unittest.TestCase):
    """A throwaway copy of the inputs, with the module pointed at it."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.root = Path(self.dir.name)
        (self.root / 'cards.ts').write_text(CARDS_TS)
        (self.root / 'lessonSupplement.ts').write_text(SUPPLEMENT_TS)
        self.supplement(3)
        self.supplement(4)
        self.out = self.root / 'card-catalog.tsv'
        for name, value in (('CARDS_TS', self.root / 'cards.ts'),
                            ('SUPPLEMENT_TS', self.root / 'lessonSupplement.ts')):
            self.addCleanup(setattr, catalog, name, getattr(catalog, name))
            setattr(catalog, name, str(value))

    def supplement(self, grade, cards=(), questions=()):
        (self.root / f'grade{grade}LessonSupplement.json').write_text(json.dumps({
            'cards': [{'id': i, 'factId': f, 'cats': cats} for i, f, cats in cards],
            'questions': {f: {'f': f} for f in questions}, 'competencies': {}}))

    def write_index(self, name, data):
        path = self.root / name
        path.write_text(json.dumps(data))
        return str(path)

    def build(self, *indexes):
        """Regenerate the working file on top of itself, as outside a git checkout."""
        base = [self.out.read_text()] if self.out.exists() else []
        text = catalog.build([self.write_index(f'{n}.json', i) for n, i in enumerate(indexes)], base)
        self.out.write_text(text)
        return text

    def main(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return catalog.main(list(args))


class CatalogTests(Sandbox):
    def test_writes_cards_questions_and_pill_labels(self):
        text = self.build(index([('ffct-00001', 'moth-g5', ['insects']), ('ffct-00002', 'bat-g5', ['mammals', 'caves'])],
                                [('insects', 'insects'), ('mammals', 'mammals'), ('caves', 'caves of the world')],
                                questions=['moth-g5']))
        labels, cards, facts = records(text)
        self.assertEqual(labels, {'insects': 'Insects', 'mammals': 'Mammals', 'caves': 'Caves of the World'})
        self.assertEqual(cards, {'ffct-00001': ['insects'], 'ffct-00002': ['mammals', 'caves']})
        self.assertEqual(facts, {'moth-g5': ['insects']})  # only facts that have a question

    def test_lesson_supplement_cards_and_questions_are_part_of_the_inventory(self):
        # cards.ts: POOL = index + supplement cards; questions = questionFactIds + supplement keys.
        self.supplement(3, cards=[('g3-core-balloon', 'g3-core-balloon', ['process-skills'])],
                        questions=['g3-core-balloon', 'moth-g5'])
        text = self.build(index([('ffct-00001', 'moth-g5', ['insects'])],
                                [('insects', 'insects'), ('process-skills', 'science process skills')]))
        _, cards, facts = records(text)
        self.assertEqual(cards['g3-core-balloon'], ['process-skills'])
        self.assertEqual(facts, {'g3-core-balloon': ['process-skills'],  # a supplement card's own question
                                 'moth-g5': ['insects']})               # a supplement question on an index card

    def test_supplement_files_come_from_lesson_supplement_ts(self):
        files = catalog.supplement_files(str(self.root / 'lessonSupplement.ts'))
        self.assertEqual([Path(f).name for f in files], ['grade4LessonSupplement.json', 'grade3LessonSupplement.json'])
        real = catalog.supplement_files(os.path.join(catalog.ROOT, 'packages/mobile/src/data/lessonSupplement.ts'))
        self.assertEqual(len(real), 8)

    def test_a_changed_supplement_shape_fails_loudly(self):
        for broken in ("export const supplement = {};",
                       SUPPLEMENT_TS.replace('...grade4.questions', '')):
            (self.root / 'lessonSupplement.ts').write_text(broken)
            with self.assertRaises(SystemExit):
                catalog.supplement_files(str(self.root / 'lessonSupplement.ts'))

    def test_retired_cards_keep_their_subcategories_and_current_ones_win(self):
        self.build(index([('dcard-00001', 'old-g4', ['insects']), ('ffct-00002', 'bat-g5', ['insects'])],
                         [('insects', 'insects'), ('mammals', 'mammals')], questions=['old-g4']))
        labels, cards, facts = records(self.build(index([('ffct-00002', 'bat-g5', ['mammals'])], [('mammals', 'mammals')])))
        self.assertEqual(cards, {'dcard-00001': ['insects'], 'ffct-00002': ['mammals']})
        self.assertEqual(facts, {'old-g4': ['insects']})
        self.assertEqual(labels['insects'], 'Insects')  # a retired card's label survives with it

    def test_a_fact_on_several_cards_takes_all_their_subcategories_most_shared_first(self):
        text = self.build(index([('c1', 'dna-g9', ['genetics']), ('c2', 'dna-g9', ['cells', 'genetics']),
                                 ('c3', 'dna-g9', ['g9-dna'])],
                                [('genetics', 'genetics'), ('cells', 'cells'), ('g9-dna', 'dna and genes')],
                                questions=['dna-g9']))
        self.assertEqual(records(text)[2], {'dna-g9': ['genetics', 'cells', 'g9-dna']})

    def test_output_is_deterministic_and_rebuilding_changes_nothing(self):
        data = index([('b', 'f2', ['y']), ('a', 'f1', ['x', 'y'])], [('y', 'y'), ('x', 'x')], questions=['f2', 'f1'])
        first = self.build(data)
        self.assertEqual(first, self.build(data))
        body = [l for l in first.splitlines() if not l.startswith('#')]
        self.assertEqual(body, ['T\tx\tX', 'T\ty\tY', 'C\ta\t0,1', 'C\tb\t1', 'F\tf1\t0,1', 'F\tf2\t1'])

    def test_what_tala_cannot_parse_is_refused(self):
        for bad in (index([('c1', 'f1', ['ghost'])], [('insects', 'insects')]),  # no label
                    index([('bad\tid', 'f1', ['x'])], [('x', 'x')]),              # tab in an id
                    index([('c1', 'f1', ['a\nb'])], [('a\nb', 'x')])):            # newline in a subcategory id
            with self.assertRaises(SystemExit):
                self.build(bad)

    def test_an_unresolved_merge_conflict_is_named(self):
        self.out.write_text('T\tx\tX\n<<<<<<< HEAD\nC\ta\t0\n=======\n>>>>>>> other\n')
        with self.assertRaisesRegex(SystemExit, 'merge conflict'):
            self.build(index([('a', 'f1', ['x'])], [('x', 'x')]))

    def test_check_passes_only_when_the_file_is_current(self):
        taxonomy = [('x', 'x')]
        idx = self.write_index('now.json', index([('c1', 'f1', ['x'])], taxonomy))
        args = ['--index', idx, '--out', str(self.out)]
        self.assertEqual(self.main(*args, '--check'), 1)   # missing
        self.assertEqual(self.main(*args), 0)
        self.assertEqual(self.main(*args, '--check'), 0)
        idx2 = self.write_index('next.json', index([('c1', 'f1', ['x']), ('c2', 'f2', ['x'])], taxonomy))
        self.assertEqual(self.main('--index', idx2, '--out', str(self.out), '--check'), 1)

    def test_a_bare_output_filename_works(self):
        idx = self.write_index('now.json', index([('c1', 'f1', ['x'])], [('x', 'x')]))
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(self.root)
        self.assertEqual(self.main('--index', idx, '--out', 'bare.tsv'), 0)
        self.assertTrue((self.root / 'bare.tsv').exists())


class CommittedBaseTests(Sandbox):
    """In a checkout, what is kept comes from the committed catalog, not the working file."""

    def setUp(self):
        super().setUp()
        git = lambda *a: subprocess.run(['git', '-C', str(self.root), *a], check=True, capture_output=True)
        git('init', '-q')
        git('config', 'user.email', 't@example.com')
        git('config', 'user.name', 't')
        git('config', 'commit.gpgsign', 'false')
        for name, value in (('ROOT', str(self.root)), ('OUT', str(self.out))):
            self.addCleanup(setattr, catalog, name, getattr(catalog, name))
            setattr(catalog, name, value)
        self.taxonomy = [('x', 'x'), ('y', 'y')]
        first = self.write_index('first.json', index([('retired', 'f0', ['x']), ('kept', 'f1', ['y'])], self.taxonomy))
        self.assertEqual(self.main('--index', first), 0)
        git('add', 'card-catalog.tsv')
        git('commit', '-qm', 'catalog')
        self.now = self.write_index('now.json', index([('kept', 'f1', ['y'])], self.taxonomy))

    def test_a_deleted_catalog_is_rebuilt_with_its_retired_ids(self):
        self.out.unlink()
        self.assertEqual(self.main('--index', self.now), 0)
        self.assertEqual(records(self.out.read_text())[1], {'kept': ['y'], 'retired': ['x']})
        self.assertEqual(self.main('--index', self.now, '--check'), 0)

    def test_check_fails_when_a_retired_id_goes_missing(self):
        self.out.write_text(self.out.read_text().replace('C\tretired\t0\n', ''))
        self.assertEqual(self.main('--index', self.now, '--check'), 1)

    def test_ids_from_an_abandoned_local_build_do_not_linger(self):
        experiment = self.write_index('experiment.json',
                                      index([('kept', 'f1', ['y']), ('phantom', 'f9', ['x'])], self.taxonomy))
        self.assertEqual(self.main('--index', experiment), 0)
        self.assertIn('phantom', records(self.out.read_text())[1])
        # The experiment is reverted, the catalog is not: the check notices, a rebuild cleans it.
        self.assertEqual(self.main('--index', self.now, '--check'), 1)
        self.assertEqual(self.main('--index', self.now), 0)
        self.assertEqual(records(self.out.read_text())[1], {'kept': ['y'], 'retired': ['x']})


class ShippedCatalogTests(unittest.TestCase):
    def test_the_shipped_catalog_is_current(self):
        with contextlib.redirect_stderr(io.StringIO()) as err, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(catalog.main(['--check']), 0, err.getvalue())


if __name__ == '__main__':
    unittest.main()
