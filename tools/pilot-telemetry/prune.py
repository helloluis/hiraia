#!/usr/bin/env python3
"""Retention is suspended for the pilot: LTD charts and Neon reconciliation need history."""
import sys
if __name__ == '__main__':
    print('No data deleted. Raw telemetry retention is indefinite during the pilot. '
          'The former 180-day pruning job is disabled to preserve lifetime totals and remote recovery.', file=sys.stderr)
    raise SystemExit(0)
