"""Prevent author metadata precision from blocking every assessment controller."""
from datetime import datetime
import importlib.util
from pathlib import Path
import re
import unittest

spec = importlib.util.spec_from_file_location('compiler', Path(__file__).with_name('build-assessment-bank.py'))
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class CompilerTimestampTests(unittest.TestCase):
    def test_microsecond_author_timestamp_is_emitted_as_native_milliseconds(self):
        source = '2026-09-29T00:15:38.678349+00:00'
        output = compiler.latest_authored_at(['2026-09-28T23:59:59.999Z', source])
        self.assertEqual('2026-09-29T00:15:38.678+00:00', output)
        self.assertRegex(output, r'T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$')
        self.assertLess(abs(datetime.fromisoformat(source).timestamp()-datetime.fromisoformat(output).timestamp()), 0.001)

    def test_latest_date_uses_instant_not_lexical_timezone_order(self):
        values = ['2026-09-29T09:00:00.001+08:00', '2026-09-29T01:01:00+00:00']
        self.assertEqual('2026-09-29T01:01:00.000+00:00', compiler.latest_authored_at(values))


if __name__ == '__main__': unittest.main()
