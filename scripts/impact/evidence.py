"""Read-only extraction of existing Hyperlinter SQLite evidence."""
import collections
import hashlib
import importlib.util
import json
import sqlite3
import shutil
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace


def capture_database(path: Path, output: Path):
    # Source checkouts can be on read-only mounts: even mode=ro SQLite may need
    # writable WAL shared memory. Capture main/WAL/journal bytes without opening
    # the source in SQLite, reject concurrent changes, then recover/backup locally.
    capture = output.with_name(output.stem + "-capture.sqlite")
    sources = [Path(str(path) + suffix) for suffix in ("", "-wal", "-journal")]
    def fingerprints():
        return {str(p): {"size": p.stat().st_size, "mtime_ns": p.stat().st_mtime_ns,
                         "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                for p in sources if p.exists()}
    for attempt in range(3):
        before = fingerprints()
        for file in [capture, Path(str(capture) + "-wal"), Path(str(capture) + "-shm"), Path(str(capture) + "-journal")]:
            file.unlink(missing_ok=True)
        copied = {}
        for name in before:
            destination = Path(str(capture) + name[len(str(path)):])
            shutil.copyfile(name, destination)
            copied[name] = hashlib.sha256(destination.read_bytes()).hexdigest()
        after = fingerprints()
        if before == after and all(copied[p] == before[p]["sha256"] for p in copied):
            break
    else:
        raise ValueError(f"Ledger changed during three capture attempts: {path}")
    with closing(sqlite3.connect(capture)) as source:
        with closing(sqlite3.connect(output)) as target:
            source.backup(target)
    return {"path": str(path), "snapshot": str(output), "source_files": before,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}


def metric_totals(values):
    declarations = sum(v["declarations"] for v in values)
    public = sum(v["public_surface"] for v in values)
    return {"metric_modules": len(values), "declarations": declarations,
            "public_surface": public, "public_ratio": public / declarations if declarations else None,
            "dependencies": sum(v["dependencies"] for v in values),
            "cross_references": sum(v["cross_module_references"] for v in values),
            "max_dependencies": max((v["dependencies"] for v in values), default=0)}


def owned_metric_totals(values):
    return metric_totals([v for v in values if v["module"].replace("\\", "/") != "tools/hyperlint"
                          and not v["module"].replace("\\", "/").startswith("tools/hyperlint/")])


def read_ledger(path: Path, output: Path):
    provenance = capture_database(path, output)
    with closing(sqlite3.connect(output)) as database:
        database.row_factory = sqlite3.Row
        tables = {r[0] for r in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        schema = {name: [dict(r) for r in database.execute(f'PRAGMA table_info("{name}")')]
                  for name in sorted(tables) if name in {"runs", "diagnostics", "module_metrics", "chronology"}}
        rows = {name: [dict(r) for r in database.execute(f'SELECT * FROM "{name}"')]
                for name in schema}
    metrics = collections.defaultdict(list)
    diagnostics = collections.defaultdict(list)
    for row in rows.get("module_metrics", []):
        metrics[row["run_id"]].append(row)
    for row in rows.get("diagnostics", []):
        diagnostics[row["run_id"]].append(row)
    runs = []
    for row in rows.get("runs", []):
        values = metrics[row["id"]]
        run = {**row, **metric_totals(values),
               "rules": dict(collections.Counter(d["rule"] for d in diagnostics[row["id"]])),
               "owned_metrics": owned_metric_totals(values)}
        runs.append(run)
    runs.sort(key=lambda r: (r["started_at"], r["id"]))
    # Dedicated chronology runs have no module metrics; keep them in the raw export,
    # but never mistake them for an architectural improvement to zero violations.
    regular = [r for r in runs if r["metric_modules"]]
    (output.with_suffix(".json")).write_text(json.dumps({"source": str(path), "schema": schema, "tables": rows}, indent=2) + "\n")
    return {**provenance,
            "runs": runs, "regular_runs": len(regular),
            "first": regular[0] if regular else None, "last": regular[-1] if regular else None}


def attribute_runs(ledger, project_revisions, engine_revisions):
    """One physical ledger may mix host analysis with engine self-checks."""
    for run in ledger["runs"]:
        revision = run.get("revision")
        host = revision in project_revisions
        engine = revision in engine_revisions
        run["attribution"] = "ambiguous" if host and engine else "project" if host else "engine" if engine else "unresolved"
    regular = [r for r in ledger["runs"] if r["metric_modules"] and r["attribution"] == "project"]
    ledger["attributions"] = dict(collections.Counter(r["attribution"] for r in ledger["runs"]))
    ledger["project_regular_runs"] = len(regular)
    ledger["project_revisions"] = len({r["revision"] for r in regular})
    ledger["project_first"] = regular[0] if regular else None
    ledger["project_last"] = regular[-1] if regular else None


def read_development(root: Path, output: Path):
    """Reuse the consumer's authoritative report semantics on a local snapshot.

    Do not construct DevelopmentStore: its initializer writes schema in the
    target. Its existing report method only reads the supplied connection.
    """
    path = root / "artifacts/development.sqlite"
    adapter = root / "scripts/development_store.py"
    if not path.exists() or not adapter.exists():
        return None
    provenance = capture_database(path, output)
    spec = importlib.util.spec_from_file_location("impact_consumer_development", adapter)
    module = importlib.util.module_from_spec(spec)
    # exec() avoids creating __pycache__ in the read-only consumer checkout.
    code = adapter.read_bytes()
    exec(compile(code, str(adapter), "exec"), module.__dict__)
    output.with_suffix(".adapter.py").write_bytes(code)
    with closing(sqlite3.connect(output)) as database:
        database.row_factory = sqlite3.Row
        evidence = module.DevelopmentStore.report(SimpleNamespace(db=database))
    output.with_suffix(".json").write_text(json.dumps(evidence, indent=2) + "\n")
    tasks = evidence["tasks"]
    commands = evidence["commands"]
    return {**provenance, "adapter_sha256": hashlib.sha256(code).hexdigest(),
            "tasks": tasks, "command_count": len(commands),
            "completed_tasks": sum(t["outcome"] == "completed" for t in tasks),
            "complete_effort_tasks": sum(t["outcome"] == "completed" and t["effort_complete"] for t in tasks),
            "command_statuses": dict(collections.Counter(c["status"] for c in commands)),
            "unassigned_commands": sum(c["task_id"] is None for c in commands),
            "command_wall_seconds": sum(c["duration_seconds"] for c in commands),
            "steps": [{"step": step, "count": len(group),
                       "wall_seconds": sum(c["duration_seconds"] for c in group),
                       "statuses": dict(collections.Counter(c["status"] for c in group))}
                      for step in sorted({c["step"] for c in commands})
                      for group in [[c for c in commands if c["step"] == step]]]}
