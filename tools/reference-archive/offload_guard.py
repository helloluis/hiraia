#!/usr/bin/env python3
"""Refuse image work against deliberately offloaded sources; never restore or clear markers."""
import os
from pathlib import Path
import sys

MARKER_NAME = '.hiraia-archive-offloaded.json'


class OffloadedSourceError(RuntimeError):
    pass


def _present(path):
    try:
        path.lstat()
        return True
    except (FileNotFoundError, NotADirectoryError):
        return False


def assert_local(*paths):
    """Check file sidecars and directory/ancestor markers, including symlink aliases.

    Marker presence is authoritative: malformed, empty and dangling-symlink markers
    all block work. Contents are operator provenance, never executable configuration.
    Missing *unmarked* paths retain the caller's existing behavior.
    """
    checked = set()
    for value in paths:
        original = Path(value)
        path = Path(os.path.abspath(os.fspath(original)))
        # Resolve links before '..'; abspath alone would discard that distinction.
        for candidate in (path, original.resolve()):
            markers = [candidate.with_name(candidate.name + MARKER_NAME)] if candidate.name else []
            markers.extend(parent / MARKER_NAME for parent in (candidate, *candidate.parents))
            for marker in markers:
                if marker in checked:
                    continue
                checked.add(marker)
                if _present(marker):
                    raise OffloadedSourceError(
                        f'ARCHIVE_OFFLOADED: {path}\n'
                        f'Blocking marker: {marker}\n'
                        'Restore or reconstruct the archived sources at their original locations '
                        'and validate the recorded provenance before removing this marker. See '
                        'tools/reference-archive/OFFLOAD.md. Do not regenerate missing images '
                        'or create placeholder files.'
                    )


def main():
    if len(sys.argv) < 2:
        print('usage: offload_guard.py PATH [PATH ...]', file=sys.stderr)
        return 2
    try:
        assert_local(*sys.argv[1:])
    except (OffloadedSourceError, OSError, RuntimeError) as error:
        print(error, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
