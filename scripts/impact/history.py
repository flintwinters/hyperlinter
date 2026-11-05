"""Pinned Git observations independent of Hyperlinter's changing rule scores."""
import collections
import re
import statistics
import subprocess
from pathlib import Path, PurePosixPath

EXCLUDED = {"node_modules", "vendor", "dist", "build", "coverage", "artifacts", "runtime", ".venv"}
EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}


def git(root, *arguments, binary=False):
    result = subprocess.run(["git", "--no-optional-locks", "-C", str(root), *arguments],
                            capture_output=True, timeout=120)
    if result.returncode:
        raise ValueError(result.stderr.decode(errors="replace").strip())
    return result.stdout if binary else result.stdout.decode(errors="replace").strip()


def authored(path):
    parts = PurePosixPath(path).parts
    return (PurePosixPath(path).suffix in EXTENSIONS and not set(parts) & EXCLUDED
            and not path.endswith(".d.ts") and "tools/hyperlint/" not in path)


def snapshot(root, revision):
    entries = []
    for record in git(root, "ls-tree", "-r", "-l", "-z", revision, binary=True).split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        mode, kind, oid, size = metadata.split()
        path = raw_path.decode(errors="replace")
        if kind == b"blob" and authored(path):
            entries.append((path, oid))
    data = b"" if not entries else subprocess.run(
        ["git", "--no-optional-locks", "-C", str(root), "cat-file", "--batch"],
        input=b"\n".join(oid for _, oid in entries) + b"\n", capture_output=True,
        check=True, timeout=120).stdout
    offset = 0
    files = []
    for path, _ in entries:
        end = data.index(b"\n", offset)
        size = int(data[offset:end].split()[-1])
        content = data[end + 1:end + 1 + size].decode(errors="replace")
        offset = end + size + 2
        lines = [line for line in content.splitlines() if line.strip()]
        files.append({"path": path, "lines": len(lines),
                      "test": bool(re.search(r"(^|/)(tests?|__tests__)/|\.(test|spec)\.", path)),
                      "index": PurePosixPath(path).stem == "index",
                      "reexport": bool(re.search(r"\bexport\b[^;]*\bfrom\s*['\"]", content))})
    production = [f for f in files if not f["test"]]
    typescript = [f for f in production if PurePosixPath(f["path"]).suffix in {".ts", ".tsx"}]
    return {"revision": revision, "files": len(files), "production_files": len(production),
            "test_files": len(files) - len(production), "nonempty_lines": sum(f["lines"] for f in files),
            "production_nonempty_lines": sum(f["lines"] for f in production),
            "median_production_file_lines": statistics.median(f["lines"] for f in production) if production else None,
            "tiny_production_files_le20": sum(f["lines"] <= 20 for f in production),
            "index_files": sum(f["index"] for f in production),
            "reexporting_index_files": sum(f["index"] and f["reexport"] for f in production),
            "directories": len({str(PurePosixPath(f["path"]).parent) for f in production}),
            "typescript": {"files": len(typescript), "nonempty_lines": sum(f["lines"] for f in typescript),
                           "median_lines": statistics.median(f["lines"] for f in typescript) if typescript else None,
                           "tiny_files_le20": sum(f["lines"] <= 20 for f in typescript),
                           "index_files": sum(f["index"] for f in typescript),
                           "directories": len({str(PurePosixPath(f["path"]).parent) for f in typescript})},
            "inventory": files}


def changes(root, commit):
    records = git(root, "show", "--first-parent", "--format=", "--no-renames", "--numstat", "-z", commit, binary=True)
    files = []
    for record in records.split(b"\0"):
        if not record:
            continue
        added, deleted, path = record.decode(errors="replace").split("\t", 2)
        if authored(path):
            files.append({"path": path, "added": int(added) if added.isdigit() else 0,
                          "deleted": int(deleted) if deleted.isdigit() else 0})
    return files


def summarize(commits):
    active = [c for c in commits if c["changes"]]
    touched = collections.Counter(f["path"] for c in active for f in c["changes"])
    return {"commits": len(commits), "source_commits": len(active),
            "median_files_per_source_commit": statistics.median(len(c["changes"]) for c in active) if active else None,
            "median_directories_per_source_commit": statistics.median(len({str(PurePosixPath(f["path"]).parent) for f in c["changes"]}) for c in active) if active else None,
            "added": sum(f["added"] for c in active for f in c["changes"]),
            "deleted": sum(f["deleted"] for c in active for f in c["changes"]),
            "hotspots": touched.most_common(10),
            "explicit_hyperlint_subjects": sum(bool(re.search("hyperlint|HL[0-9]{3}", c["subject"], re.I)) for c in commits)}


def history(root: Path, engine=False):
    head = git(root, "rev-parse", "HEAD")
    log = git(root, "log", "--first-parent", "--reverse", "--format=%H%x09%ct%x09%s", head)
    commits = [dict(zip(("id", "timestamp", "subject"), line.split("\t", 2))) for line in log.splitlines()]
    # Current lineage only. An installation is anchored to an added gitlink/config,
    # not the first commit that happens to mention the tool in its message.
    markers = git(root, "log", "--first-parent", "--reverse", "--diff-filter=A", "--format=%H", head,
                  "--", "tools/hyperlint", "hyperlinter.config.json", "hyperlinter.project.json").splitlines()
    adoption = markers[0] if markers else None
    index = next((i for i, c in enumerate(commits) if c["id"] == adoption), None)
    if engine:
        index = 0  # Engine is a separate cohort, never a pre/post adoption consumer.
        adoption = commits[0]["id"] if commits else None
    if index is None:
        return {"head": head, "adoption": None, "limitation": "No tracked installation marker on first-parent lineage"}
    pre = commits[max(0, index - 30):index]
    post = commits[index + 1:index + 31]
    all_post = commits[index:]
    chosen = {c["id"]: c for c in pre + post + all_post}
    for c in chosen.values():
        c["timestamp"] = int(c["timestamp"])
        c["changes"] = changes(root, c["id"])
    prior = commits[index - 1]["id"] if index else None
    return {"head": head, "dirty": git(root, "status", "--porcelain", "--untracked-files=no"),
            "shallow": git(root, "rev-parse", "--is-shallow-repository") == "true",
            "adoption": {k: v for k, v in commits[index].items() if k != "changes"},
            "pre_window": summarize(pre), "post_window": summarize(post),
            "all_post": summarize(all_post), "commits": list(chosen.values()),
            "snapshots": {label: snapshot(root, revision) for label, revision in
                          [("pre", prior), ("adoption", adoption), ("head", head)] if revision}}
