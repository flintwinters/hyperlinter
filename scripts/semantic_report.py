"""PNG renderer for Hyperlinter's offline --semantic-report command."""
from __future__ import annotations

import json
import argparse
from pathlib import Path

import numpy as np

from semantic_projection import annotate, project, samples
from semantic_residual import residual_view


COLORS = {"Application": "#56b4e9", "Application tests": "#e69f00", "Project tooling": "#009e73",
          "Hyperlinter": "#cc79a7", "Hyperlinter tests": "#f0e442"}


def family(file, engine_prefix=None):
    """Classify host and engine code without assuming where Hyperlinter is installed."""
    file = file.replace("\\", "/")
    engine = engine_prefix == "." or bool(engine_prefix and file.startswith(engine_prefix.rstrip("/") + "/"))
    relative = file if not engine or engine_prefix == "." else file[len(engine_prefix) + 1:]
    parts = relative.split("/")
    tests = any(part in {"test", "tests", "__tests__"} for part in parts) or ".test." in relative or ".spec." in relative
    if engine:
        return "Hyperlinter tests" if tests else "Hyperlinter"
    if tests:
        return "Application tests"
    return "Project tooling" if parts[0] in {"scripts", "tools"} else "Application"


def density_surface(points, x, y, bandwidth):
    """Isotropic Gaussian KDE; chunking bounds memory for large clusters."""
    grid_x, grid_y = np.meshgrid(x, y)
    density = np.zeros_like(grid_x)
    for start in range(0, len(points), 64):
        chunk = points[start:start + 64]
        squared = (grid_x[..., None] - chunk[:, 0]) ** 2 + (grid_y[..., None] - chunk[:, 1]) ** 2
        density += np.exp(-squared / (2 * bandwidth ** 2)).sum(axis=2)
    return density / (len(points) * 2 * np.pi * bandwidth ** 2)


def category_topography(ax, data):
    """Readable category densities over every function, independent of HL116 size gates."""
    coords = np.asarray(data["coords"])
    span = max(float(np.ptp(coords, axis=0).max()), 0.1)
    categories = [family(fn.get("file", fn["module"]), data.get("enginePrefix")) for fn in data["active"]]
    from matplotlib.colors import to_rgb
    from matplotlib.patches import Patch
    handles = []
    for name, color in COLORS.items():
        mask = np.array([category == name for category in categories])
        if not mask.any():
            continue
        points = coords[mask]
        bandwidth = max(float(np.std(points, axis=0).mean()) * len(points) ** (-1 / 6), span * 0.018)
        low, high = points.min(axis=0) - 3 * bandwidth, points.max(axis=0) + 3 * bandwidth
        x, y = np.linspace(low[0], high[0], 120), np.linspace(low[1], high[1], 120)
        density = density_surface(points, x, y, bandwidth)
        levels = density.max() * np.array([0.1, 0.3, 0.5, 0.7, 0.9, 1.001])
        ax.contourf(x, y, density, levels=levels,
                    colors=[(*to_rgb(color), alpha) for alpha in [0.03, 0.05, 0.075, 0.10, 0.14]], zorder=1)
        ax.contour(x, y, density, levels=density.max() * np.array([0.25, 0.65]),
                   colors=[color], linewidths=1.6, alpha=0.95, zorder=3)
        handles.append(Patch(facecolor=color, label=f"{name} ({len(points):,})", alpha=0.8))
    ax.legend(handles=handles, fontsize=8, loc="upper right")
    ax.set(title=f"Similarity density · all {len(coords):,} functions\nBy code category · Reference axes capture {data['variance']:.1%}",
           xlabel=data["axisLabels"][0], ylabel=data["axisLabels"][1])


