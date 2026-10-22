"""Stable reference PCA and source-location samples for human axis interpretation."""
import hashlib
import json

import numpy as np


def project(vectors, model, reference=None):
    """Fit once in canonical input order, then reuse the same basis and origin."""
    centered = vectors - vectors.mean(axis=0)
    if reference is not None and reference.exists():
        with np.load(reference, allow_pickle=False) as saved:
            if str(saved["model"]) != model or saved["mean"].shape != (vectors.shape[1],):
                raise ValueError("Projection model/dimensions changed; archive the reference projection and review new axes.")
            mean, axes = saved["mean"], saved["axes"]
            if (axes.shape != (2, vectors.shape[1]) or not np.isfinite(axes).all() or not np.isfinite(mean).all()
                    or not np.allclose(axes @ axes.T, np.diag([1, int(np.any(axes[1]))]), atol=1e-5)):
                raise ValueError("Invalid reference projection.")
    else:
        mean = vectors.mean(axis=0)
        rng = np.random.default_rng(116)
        rank = min(12, *centered.shape)
        q, _ = np.linalg.qr(centered @ rng.normal(size=(centered.shape[1], rank)))
        for _ in range(3):
            q, _ = np.linalg.qr(centered @ (centered.T @ q))
        _, _, fitted = np.linalg.svd(q.T @ centered, full_matrices=False)
        axes = np.zeros((2, vectors.shape[1]))
        axes[:min(2, len(fitted))] = fitted[:2]
        # SVD signs are arbitrary: make the largest absolute loading positive.
        for axis in axes:
            if axis[np.argmax(np.abs(axis))] < 0:
                axis *= -1
        if reference is not None:
            reference.parent.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(reference, model=model, mean=mean, axes=axes)
    identity = hashlib.sha256(model.encode() + mean.tobytes() + axes.tobytes()).hexdigest()
    variance = np.sum((centered @ axes.T) ** 2, axis=0) / max(float(np.sum(centered ** 2)), 1e-20)
    return (vectors - mean) @ axes.T, {"id": identity, "kind": "reference PCA", "axisVariance": variance.tolist()}


def annotate(coords, projection, file=None):
    """Human interpretations belong to the target project and one reviewed basis."""
    if file is None or not file.exists():
        return coords, ["Reference PC1", "Reference PC2"]
    value = json.loads(file.read_text())
    if not isinstance(value, dict):
        raise ValueError("Axis annotations must be a JSON object.")
    if value.get("projectionId") != projection["id"]:
        raise ValueError("Axis annotations refer to a different projection; review samples before relabeling.")
    axes = value.get("axes", [])
    if not isinstance(axes, list) or len(axes) != 2 or any(not isinstance(axis, dict) or not isinstance(axis.get("label"), str) or not axis["label"].strip()
                             or type(axis.get("direction", 1)) is not int or axis.get("direction", 1) not in (-1, 1) for axis in axes):
        raise ValueError("Axis annotations require two labels and directions of +1 or -1.")
    projection["annotations"] = value
    return coords * [axis.get("direction", 1) for axis in axes], [axis["label"] for axis in axes]


def samples(active, coords):
    """Diverse files near each axis's tails and center; locations only, no source."""
    result = []
    for axis in range(2):
        values = coords[:, axis]
        bands = []
        for quantile in [0, 0.1, 0.5, 0.9, 1]:
            target = np.quantile(values, quantile)
            selected, files = [], set()
            for i in np.argsort(np.abs(values - target), kind="stable"):
                fn = active[i]
                if fn["file"] in files:
                    continue
                files.add(fn["file"])
                selected.append({key: fn[key] for key in ["id", "hash", "file", "line", "module"]}
                                | {"coordinates": coords[i].tolist()})
                if len(selected) == 4:
                    break
            bands.append({"quantile": quantile, "samples": selected})
        result.append({"axis": axis + 1, "bands": bands})
    return result
