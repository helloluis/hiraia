"""The Mac holding release credentials must reject fork/PR/arbitrary jobs."""
import os
from pathlib import Path
import subprocess
import unittest

HOOK = Path(__file__).with_name('native-runner-job-started.sh')


class RunnerBoundary(unittest.TestCase):
    def run_hook(self, **changes):
        env = {**os.environ, 'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/main',
               'GITHUB_REPOSITORY': 'helloluis/hiraia',
               'GITHUB_WORKFLOW_REF': 'helloluis/hiraia/.github/workflows/native-apps.yml@refs/heads/main',
               **changes}
        return subprocess.run(['bash', str(HOOK)], env=env, capture_output=True).returncode

    def test_trusted_push_and_dispatch(self):
        self.assertEqual(self.run_hook(), 0)
        self.assertEqual(self.run_hook(GITHUB_EVENT_NAME='workflow_dispatch'), 0)
        self.assertEqual(self.run_hook(GITHUB_REF='refs/heads/hiraia-unified',
            GITHUB_WORKFLOW_REF='helloluis/hiraia/.github/workflows/native-apps.yml@refs/heads/hiraia-unified'), 0)

    def test_untrusted_jobs_rejected(self):
        for change in [dict(GITHUB_EVENT_NAME='pull_request'), dict(GITHUB_EVENT_NAME='pull_request_target'),
                       dict(GITHUB_EVENT_NAME=''), dict(GITHUB_REF='refs/heads/untrusted'),
                       dict(GITHUB_REPOSITORY='fork/hiraia'), dict(GITHUB_WORKFLOW_REF=''),
                       dict(GITHUB_WORKFLOW_REF='helloluis/hiraia/.github/workflows/other.yml@refs/heads/main')]:
            with self.subTest(change=change):
                self.assertNotEqual(self.run_hook(**change), 0)


if __name__ == '__main__':
    unittest.main()
