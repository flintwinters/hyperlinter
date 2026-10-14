#!/usr/bin/env python3
"""Repeatable repository verification: python3 manage.py check."""
import subprocess
import sys

import typer
from rich.console import Console

from scripts.check_site import check_site
from scripts.browser_site import preview_site
from scripts.site_operations import check_install, check_live
from pathlib import Path


console = Console(highlight=False, markup=False)


def main(command: str = typer.Argument(...)):
    root = Path(__file__).resolve().parent
    if command == "test-history":
        sys.exit(subprocess.run(["node", "--import", "tsx", "--test", "tests/chronology/history.test.ts"], cwd=root).returncode)
    if command == "chronolint":
        sys.exit(subprocess.run(["node", "--import", "tsx", "src/cli.ts", "--chronolint"], cwd=root).returncode)
    operations = {"site-preview": preview_site, "site-install": check_install, "site-live": check_live}
    if command == "test-debug":
        for file in sorted((root / "tests").rglob("*.test.ts")):
            result = subprocess.run(["node", "--import", "tsx", str(file)], cwd=root)
            if result.returncode:
                sys.exit(result.returncode)
        return
    if command in operations:
        operations[command](root)
        return
    if command != "check":
        sys.exit("Use: python3 manage.py check — verify project; chronolint — historical ownership evidence; test-history — Git adapter regressions; test-debug — direct test diagnostics; site-preview — browser audit; site-install — installation smoke check; site-live — deployed files.")
    try:
        check_site(root)
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"website: {error}")
    console.print("website: passed")
    for script in ("typecheck", "hyperlint", "test"):
        result = subprocess.run(["npm", "run", script], cwd=root, capture_output=True, text=True)
        if result.returncode:
            console.print(result.stdout + result.stderr)
            if script == "test":
                console.print(
                    "Agent guidance: If chronology tests fail, run python3 manage.py test-debug "
                    "to reveal subprocess errors. If Git is blocked by the sandbox "
                    "(for example, spawnSync git EPERM), request elevated Git access and rerun "
                    "python3 manage.py check outside the sandbox. These tests create disposable "
                    "Git repositories under artifacts/. Preserve the tests and enforcement policy."
                )
            sys.exit(result.returncode)
        console.print(f"{script}: passed")


if __name__ == "__main__":
    typer.run(main)
