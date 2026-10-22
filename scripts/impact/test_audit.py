"""Synthetic regressions for the audit's evidence and attribution boundaries."""
import json
import re
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

from .audit import discover
from .evidence import read_ledger, attribute_runs, read_development
from .history import history, snapshot
from .report import aggregate_database

ROOT = Path(__file__).resolve().parents[2]


class AuditTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "artifacts").mkdir(exist_ok=True)
        self.workspace = tempfile.TemporaryDirectory(prefix="impact-test-", dir=ROOT / "artifacts")
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)

    def command(self, *arguments):
        return subprocess.run(arguments, cwd=self.root, capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, subject):
        self.command("git", "add", ".")
        self.command("git", "-c", "user.name=Audit Test", "-c", "user.email=audit@example.invalid",
                     "-c", "commit.gpgsign=false", "commit", "-m", subject)
        return self.command("git", "rev-parse", "HEAD")

    def test_wal_snapshot_keeps_runs_but_excludes_metricless_endpoints(self):
        schema = re.search(r"this.database.exec\(`(.*?)`\);", (ROOT / "src/runtime/RuntimeStore.ts").read_text(), re.S)[1]
        path = self.root / "source.sqlite"
        database = sqlite3.connect(path)
        self.addCleanup(database.close)
        database.execute("PRAGMA journal_mode=WAL")
        database.executescript(schema)
        database.execute("INSERT INTO runs VALUES (1, 100, 10, 'rev', 2, 1, 1, 0)")
        database.execute("INSERT INTO module_metrics VALUES (1, 'app', 10, 2, 0.2, 1, 0, 4)")
        database.execute("INSERT INTO module_metrics VALUES (1, 'tools/hyperlint/src', 100, 50, 0.5, 8, 0, 10)")
        database.execute("INSERT INTO runs VALUES (2, 101, 10, 'rev', 0, 0, 0, 0)")
        database.commit()
        evidence = read_ledger(path, self.root / "snapshot.sqlite")
        self.assertEqual(len(evidence["runs"]), 2)
        self.assertEqual(evidence["regular_runs"], 1)
        self.assertEqual(evidence["last"]["id"], 1)
        self.assertEqual(evidence["first"]["owned_metrics"]["public_ratio"], 0.2)
        self.assertEqual(evidence["first"]["public_ratio"], 52 / 110)
        self.assertEqual(database.execute("SELECT count(*) FROM runs").fetchone()[0], 2)
        self.assertEqual(len(json.loads((self.root / "snapshot.json").read_text())["tables"]["runs"]), 2)
        attribute_runs(evidence, {"other"}, {"rev"})
        self.assertIsNone(evidence["project_first"])
        self.assertEqual(evidence["attributions"], {"engine": 2})
        attribute_runs(evidence, {"rev"}, set())
        self.assertEqual(evidence["project_revisions"], 1)
        aggregate_database(self.root, {"projects": [{"root": "consumer", "cohort": "consumer", "ledgers":
                           [evidence, {**evidence, "path": "alternate-ledger.sqlite"}]}]})
        with sqlite3.connect(self.root / "aggregate.sqlite") as aggregate:
            self.assertEqual(aggregate.execute("SELECT count(*) FROM evidence WHERE kind='runs'").fetchone()[0], 4)
            self.assertEqual(aggregate.execute("SELECT count(*) FROM run_attributions WHERE attribution='project'").fetchone()[0], 4)
        aggregate.close()

    def test_development_reuses_read_only_report_without_initializing_store(self):
        (self.root / "artifacts").mkdir()
        (self.root / "scripts").mkdir()
        source = self.root / "artifacts/development.sqlite"
        with sqlite3.connect(source) as database:
            database.execute("CREATE TABLE development_commands (step TEXT, duration_seconds REAL, status TEXT, task_id INTEGER)")
            database.execute("INSERT INTO development_commands VALUES ('architecture', 12, 'passed', NULL)")
        database.close()
        original = source.read_bytes()
        (self.root / "scripts/development_store.py").write_text(
            "class DevelopmentStore:\n"
            "    def __init__(self):\n        raise AssertionError('must not construct writable store')\n"
            "    def report(self):\n        return {'tasks': [], 'commands': [dict(row) for row in self.db.execute('SELECT * FROM development_commands')]}\n")
        evidence = read_development(self.root, self.root / "development-copy.sqlite")
        self.assertEqual(evidence["command_count"], 1)
        self.assertEqual(evidence["complete_effort_tasks"], 0)
        self.assertEqual(evidence["unassigned_commands"], 1)
        self.assertEqual(source.read_bytes(), original)
        self.assertFalse((self.root / "scripts/__pycache__").exists())

    def test_installation_boundary_and_worktree_deduplication(self):
        self.command("git", "init")
        (self.root / "src").mkdir()
        (self.root / "src/app.ts").write_text("export const answer = 42;\n")
        before = self.commit("Build application")
        (self.root / "hyperlinter.project.json").write_text("{}")
        adoption = self.commit("Install architecture checks")
        (self.root / "src/app.ts").write_text("export const answer = 43;\n")
        after = self.commit("Extend application")
        worktree = self.root / "alternate"
        self.command("git", "worktree", "add", "--detach", str(worktree), after)
        evidence = history(self.root)
        self.assertEqual(evidence["adoption"]["id"], adoption)
        self.assertEqual(evidence["pre_window"]["commits"], 1)
        self.assertEqual(evidence["post_window"]["commits"], 1)
        self.assertEqual(evidence["snapshots"]["pre"]["revision"], before)
        inventory = discover([self.root])
        self.assertEqual(len(inventory["projects"]), 1)
        self.assertEqual(len(inventory["projects"][0]["checkouts"]), 2)

    def test_snapshot_excludes_engine_generated_and_declaration_files(self):
        self.command("git", "init")
        for path in ("src/app.ts", "src/index.ts", "tests/app.test.ts", "src/types.d.ts",
                     "dist/app.js", "tools/hyperlint/src/cli.ts"):
            file = self.root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("export { answer } from './app';\n")
        revision = self.commit("Create mixed source tree")
        evidence = snapshot(self.root, revision)
        self.assertEqual(evidence["files"], 3)
        self.assertEqual(evidence["production_files"], 2)
        self.assertEqual(evidence["test_files"], 1)
        self.assertEqual(evidence["reexporting_index_files"], 1)


if __name__ == "__main__":
    unittest.main()
