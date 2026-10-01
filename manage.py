#!/usr/bin/env python3
"""Repeatable repository verification: python3 manage.py check."""
import subprocess
import sys
from pathlib import Path


def main():
    if sys.argv[1:] != ["check"]:
        sys.exit("Use: python3 manage.py check — typecheck and regression tests.")
    root = Path(__file__).resolve().parent
    for script in ("typecheck", "test"):
        result = subprocess.run(["npm", "run", script], cwd=root, capture_output=True, text=True)
        if result.returncode:
            print(result.stdout + result.stderr)
            sys.exit(result.returncode)
        print(f"{script}: passed")


if __name__ == "__main__":
    main()