def analyze_index(index, evidence, reference=None, annotations=None, residual_reference=None):
    """Render numeric distributions; clustering decisions come directly from Hyperlinter."""
    config = evidence["config"]
    active = index["active"]
    keys = sorted({fn["hash"] for fn in active})
    vectors = np.asarray([index["vectors"][key] for key in keys], dtype=np.float32)
    if vectors.ndim != 2 or not np.isfinite(vectors).all():
        raise ValueError("Embedding vectors must be a finite matrix.")
    norms = np.linalg.norm(vectors, axis=1)
    if np.any(norms == 0):
        raise ValueError("Zero-length embedding vector.")
    vectors /= norms[:, None]
    positions = {key: i for i, key in enumerate(keys)}
    mapping = np.array([positions[fn["hash"]] for fn in active])
    modules = {}
    for i, fn in enumerate(active):
        modules.setdefault(fn["module"], []).append(i)
    records, within = evidence["records"], []
    rng = np.random.default_rng(116)
    for module, members in modules.items():
        values = vectors[mapping[members]]
        distances = np.clip(1 - values @ values.T, 0, 2)
        pairs = distances[np.triu_indices(len(members), 1)]
        if len(pairs):
            within.extend(rng.choice(pairs, min(len(pairs), 1500), replace=False).tolist())
    # Reproducible sample of cross-module pairs, measured in the full vector space.
    left, right = rng.integers(0, len(active), size=(2, 20000))
    keep = np.array([active[a]["module"] != active[b]["module"] for a, b in zip(left, right)])
    left, right = left[keep][:10000], right[keep][:10000]
    cross = np.clip(1 - np.einsum("ij,ij->i", vectors[mapping[left]], vectors[mapping[right]]), 0, 2)
    unique_coords, projection = project(vectors, index["model"], reference)
    coords, labels = annotate(unique_coords[mapping], projection, annotations)
    variance = sum(projection["axisVariance"])
    residual = residual_view(vectors, mapping, index["model"], reference, projection, residual_reference, annotations) if reference else None
    return {"active": active, "records": records, "within": within, "cross": cross.tolist(), "coords": coords.tolist(),
            "variance": variance, "residual": residual, "projection": projection, "axisLabels": labels, "funnel": evidence["funnel"],
            "uniqueVectors": len(keys), "model": index["model"], "config": config, "algorithm": evidence["algorithm"]}


