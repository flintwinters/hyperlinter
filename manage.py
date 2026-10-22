#!/usr/bin/env python3
"""Repeatable repository verification: python3 manage.py check."""
import os
import subprocess
import sys

import typer
from rich.console import Console

from scripts.check_site import check_site
from scripts.browser_site import preview_site
from scripts.site_operations import check_install, check_live
from scripts.build_site import build_site
from pathlib import Path


console = Console(highlight=False, markup=False)


def main(command: str = typer.Argument(...)):
    root = Path(__file__).resolve().parent
    if command == "test-semantic-report":
        environment = {**os.environ, "HYPERLINTER_REPORT_PYTHON": sys.executable}
        for arguments in (["node", "--import", "tsx", "--test", "--test-concurrency=1",
                           "tests/cliDiscovery.test.ts", "tests/semantic/semanticReport.test.ts"],
                          [sys.executable, "scripts/test_semantic_report.py"]):
            result = subprocess.run(arguments, cwd=root, env=environment)
            if result.returncode:
                sys.exit(result.returncode)
        return
    if command == "test-semantic-clustering":
        sys.exit(subprocess.run(["node", "--import", "tsx", "--test", "--test-concurrency=1",
            "tests/semantic/averageLinkage.test.ts", "tests/semantic/semanticClustering.test.ts"], cwd=root).returncode)
    if command == "test-history":
        sys.exit(subprocess.run(["node", "--import", "tsx", "--test", "tests/chronology/history.test.ts"], cwd=root).returncode)
    if command == "chronolint":
        sys.exit(subprocess.run(["node", "--import", "tsx", "src/cli.ts", "--chronolint"], cwd=root).returncode)
    operations = {"site-build": build_site, "site-preview": preview_site, "site-install": check_install, "site-live": check_live}
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
        sys.exit("Use: python3 manage.py test-semantic-report — offline PNG regressions (requires reporting Python dependencies); check — verify project; chronolint — historical ownership evidence; test-history — Git adapter regressions; test-debug — direct test diagnostics; site-build — compile static StyleX assets; site-preview — browser audit; site-install — installation smoke check; site-live — deployed files.")
    try:
        check_site(root)
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"website: {error}")
    console.print("website: passed")
    for script in ("typecheck", "hyperlint", "test"):
        # Analysis fixtures spawn compilers and Git; serialize them to bound
        # memory rather than making correctness depend on available swap.
        arguments = ["npm", "run", script]
        result = subprocess.run(arguments, cwd=root, capture_output=True, text=True)
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
