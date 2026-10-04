#!/usr/bin/env python3
"""Repeatable repository verification: python3 manage.py check."""
import subprocess
import sys

from scripts.check_site import check_site, preview_site
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    if sys.argv[1:] == ["site-preview"]:
        preview_site(root)
        return
    if sys.argv[1:] != ["check"]:
        sys.exit("Use: python3 manage.py check — verify project; site-preview — capture desktop/mobile screenshots.")
    try:
        check_site(root)
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"website: {error}")
    print("website: passed")
    for script in ("typecheck", "test"):
        result = subprocess.run(["npm", "run", script], cwd=root, capture_output=True, text=True)
        if result.returncode:
            print(result.stdout + result.stderr)
            sys.exit(result.returncode)
        print(f"{script}: passed")


if __name__ == "__main__":
    main()