def report_figure(rows, columns, size):
    """One visual style for overview and residual comparison figures."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.style.use("dark_background")
    fig, axes = plt.subplots(rows, columns, figsize=size, facecolor="#0b1220")
    for ax in np.asarray(axes).flat:
        ax.set_facecolor("#111827")
        ax.spines[["top", "right"]].set_visible(False)
        ax.grid(alpha=0.12)
        ax.set_axisbelow(True)
    return fig, axes


def save_figure(fig, path):
    import matplotlib.pyplot as plt
    fig.savefig(path, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)


def write_overview(data, path):
    fig, axes = report_figure(2, 2, (18, 12))
    category_topography(axes[0, 0], data)
    top = sorted(data["records"], key=lambda r: r["functions"])[-12:]
    axes[0, 1].barh([r["module"] for r in top], [r["functions"] for r in top], color=[COLORS[family(r["module"], data.get("enginePrefix"))] for r in top])
    axes[0, 1].tick_params(axis="y", labelsize=8)
    axes[0, 1].set(title="Largest modules by function inventory", xlabel="Functions, including nested callbacks")
    bins = np.linspace(0, 2, 101)
    for values, label, color in [(data["within"], "Within modules", "#56b4e9"), (data["cross"], "Across modules", "#e69f00")]:
        axes[1, 0].hist(values, bins=bins, weights=np.ones(len(values)) * 100 / max(len(values), 1), histtype="step", lw=2, color=color, label=label)
    for value, label in [(data["config"]["maximumMergeDistance"], "Average-link merge cutoff"), (data["config"]["minimumClusterDistance"], "Separation limit")]:
        axes[1, 0].axvline(value, ls="--", alpha=0.7, label=f"{label}: {value}")
    axes[1, 0].legend(fontsize=8)
    axes[1, 0].set(title="Full-space cosine distances · sampled pairs", xlabel="Distance (lower = more similar)", ylabel="Percent of sample per bin")
    sizes = ["Indexed modules", f'≥ {2 * data["config"]["minimumClusterFunctions"]} functions',
             f'≥ 2 clusters of ≥ {data["config"]["minimumClusterFunctions"]}', f'Separation ≥ {data["config"]["minimumClusterDistance"]}']
    axes[1, 1].barh(sizes, data["funnel"], color=["#56b4e9", "#009e73", "#e69f00", "#cc79a7"])
    axes[1, 1].invert_yaxis()
    for i, value in enumerate(data["funnel"]): axes[1, 1].text(value + 1, i, str(value), va="center")
    axes[1, 1].set(title="HL116 gates · average linkage", xlabel="Modules")
    fig.suptitle(f"{data['title']} · Semantic evidence\n{len(data['active']):,} functions · {data['uniqueVectors']:,} unique vectors · {data['model']}", fontsize=19)
    fig.text(0.02, 0.015, "Contours: density by code category, relative to each category peak; these are not HL116 cluster boundaries. HL116 uses full-space distances. Zero warnings ≠ proof of consistency.", fontsize=10, color="#bcc7d9")
    fig.tight_layout(rect=(0.01, 0.04, 0.99, 0.93), h_pad=4, w_pad=3)
    save_figure(fig, path)


def write_residual_comparison(data, path):
    residual = data["residual"]
    fig, axes = report_figure(1, 2, (18, 8))
    category_topography(axes[0], data)
    axes[0].set_title(f"Original reference PCs · {data['variance']:.1%} of original variance")
    if residual["available"]:
        category_topography(axes[1], {**data, **residual})
        axes[1].set_title(f"After removing both reference PCs\nNew axes: {residual['variance']:.1%} of remaining variance "
                          f"({residual['variance'] * residual['retainedVariance']:.1%} of original)")
    else:
        axes[1].text(0.5, 0.5, "No meaningful variance remains after removing both PCs", ha="center", transform=axes[1].transAxes)
    fig.suptitle(f"{data['title']} · Reference PC1 + PC2 removed\n"
                 f"{residual['removedVariance']:.1%} removed · {residual['retainedVariance']:.1%} retained", fontsize=19)
    fig.text(0.02, 0.025, "Centered-vector components subtracted; residuals are not renormalized. "
             "Right-hand axes are fitted to the residual space; any names are sample-based interpretations.\n"
             "Each panel uses its own coordinate scales. Original embeddings, cosine distances and HL116 decisions are unchanged.",
             fontsize=11, color="#bcc7d9")
    fig.tight_layout(rect=(0.01, 0.09, 0.99, 0.90), w_pad=3)
    save_figure(fig, path)


def main():
    parser = argparse.ArgumentParser(description="Render offline Hyperlinter semantic evidence as a PNG.")
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--title", required=True)
    parser.add_argument("--engine-prefix", default=None)
    parser.add_argument("--projection", type=Path)
    parser.add_argument("--annotations", type=Path)
    parser.add_argument("--residual-projection", type=Path)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text())
    data = analyze_index(json.loads(args.cache.read_text()), evidence, args.projection, args.annotations, args.residual_projection)
    data["title"] = args.title
    data["enginePrefix"] = args.engine_prefix
    args.output.mkdir(parents=True, exist_ok=True)
    write_overview(data, args.output / "overview.png")
    if data["residual"] is not None:
        write_residual_comparison(data, args.output / "residual.png")
        residual = data["residual"]
        (args.output / "residual-samples.json").write_text(json.dumps({
            "projection": residual["projection"], "removedProjectionId": residual["removedProjectionId"],
            "labels": residual["axisLabels"], "axes": samples(data["active"], np.asarray(residual["coords"])) if residual["available"] else []}, indent=2))
    summary = {key: data[key] for key in ["model", "algorithm", "config", "funnel", "variance", "uniqueVectors", "records", "enginePrefix", "projection", "axisLabels"]}
    (args.output / "axis-samples.json").write_text(json.dumps({"projection": data["projection"], "labels": data["axisLabels"],
        "axes": samples(data["active"], np.asarray(data["coords"]))}, indent=2))
    summary["residual"] = {key: value for key, value in data["residual"].items() if key != "coords"} if data["residual"] else None
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
