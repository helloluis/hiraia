#!/usr/bin/env bash
# Install OUTSIDE the runner application and checkout. The runner's .env must set
# ACTIONS_RUNNER_HOOK_JOB_STARTED to that installed path. This gate runs before
# workflow steps, including checkout; an exit other than zero prevents execution.
set -euo pipefail
case "${GITHUB_EVENT_NAME:-}" in
  push|workflow_dispatch) ;;
  *) echo 'Native runner rejects this event.' >&2; exit 1 ;;
esac
case "${GITHUB_REF:-}" in
  refs/heads/main|refs/heads/hiraia-unified) ;;
  *) echo 'Native runner rejects this branch.' >&2; exit 1 ;;
esac
if [[ "${GITHUB_REPOSITORY:-}" != 'helloluis/hiraia' ||
      "${GITHUB_WORKFLOW_REF:-}" != "helloluis/hiraia/.github/workflows/native-apps.yml@${GITHUB_REF}" ]]; then
  echo 'Native runner rejects this repository or workflow.' >&2
  exit 1
fi
echo 'Native runner accepted the trusted platform workflow.'
