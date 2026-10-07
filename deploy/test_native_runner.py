"""The Mac holding release credentials must reject fork/PR/arbitrary jobs."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

HOOK = Path(__file__).with_name('native-runner-job-started.sh')


class RunnerBoundary(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.hook = Path(self.directory.name) / HOOK.name
        shutil.copyfile(HOOK, self.hook)

    def run_hook(self, **changes):
        env = {**os.environ, 'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/main',
               'GITHUB_REPOSITORY': 'helloluis/hiraia',
               'GITHUB_WORKFLOW_REF': 'helloluis/hiraia/.github/workflows/native-apps.yml@refs/heads/main',
               **changes}
        return subprocess.run(['bash', str(self.hook)], env=env, capture_output=True).returncode

    def approve(self, **changes):
        now = int(time.time())
        path = self.hook.with_name('approved-dispatch.json')
        path.write_text(json.dumps({'schema': 1, 'ref': 'refs/heads/reviewed-release',
            'sha': 'a' * 40, 'issued_at': now - 1, 'expires_at': now + 3600, **changes}))
        path.chmod(0o600)
        return path

    def run_approved(self, **changes):
        return self.run_hook(**{'GITHUB_EVENT_NAME': 'workflow_dispatch',
            'GITHUB_REF': 'refs/heads/reviewed-release', 'GITHUB_SHA': 'a' * 40,
            'GITHUB_WORKFLOW_REF': 'helloluis/hiraia/.github/workflows/native-apps.yml@refs/heads/reviewed-release',
            **changes})

    def test_exact_operator_approved_dispatch(self):
        self.assertNotEqual(self.run_approved(), 0)
        self.approve()
        self.assertEqual(self.run_approved(), 0)

    def test_approval_does_not_authorize_other_code_or_events(self):
        self.approve()
        for change in [dict(GITHUB_SHA='b' * 40), dict(GITHUB_REF='refs/heads/other'),
                       dict(GITHUB_SHA=''), dict(GITHUB_EVENT_NAME='push'),
                       dict(GITHUB_EVENT_NAME='pull_request_target'),
                       dict(GITHUB_REPOSITORY='fork/hiraia'),
                       dict(GITHUB_WORKFLOW_REF='helloluis/hiraia/.github/workflows/other.yml@refs/heads/reviewed-release')]:
            with self.subTest(change=change):
                self.assertNotEqual(self.run_approved(**change), 0)

    def test_expired_future_overlong_and_invalid_approvals_rejected(self):
        now = int(time.time())
        for change in [dict(expires_at=now - 1), dict(issued_at=now + 60),
                       dict(expires_at=now + 86401), dict(expires_at='tomorrow'),
                       dict(sha='*'), dict(schema=2), dict(extra='unexpected')]:
            with self.subTest(change=change):
                self.approve(**change)
                self.assertNotEqual(self.run_approved(), 0)

    def test_group_readable_or_symlinked_approval_rejected(self):
        path = self.approve()
        path.chmod(0o640)
        self.assertNotEqual(self.run_approved(), 0)
        path.chmod(0o600)
        target = path.with_suffix('.target')
        path.rename(target)
        path.symlink_to(target)
        self.assertNotEqual(self.run_approved(), 0)

    def test_nonprivate_approval_directory_rejected(self):
        self.approve()
        self.hook.parent.chmod(0o755)
        self.assertNotEqual(self.run_approved(), 0)

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
