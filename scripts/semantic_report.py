"""PNG renderer for Hyperlinter's offline --semantic-report command."""
from __future__ import annotations

import json
import argparse
from pathlib import Path

import numpy as np


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
                    colors=[(*to_rgb(color), alpha) for alpha in [0.08, 0.15, 0.23, 0.32, 0.45]])
        ax.contour(x, y, density, levels=density.max() * np.array([0.25, 0.65]),
                   colors=[color], linewidths=0.8, alpha=0.75)
        handles.append(Patch(facecolor=color, label=f"{name} ({len(points):,})", alpha=0.8))
    ax.legend(handles=handles, fontsize=8, loc="upper right")
    ax.set(title=f"Similarity density · all {len(coords):,} functions\nBy code category · PCs explain {data['variance']:.1%}",
           xlabel="Approximate PC1", ylabel="Approximate PC2")


def analyze_index(index, evidence):
    """Render numeric distributions; clustering decisions come directly from Hyperlinter."""
    config = evidence["config"]
    active = index["active"]
    keys = list(dict.fromkeys(fn["hash"] for fn in active))
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
    # Approximate PCA on unique normalized vectors; duplicates do not overweight the map.
    centered = vectors - vectors.mean(axis=0)
    rank = min(12, *centered.shape)
    q, _ = np.linalg.qr(centered @ rng.normal(size=(centered.shape[1], rank)))
    for _ in range(3):
        q, _ = np.linalg.qr(centered @ (centered.T @ q))
    _, singular, axes = np.linalg.svd(q.T @ centered, full_matrices=False)
    coords = np.zeros((len(active), 2))
    projected = (centered @ axes[:2].T)[mapping]
    coords[:, :projected.shape[1]] = projected
    variance = float(np.sum(singular[:2] ** 2) / max(np.sum(centered ** 2), 1e-20))
    return {"active": active, "records": records, "within": within, "cross": cross.tolist(), "coords": coords.tolist(),
            "variance": variance, "funnel": evidence["funnel"],
            "uniqueVectors": len(keys), "model": index["model"], "config": config, "algorithm": evidence["algorithm"]}


def write_overview(data, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.style.use("dark_background")
    fig, axes = plt.subplots(2, 2, figsize=(18, 12), facecolor="#0b1220")
    for ax in axes.flat:
        ax.set_facecolor("#111827")
        ax.spines[["top", "right"]].set_visible(False)
        ax.grid(alpha=0.12)
        ax.set_axisbelow(True)
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
    fig.savefig(path, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description="Render offline Hyperlinter semantic evidence as a PNG.")
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--title", required=True)
    parser.add_argument("--engine-prefix", default=None)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text())
    data = analyze_index(json.loads(args.cache.read_text()), evidence)
    data["title"] = args.title
    data["enginePrefix"] = args.engine_prefix
    args.output.mkdir(parents=True, exist_ok=True)
    write_overview(data, args.output / "overview.png")
    summary = {key: data[key] for key in ["model", "algorithm", "config", "funnel", "variance", "uniqueVectors", "records", "enginePrefix"]}
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
