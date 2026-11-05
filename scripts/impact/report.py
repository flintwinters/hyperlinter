"""Portable aggregate exports and a human-readable local evidence report."""
import csv
import collections
import html
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from .evidence import owned_metric_totals
from .history import git


def project_rows(report):
    rows = []
    for p in report["projects"]:
        history = p.get("history", {})
        snapshots = history.get("snapshots", {})
        before = snapshots.get("pre", snapshots.get("adoption", {}))
        after = snapshots.get("head", {})
        runs = [r for ledger in p["ledgers"] for r in ledger["runs"]]
        attributed = sorted([r for r in runs if r.get("attribution") == "project" and r["metric_modules"]],
                            key=lambda r: (r["started_at"], r["id"]))
        first = attributed[0] if attributed else {}
        last = attributed[-1] if attributed else {}
        first_metrics = first.get("owned_metrics", first)
        last_metrics = last.get("owned_metrics", last)
        rows.append({"project": p["root"], "cohort": p["cohort"], "ledger_runs": len(runs),
                     "attributed_regular_runs": len(attributed),
                     "attributed_revisions": len({r["revision"] for r in attributed}),
                     "post_adoption_commits": max(0, history.get("all_post", {}).get("commits", 0) - 1),
                     "files_before": before.get("production_files"), "files_after": after.get("production_files"),
                     "lines_before": before.get("production_nonempty_lines"), "lines_after": after.get("production_nonempty_lines"),
                     "indices_before": before.get("index_files"), "indices_after": after.get("index_files"),
                     "median_lines_before": before.get("median_production_file_lines"),
                     "median_lines_after": after.get("median_production_file_lines"),
                     "tiny_before": before.get("tiny_production_files_le20"), "tiny_after": after.get("tiny_production_files_le20"),
                     "edit_breadth_before": history.get("pre_window", {}).get("median_files_per_source_commit"),
                     "edit_breadth_after": history.get("post_window", {}).get("median_files_per_source_commit"),
                     "diagnostics_first": first.get("diagnostics"), "diagnostics_last": last.get("diagnostics"),
                     "public_ratio_first": first_metrics.get("public_ratio"), "public_ratio_last": last_metrics.get("public_ratio"),
                     "max_dependencies_first": first_metrics.get("max_dependencies"), "max_dependencies_last": last_metrics.get("max_dependencies"),
                     "modules_first": first_metrics.get("metric_modules"), "modules_last": last_metrics.get("metric_modules"),
                     "declarations_first": first_metrics.get("declarations"), "declarations_last": last_metrics.get("declarations"),
                     "cross_references_first": first_metrics.get("cross_references"), "cross_references_last": last_metrics.get("cross_references"),
                     "duration_ms_first": first.get("duration_ms"), "duration_ms_last": last.get("duration_ms")})
    return rows


def aggregate_database(output, report):
    # Every raw row retains its source namespace; local run IDs are not global IDs.
    with closing(sqlite3.connect(output / "aggregate.sqlite")) as db:
        db.executescript("""DROP TABLE IF EXISTS evidence; DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS run_attributions;
            CREATE TABLE projects (root TEXT PRIMARY KEY, cohort TEXT, summary_json TEXT);
            CREATE TABLE evidence (project TEXT, source TEXT, kind TEXT, run_id INTEGER, payload_json TEXT);
            CREATE TABLE run_attributions (project TEXT, source TEXT, run_id INTEGER, attribution TEXT, regular INTEGER,
                PRIMARY KEY (project, source, run_id));
            CREATE INDEX evidence_lookup ON evidence(project, kind, source, run_id);""")
        for project in report["projects"]:
            db.execute("INSERT INTO projects VALUES (?, ?, ?)",
                       (project["root"], project["cohort"], json.dumps(project)))
            for ledger in project["ledgers"]:
                db.executemany("INSERT INTO run_attributions VALUES (?, ?, ?, ?, ?)",
                               [(project["root"], ledger["path"], r["id"], r.get("attribution", "unresolved"),
                                 bool(r["metric_modules"])) for r in ledger["runs"]])
                raw = json.loads(Path(ledger["snapshot"]).with_suffix(".json").read_text())
                for kind, values in raw["tables"].items():
                    for row in values:
                        db.execute("INSERT INTO evidence VALUES (?, ?, ?, ?, ?)",
                                   (project["root"], ledger["path"], kind, row.get("run_id", row.get("id")), json.dumps(row)))
            development = project.get("development")
            if development:
                raw = json.loads(Path(development["snapshot"]).with_suffix(".json").read_text())
                for kind in ("tasks", "commands"):
                    for row in raw[kind]:
                        db.execute("INSERT INTO evidence VALUES (?, ?, ?, ?, ?)",
                                   (project["root"], development["path"], "development_" + kind, None, json.dumps(row)))
        db.commit()


