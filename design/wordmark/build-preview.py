# Rebuild the current wordmark study. Earlier studies have their own build scripts.
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('build-round-4.py')), run_name='__main__')
