"""Reproduce the generation-limit sensitivity chart from current compiler evidence."""
import csv
import json
import os
import subprocess
import sys
from pathlib import Path


def plot_call_gaps(root: Path):
    os.environ.setdefault("MPLCONFIGDIR", str(root / "runtime/matplotlib"))
    sys.path.insert(0, str(root / "runtime/plot-deps"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import MaxNLocator

    result = subprocess.run(
        ["node", "--import", "tsx", "scripts/call_gap_report.ts"],
        cwd=root, check=True, capture_output=True, text=True,
    )
    report = json.loads(result.stdout)
    output = root / "artifacts/call-generation-limits"
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    rows = [row for row in report["limits"] if row["limit"] >= 1]
    with (output / "violations.csv").open("w") as file:
        writer = csv.DictWriter(file, fieldnames=["limit", "violations", "source", "tests"])
        writer.writeheader()
        writer.writerows(rows)
    fig, ax = plt.subplots(figsize=(11, 6), layout="constrained")
    limits = [row["limit"] for row in rows]
    for key, label, color in [("violations", "All configured TypeScript", "#2563eb"),
                              ("source", "Source callers", "#059669"),
                              ("tests", "Test callers", "#d97706")]:
        ax.plot(limits, [row[key] for row in rows], marker="o", label=label, color=color, linewidth=2)
    for row in rows:
        ax.annotate(str(row["violations"]), (row["limit"], row["violations"]),
                    xytext=(0, 9), textcoords="offset points", ha="center", fontsize=9)
    ax.set(title="Hyperlinter: violations by generation-gap limit",
           xlabel="Maximum permitted generation gap (violation when gap > limit)",
           ylabel="Violating caller/callee pairs", xticks=limits, ylim=(-5, rows[0]["violations"] * 1.12))
    ax.yaxis.set_major_locator(MaxNLocator(integer=True))
    ax.grid(axis="y", alpha=0.2)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend()
    fig.suptitle(f"Current working tree · {report['functions']} functions · {report['totalEdges']} resolved call edges · "
                 f"{report['excludedEdges']} edges excluded for undefined generations", fontsize=10, color="#475569")
    for extension in ("png", "svg"):
        fig.savefig(output / f"violations.{extension}", dpi=170)
    plt.close(fig)
    print(json.dumps(report, indent=2))
    print(f"Chart: {output / 'violations.png'}")