def table(headers, rows):
    def cell(value):
        if value is None:
            return "unknown"
        return html.escape(str(round(value, 2) if isinstance(value, float) else value))
    return "<table><thead><tr>" + "".join(f"<th>{cell(h)}</th>" for h in headers) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join(f"<td>{cell(v)}</td>" for v in row) + "</tr>" for row in rows) + "</tbody></table>"


def render(output: Path):
    report = json.loads((output / "report.json").read_text())
    report["inventory"] = json.loads((output / "inventory.json").read_text())
    # Recompute derived scope totals from preserved exports, without rerunning
    # consumers or refreshing their source databases.
    for project in report["projects"]:
        for ledger in project["ledgers"]:
            raw = json.loads(Path(ledger["snapshot"]).with_suffix(".json").read_text())
            metrics = collections.defaultdict(list)
            for row in raw["tables"].get("module_metrics", []):
                metrics[row["run_id"]].append(row)
            runs = {run["id"]: run for run in ledger["runs"]}
            for run in runs.values():
                run["owned_metrics"] = owned_metric_totals(metrics[run["id"]])
            for key in ("first", "last", "project_first", "project_last"):
                if ledger.get(key):
                    ledger[key] = runs[ledger[key]["id"]]
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    rows = project_rows(report)
    if not rows:
        raise ValueError("No projects found in the requested scope")
    with (output / "summary.csv").open("w") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    aggregate_database(output, report)
    consumers = [row for row in rows if row["cohort"] == "consumer"]
    reviewed = output / "reviewed-findings.json"
    findings = json.loads(reviewed.read_text()) if reviewed.exists() else {}
    for index, finding in enumerate(findings.get("findings", [])):
        for commit in finding.get("commits", []):
            evidence = git(Path(finding["root"]), "show", "--format=fuller", "--stat", commit)
            (output / f"case-{index}-{commit}.txt").write_text(evidence + "\n")
    escape = html.escape
    sections = ["<h1>Does Hyperlinter help these projects?</h1>",
                f"<p>Collected {escape(report['generated_at'])}. {len(consumers)} consumer projects and engine self-hosting are separate cohorts.</p>",
                "<p>" + escape(findings.get("verdict", "Observed structural changes do not by themselves establish net maintainability or extensibility benefits.")) + "</p>",
                "<p><a href='report.json'>Full JSON</a> · <a href='aggregate.sqlite'>Combined SQLite evidence</a> · "
                "<a href='summary.csv'>Summary CSV</a> · <a href='inventory.json'>Census and exclusions</a></p>",
                "<h2>Consumer coverage</h2>", table(["Project", "Recorded runs", "Attributed regular runs", "Distinct revisions", "Commits after adoption"],
                [[Path(r["project"]).name, r["ledger_runs"], r["attributed_regular_runs"], r["attributed_revisions"], r["post_adoption_commits"]] for r in consumers]),
                "<p>Repeated runs are not independent observations. Attribution means the recorded revision is reachable in a project checkout; it does not prove which dirty source was analyzed.</p>",
                "<h2>Committed structure before installation → current HEAD</h2>",
                table(["Project", "JS/TS production files", "Nonempty lines", "Median file lines", "Files ≤20 lines", "Index files", "Median edited files per source commit"],
                      [[Path(r["project"]).name] + [f'{r[a]} → {r[b]}' for a, b in
                         [("files_before", "files_after"), ("lines_before", "lines_after"),
                          ("median_lines_before", "median_lines_after"), ("tiny_before", "tiny_after"),
                          ("indices_before", "indices_after"), ("edit_breadth_before", "edit_breadth_after")]] for r in consumers]),
                "<p>Common generated output directories are excluded. Checked-in JS bundles outside those directories remain and can dominate churn, especially in AI Triage. Directory/file growth is a fragmentation signal, not proof of harm; task scope and new features also change these numbers. Change breadth uses up to 30 first-parent commits each side, excluding installation.</p>",
                "<h2>Recorded lint endpoints (descriptive, changing instruments)</h2>",
                table(["Project", "Diagnostics", "Public / declarations", "Max module dependencies", "Metric modules", "Run duration ms"],
                      [[Path(r["project"]).name] + [f'{r[a]} → {r[b]}' for a, b in
                         [("diagnostics_first", "diagnostics_last"), ("public_ratio_first", "public_ratio_last"),
                          ("max_dependencies_first", "max_dependencies_last"), ("modules_first", "modules_last"),
                          ("duration_ms_first", "duration_ms_last")]] for r in consumers]),
                "<p>These are first/last revision-attributed runs with module metrics. Structural totals exclude modules explicitly under tools/hyperlint; raw diagnostics can still include that engine source when consumers analyze it. Engine/config/baseline provenance and dirty-tree identity are absent in these ledgers. Treat apparent improvements as hypotheses; do not pool diagnostic counts into a success score. Zero exports in script-based frontends does not establish strong encapsulation.</p>"]
    for finding in findings.get("findings", []):
        sections.extend([f"<h2>{escape(finding['project'])}: {escape(finding['assessment'])}</h2>",
                         "<p>" + escape(finding["detail"]) + "</p>",
                         "<p>Evidence: " + escape("; ".join(finding.get("evidence", []))) + "</p>"])
    for p in report["projects"]:
        development = p.get("development")
        if development:
            sections.extend([f"<h2>{escape(Path(p['root']).name)} independent development outcomes</h2>",
                             table(["Tasks", "Completed", "Completed with full effort", "Check steps", "Unassigned steps", "Recorded step wall hours"],
                                   [[len(development["tasks"]), development["completed_tasks"], development["complete_effort_tasks"],
                                     development["command_count"], development["unassigned_commands"], development["command_wall_seconds"] / 3600]]),
                             table(["Step", "Runs", "Wall minutes", "Statuses"],
                                   [[s["step"], s["count"], s["wall_seconds"] / 60, s["statuses"]] for s in development["steps"]]),
                             "<p>Wall time is check execution, not human effort. Command steps can overlap; their sum is not elapsed project time. Missing effort is unknown. The consumer's existing report logic was reused on a private snapshot; the adapter and full export accompany the database.</p>"])
    sections.extend(["<h2>Engine self-hosting (excluded from consumer conclusions)</h2>",
                     table(["Project", "Runs", "Production files", "Nonempty lines"],
                           [[Path(r["project"]).name, r["ledger_runs"], f'{r["files_before"]} → {r["files_after"]}',
                             f'{r["lines_before"]} → {r["lines_after"]}'] for r in rows if r["cohort"] == "engine"]),
                     "<h2>Limits and next evidence</h2>"])
    sections.extend(f"<p>{escape(v)}</p>" for v in report["limitations"] + report["inventory"].get("scope_notes", []) + report["inventory"]["errors"])
    sections.extend(f"<p>{escape(v)}</p>" for v in findings.get("next_steps", []))
    document = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Hyperlinter impact audit</title><style>body{font:16px/1.6 system-ui;max-width:1200px;margin:40px auto;padding:0 24px;color:#172033;background:#fbfcff}h1,h2{line-height:1.2}h2{margin-top:2em}table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow:auto}th,td{padding:10px;border:1px solid #d5dce8;text-align:left;vertical-align:top}th{background:#edf2fa}a{color:#174dae}</style>""" + "".join(sections) + "</html>"
    (output / "index.html").write_text(document)
    return rows
