#!/usr/bin/env python3
"""Prune by RECEIPT date, retaining late offline events for a full retention period."""
import argparse
import os
import sqlite3
import time
from pathlib import Path

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default=os.environ.get('HIRAIA_TELEMETRY_DB_PATH'))
    parser.add_argument('--days', type=int, default=180)
    args = parser.parse_args()
    if not args.db or not Path(args.db).is_file(): parser.error('provide an existing --db')
    if args.days < 100: parser.error('retain at least 100 days to cover the client queue and retries')
    with sqlite3.connect(args.db, timeout=10) as db:
        deleted = db.execute('DELETE FROM telemetry_events WHERE received_at < ?',
                             (int((time.time() - args.days * 86400) * 1000),)).rowcount
    print(f'Deleted {deleted} events older than {args.days} days by receipt date.')
