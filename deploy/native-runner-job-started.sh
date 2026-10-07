#!/usr/bin/env bash
# Install OUTSIDE the runner application and checkout. The runner's .env must set
# ACTIONS_RUNNER_HOOK_JOB_STARTED to that installed path. This gate runs before
# workflow steps, including checkout; an exit other than zero prevents execution.
set -euo pipefail
case "${GITHUB_EVENT_NAME:-}" in
  push|workflow_dispatch) ;;
  *) echo 'Native runner rejects this event.' >&2; exit 1 ;;
esac
if [[ "${GITHUB_REPOSITORY:-}" != 'helloluis/hiraia' ||
      "${GITHUB_WORKFLOW_REF:-}" != "helloluis/hiraia/.github/workflows/native-apps.yml@${GITHUB_REF}" ]]; then
  echo 'Native runner rejects this repository or workflow.' >&2
  exit 1
fi
case "${GITHUB_REF:-}" in
  refs/heads/main|refs/heads/hiraia-unified) ;;
  *)
    # An operator can authorize one reviewed commit for manual release validation.
    # This file lives beside the INSTALLED hook, never in the Actions checkout.
    [[ "${GITHUB_EVENT_NAME:-}" == 'workflow_dispatch' ]] || exit 1
    /usr/bin/python3 - "$(dirname "${BASH_SOURCE[0]}")/approved-dispatch.json" <<'PY'
import json, os, re, stat, sys, time
from pathlib import Path

try:
    path = Path(sys.argv[1])
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid() or parent.st_mode & 0o077:
        raise ValueError('approval directory must be owner-only')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('approval must be an owner-only regular file')
        approval = json.load(stream)
    if set(approval) != {'schema', 'ref', 'sha', 'issued_at', 'expires_at'} or approval['schema'] != 1:
        raise ValueError('invalid approval schema')
    issued, expires = approval['issued_at'], approval['expires_at']
    if type(issued) is not int or type(expires) is not int or not issued <= time.time() < expires <= issued + 86400:
        raise ValueError('approval expired or exceeds one day')
    if not isinstance(approval['sha'], str) or not re.fullmatch('[0-9a-f]{40}', approval['sha']):
        raise ValueError('invalid approved commit')
    if approval['ref'] != os.environ.get('GITHUB_REF') or approval['sha'] != os.environ.get('GITHUB_SHA'):
        raise ValueError('branch or commit differs from operator approval')
except (OSError, ValueError, TypeError, KeyError) as error:
    sys.exit('Native runner rejects this branch: ' + str(error))
print('Native runner accepted the exact operator-approved dispatch.')
PY
    ;;
esac
echo 'Native runner accepted the trusted platform workflow.'
