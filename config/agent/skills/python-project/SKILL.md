---
name: python-project
description: Conventions for Python scripts, CLIs and small apps on this Windows PC - layout, venv, argparse, logging, unittest tests and how to verify. Use when creating or extending a Python project or script.
---

# Python projects on this PC

## Facts (checked; don't rediscover them)
- Run Python as `python` (3.12). There is no `python3`. `py -3.12` also works.
- `pytest` is NOT installed globally. Use the standard library `unittest` (`python -m unittest -v`) unless the project
  already has pytest in its venv / requirements.
- The bash tool is Git Bash: use forward slashes; a venv's interpreter is `.venv/Scripts/python.exe` (not `bin/`).

## New project layout
```
project/
  README.md            what it does, how to install, how to run, how to test
  requirements.txt     only if there are third-party packages (pin major versions)
  src or <pkg>/        code; a single-file tool may just be <name>.py
  tests/test_*.py      unittest tests (or test_<name>.py next to a single-file tool)
  .gitignore           .venv/, __pycache__/, logs/, *.pyc
```
Third-party packages go in a project venv: `python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt`.
Never `pip install` globally unless asked.

## Code
- Standard library first (argparse, pathlib, json, csv, logging, sqlite3, http.server, urllib). Add a package only when it saves real work.
- CLIs: `argparse` with `--help` text for every option; `main(argv=None) -> int` and `if __name__ == "__main__": sys.exit(main())`, so tests can call `main([...])`.
- Errors a user can cause (missing file, bad option) print one clear line to stderr and exit 1 or 2 - no traceback.
- Paths via `pathlib.Path`; open text files with `encoding="utf-8"` (Windows defaults to cp1252 otherwise).
- Logging: `logging` to stderr, or to `logs/run.log` for long-running tools; never `print` debugging left behind.
- Type hints on public functions; small functions; no global state except constants.

## Tests and verification
- Every feature and every error path gets a test. Test through `main([...])` with `contextlib.redirect_stdout` / `io.StringIO`, plus pure-function tests.
- Use `tempfile.TemporaryDirectory()` for files in tests; never write into the project during tests.
- Before saying done: `python -m unittest -v 2>&1 | tail -20` passes, and you ran the real CLI once on a sample input and saw the expected output.
- Bound every command: `timeout 120 python ...`. Servers/GUI programs only with `timeout` and never inside the test suite.
