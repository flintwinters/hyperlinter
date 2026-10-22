#!/usr/bin/env python3
"""Repeatable repository verification: python3 manage.py check."""
import subprocess
import sys

import typer
from rich.console import Console

from scripts.check_site import check_site
from scripts.plot_call_gaps import plot_call_gaps
from scripts.browser_site import preview_site
from scripts.site_operations import check_install, check_live
from pathlib import Path


console = Console(highlight=False, markup=False)


def main(command: str = typer.Argument(...), pattern: str = typer.Argument("**/*.test.ts")):
    root = Path(__file__).resolve().parent
    if command == "test-calls":
        sys.exit(subprocess.run(["node", "--import", "tsx", "tests/structure/functionCalls.test.ts"], cwd=root).returncode)
    if command == "test":
        sys.exit(subprocess.run(["npm", "run", "test"], cwd=root).returncode)
    if command == "test-history":
        sys.exit(subprocess.run(["node", "--import", "tsx", "--test", "tests/chronology/history.test.ts"], cwd=root).returncode)
    if command == "chronolint":
        sys.exit(subprocess.run(["node", "--import", "tsx", "src/cli.ts", "--chronolint"], cwd=root).returncode)
    operations = {"plot-call-gaps": plot_call_gaps, "site-preview": preview_site, "site-install": check_install, "site-live": check_live}
    if command == "test-debug":
        files = sorted((root / "tests").glob(pattern))
        if not files or any(not file.name.endswith(".test.ts") for file in files):
            sys.exit("test-debug: select existing *.test.ts files under tests/")
        for file in files:
            result = subprocess.run(["node", "--import", "tsx", str(file)], cwd=root)
            if result.returncode:
                sys.exit(result.returncode)
        return
    if command in operations:
        operations[command](root)
        return
    if command != "check":
        sys.exit("Use: python3 manage.py check — verify project; plot-call-gaps — chart generation-limit violations; test — run all regressions; test-calls — function graph regressions; chronolint — historical ownership evidence; test-history — Git adapter regressions; test-debug — direct test diagnostics; site-preview — browser audit; site-install — installation smoke check; site-live — deployed files.")
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
