#!/usr/bin/env python3
"""Repeatable repository verification: python3 manage.py check."""
import os
import subprocess
import sys

import typer
from rich.console import Console

from scripts.check_site import check_site
from scripts.plot_call_gaps import plot_call_gaps
from scripts.browser_site import preview_site
from scripts.site_operations import check_install, check_live
from scripts.build_site import build_site
from scripts.impact.audit import audit
from scripts.impact.report import render
from pathlib import Path


console = Console(highlight=False, markup=False)


def main(command: str = typer.Argument(...), pattern: str = typer.Argument("**/*.test.ts")):
    root = Path(__file__).resolve().parent
    if command == "test-semantic-report":
        environment = {**os.environ, "HYPERLINTER_REPORT_PYTHON": sys.executable}
        for arguments in (["node", "--import", "tsx", "--test", "--test-concurrency=1",
                           "tests/cliDiscovery.test.ts", "tests/semanticReport/semanticReport.test.ts"],
                          [sys.executable, "scripts/test_semantic_report.py"]):
            result = subprocess.run(arguments, cwd=root, env=environment)
            if result.returncode:
                sys.exit(result.returncode)
        return
    if command == "test-semantic-clustering":
        sys.exit(subprocess.run(["node", "--import", "tsx", "--test", "--test-concurrency=1",
            "tests/clustering/averageLinkage.test.ts", "tests/semantic/semanticClustering.test.ts"], cwd=root).returncode)
    if command == "impact-audit":
        audit(root, pattern)
        render(root / "artifacts/impact-audit")
        return
    if command == "impact-report":
        render(root / "artifacts/impact-audit")
        return
    if command == "test-impact":
        sys.exit(subprocess.run([sys.executable, "-m", "unittest", "scripts.impact.test_audit"], cwd=root).returncode)
    if command == "test-calls":
        sys.exit(subprocess.run(["node", "--import", "tsx", "tests/calls/functionCalls.test.ts"], cwd=root).returncode)
    if command == "test":
        sys.exit(subprocess.run(["npm", "run", "test"], cwd=root).returncode)
    if command == "lint":
        sys.exit(subprocess.run(["node", "--import", "tsx", "src/cli.ts"], cwd=root).returncode)
    if command == "test-history":
        sys.exit(subprocess.run(["node", "--import", "tsx", "--test", "tests/history/history.test.ts"], cwd=root).returncode)
    if command == "chronolint":
        sys.exit(subprocess.run(["node", "--import", "tsx", "src/cli.ts", "--chronolint"], cwd=root).returncode)
    operations = {"plot-call-gaps": plot_call_gaps, "site-build": build_site, "site-preview": preview_site, "site-install": check_install, "site-live": check_live}
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
        sys.exit("Use: python3 manage.py check — verify project; lint — emit self-analysis JSON; test-semantic-report — offline PNG regressions; test-semantic-clustering — semantic regressions; site-build — compile static StyleX assets; impact-audit [directory|cached] — aggregate local adoption evidence; impact-report — regenerate aggregate exports and reviewed report; test-impact — audit regressions; plot-call-gaps — chart generation-limit violations; test — run all regressions; test-calls — function graph regressions; chronolint — historical ownership evidence; test-history — Git adapter regressions; test-debug — direct test diagnostics; site-preview — browser audit; site-install — installation smoke check; site-live — deployed files.")
    try:
        check_site(root)
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"website: {error}")
    console.print("website: passed")
    audit_tests = subprocess.run([sys.executable, "-m", "unittest", "scripts.impact.test_audit"], cwd=root)
    if audit_tests.returncode:
        sys.exit(audit_tests.returncode)
    console.print("impact audit: passed")
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
