"""Remove a reviewed reference subspace without changing the embedding cache."""
import numpy as np

from semantic_projection import annotate, project


def remove_components(vectors, mean, axes):
    """Orthogonal deflation of centered vectors; preserve residual magnitudes."""
    centered = np.asarray(vectors, dtype=np.float64) - mean
    basis = axes[np.linalg.norm(axes, axis=1) > 0]
    orthogonal, _ = np.linalg.qr(basis.T)
    residual = centered - (centered @ orthogonal) @ orthogonal.T
    original_variance = float(np.sum((centered - centered.mean(axis=0)) ** 2))
    residual_variance = float(np.sum((residual - residual.mean(axis=0)) ** 2))
    retained = float(np.clip(residual_variance / original_variance, 0, 1)) if original_variance > 1e-20 else 0.0
    leakage = float(np.max(np.abs(residual @ orthogonal))) if orthogonal.size else 0.0
    if retained < 1e-12:
        residual[:] = 0
        retained = 0.0
    return residual, {"retainedVariance": retained, "removedVariance": 1 - retained if original_variance > 1e-20 else 0.0,
                      "maximumRemainingComponent": leakage, "renormalized": False}


def residual_view(vectors, mapping, model, reference, projection, residual_reference=None, annotations=None):
    """Fit new PCs after deflation, bound to the exact removed reference basis."""
    with np.load(reference, allow_pickle=False) as saved:
        residual, removal = remove_components(vectors, saved["mean"], saved["axes"])
    available = removal["retainedVariance"] > 0
    coords, metadata = (project(residual, f'{model}:residual:{projection["id"]}', residual_reference)
                        if available else (np.zeros((len(vectors), 2)), {"axisVariance": [0, 0]}))
    labels = ["Residual PC1", "Residual PC2"]
    displayed, labels = annotate(coords[mapping], metadata, annotations, "residual", labels) if available else (coords[mapping], labels)
    return {**removal, "available": available, "removedProjectionId": projection["id"],
            "projection": metadata, "coords": displayed.tolist(),
            "variance": sum(metadata["axisVariance"]), "axisLabels": labels}
