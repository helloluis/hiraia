"""Compatibility entry point; defaults to Grade 5."""
import pathlib, runpy
runpy.run_path(str(pathlib.Path(__file__).with_name('compile-lessons.py')), run_name='__main__')
