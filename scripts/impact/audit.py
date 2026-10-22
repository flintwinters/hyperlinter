"""Reproducible local consumer census; no target analysis or policy writes."""
import datetime
import json
import os
import sqlite3
import subprocess
from pathlib import Path

from rich.console import Console

from .evidence import read_ledger, attribute_runs, read_development
from .history import git, history

PRUNED = {"node_modules", ".git", ".cache", ".local", ".npm", ".cargo", ".rustup",
          ".venv", "venv", ".uv-cache", "__pycache__", ".Trash-1000", "vendor",
          ".bat-toolchain", "snap", "AppDir", "artifacts", ".test-artifacts", "site-packages",
          ".workstation-migration-backups", ".history", ".tools", ".test-work", "build-dependencies", "build-output"}
MARKERS = {".gitmodules", "hyperlinter.config.json", "hyperlinter.project.json", "package.json", "manage.py"}


def discover(roots):
    projects = {}
    errors = []
    visited = 0
    def error(exception):
        errors.append(str(exception))
    for root in roots:
        if not root.exists():
            continue
        for directory, dirs, files in os.walk(root, onerror=error, followlinks=False):
            visited += 1
            dirs[:] = sorted(d for d in dirs if d not in PRUNED)
            path = Path(directory)
            if path.name == ".codex":
                dirs[:] = [d for d in dirs if d == "worktrees"]
            relevant = MARKERS.intersection(files)
            for name in relevant:
                marker = path / name
                try:
                    if name in {".gitmodules", "package.json", "manage.py"} and "hyperlint" not in marker.read_text().lower():
                        continue
                    project = Path(git(path, "rev-parse", "--show-toplevel"))
                    # Engine checkouts are evidence sources, not extra consumer projects.
                    if project.name == "hyperlint" and project.parent.name == "tools":
                        project = project.parent.parent
                    common = Path(git(project, "rev-parse", "--path-format=absolute", "--git-common-dir"))
                    primary = common.parent if common.name == ".git" else project
                    entry = projects.setdefault(str(primary), {"markers": set(), "checkouts": set()})
                    entry["markers"].add(str(marker))
                    entry["checkouts"].add(str(project))
                except (OSError, ValueError, subprocess.SubprocessError) as exception:
                    errors.append(f"{marker}: {exception}")
    return {"roots": [str(p) for p in roots], "pruned_directory_names": sorted(PRUNED),
            "directories_visited": visited, "errors": errors,
            "projects": [{"root": path, **{key: sorted(value) for key, value in entry.items()}}
                         for path, entry in sorted(projects.items())]}


def audit(root: Path, scope: str):
    console = Console(highlight=False, markup=False)
    output = root / "artifacts/impact-audit"
    output.mkdir(parents=True, exist_ok=True)
    inventory_path = output / "inventory.json"
    if scope == "cached":
        inventory = json.loads(inventory_path.read_text())
    else:
        roots = [Path(scope)] if scope != "**/*.test.ts" else [Path(p) for p in ("/home", "/root", "/opt", "/srv", "/media")]
        console.print("Discovering Hyperlinter installations (read-only; dependency/cache directories excluded)...")
        inventory = discover(roots)
        inventory["scope_notes"] = ["/mnt contains remote business shares and was excluded from the local checkout census.",
                                    "Only worktrees are searched inside .codex; caches, backups and disposable test artifacts are excluded."]
        inventory_path.write_text(json.dumps(inventory, indent=2) + "\n")
    report = {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "inventory": inventory, "projects": [], "limitations": [
                  "Observational evidence; no causal attribution or untreated control cohort.",
                  "Ledger revisions do not identify dirty source, engine version, config, baseline, or run mode.",
                  "Runs with zero module metrics are excluded from architecture endpoints, retained in exports.",
                  "Rule counts across versions/configurations are not comparable performance scores.",
                  "History uses first-parent lineage and at most 30 commits each side of installation, excluding installation commit.",
                  "All-post includes installation. Churn counts renames as delete/add; breadth measures directories, not semantic modules.",
                  "Snapshots cover tracked JS/TS only, excluding dependencies, engine submodules, common output directories, and declarations. Checked-in generated JS outside those directories remains; TypeScript-only counts are provided separately.",
                  "Snapshots are committed trees, not working-tree state. Tests are measured separately; nonempty lines are not semantic LOC.",
                  "Installation census uses named configs and .gitmodules; undocumented/custom integrations may be missed.",
                  "Independent task/command evidence is included where present; missing task effort is unknown, never zero."]}
    for i, item in enumerate(inventory["projects"]):
        path = Path(item["root"])
        console.print(f"Collecting {path}...")
        project = {**item, "cohort": "engine" if path == root else "consumer", "ledgers": []}
        folder = output / f"{i:02d}-{path.name}"
        folder.mkdir(exist_ok=True)
        try:
            project["history"] = history(path, engine=path == root)
            engine = path if path == root else path / "tools/hyperlint"
            project["engine_head"] = git(engine, "rev-parse", "HEAD") if engine.exists() else None
            candidates = {path / "runtime/hyperlint.sqlite", engine / "runtime/hyperlint.sqlite"}
            project_revisions = set(git(path, "rev-list", "HEAD").splitlines())
            engine_revisions = set(git(engine, "rev-list", "HEAD").splitlines()) if engine.exists() and path != root else set()
            project["checkouts"] = []
            for checkout in item.get("checkouts", [str(path)]):
                checkout = Path(checkout)
                project["checkouts"].append({"path": str(checkout), "head": git(checkout, "rev-parse", "HEAD"),
                                             "dirty": git(checkout, "status", "--porcelain", "--untracked-files=no")})
                project_revisions.update(git(checkout, "rev-list", "HEAD").splitlines())
                candidates.update([checkout / "runtime/hyperlint.sqlite", checkout / "tools/hyperlint/runtime/hyperlint.sqlite"])
            for candidate in sorted(candidates):
                if candidate.exists():
                    ledger = read_ledger(candidate, folder / f"ledger-{len(project['ledgers'])}.sqlite")
                    attribute_runs(ledger, project_revisions, engine_revisions)
                    project["ledgers"].append(ledger)
            project["development"] = read_development(path, folder / "development.sqlite")
            report_path = path / "var/reports/hyperlint.json"
            if report_path.exists():
                (folder / "saved-report.json").write_bytes(report_path.read_bytes())
                project["saved_report"] = str(report_path)
        except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as exception:
            project["error"] = str(exception)
        report["projects"].append(project)
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    console.print(f"Evidence: {output / 'report.json'}")
    for p in report["projects"]:
        h = p.get("history", {})
        console.print(f"{p['root']}: {sum(len(d['runs']) for d in p['ledgers'])} runs; "
                      f"{h.get('all_post', {}).get('commits', '?')} commits since installation; {p.get('error', '')}")
