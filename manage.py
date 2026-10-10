#!/usr/bin/env python3
"""Repeatable repository verification: python3 manage.py check."""
import subprocess
import sys

from scripts.check_site import check_site
from scripts.browser_site import preview_site
from scripts.site_operations import check_install, check_live
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    operations = {"site-preview": preview_site, "site-install": check_install, "site-live": check_live}
    if sys.argv[1:] == ["test-debug"]:
        for file in sorted((root / "tests").glob("*.test.ts")):
            result = subprocess.run(["node", "--import", "tsx", str(file)], cwd=root)
            if result.returncode:
                sys.exit(result.returncode)
        return
    if len(sys.argv) == 2 and sys.argv[1] in operations:
        operations[sys.argv[1]](root)
        return
    if sys.argv[1:] != ["check"]:
        sys.exit("Use: python3 manage.py check — verify project; test-debug — direct test diagnostics; site-preview — browser audit; site-install — installation smoke check; site-live — deployed files.")
    try:
        check_site(root)
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"website: {error}")
    print("website: passed")
    for script in ("typecheck", "hyperlint", "test"):
        result = subprocess.run(["npm", "run", script], cwd=root, capture_output=True, text=True)
        if result.returncode:
            print(result.stdout + result.stderr)
            sys.exit(result.returncode)
        print(f"{script}: passed")


if __name__ == "__main__":
    main()
