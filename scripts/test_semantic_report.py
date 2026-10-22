"""Numerical and rendering regressions; run through manage.py test-semantic-report."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from semantic_report import analyze_index, density_surface, family, write_overview
from semantic_projection import annotate, project, samples
from semantic_residual import remove_components, residual_view


class ReportTests(unittest.TestCase):
    def test_deflation_removes_both_components_without_renormalizing(self):
        vectors = np.array([[1., 2., 3.], [3., 4., 5.], [-1., -2., -3.]])
        mean = vectors.mean(axis=0)
        axes = np.array([[1., 0., 0.], [0., 1., 0.]])
        residual, removal = remove_components(vectors, mean, axes)
        np.testing.assert_allclose(residual @ axes.T, 0, atol=1e-12)
        np.testing.assert_allclose(residual[:, 2], (vectors - mean)[:, 2])
        self.assertFalse(removal["renormalized"])
        self.assertAlmostEqual(removal["retainedVariance"] + removal["removedVariance"], 1)
        self.assertGreater(np.linalg.norm(residual[1]), 1)
        empty, removed = remove_components(vectors[:, :2], mean[:2], np.eye(2))
        np.testing.assert_allclose(empty, 0, atol=1e-12)
        self.assertEqual(removed["retainedVariance"], 0)
        self.assertEqual(removed["removedVariance"], 1)
        _, constant = remove_components(np.ones((2, 3)), np.ones(3), axes)
        self.assertEqual(constant["removedVariance"], 0)

    def test_residual_projection_reuses_its_basis_and_stays_outside_removed_subspace(self):
        rng = np.random.default_rng(7)
        vectors = rng.normal(size=(25, 6))
        vectors /= np.linalg.norm(vectors, axis=1)[:, None]
        artifacts = Path(__file__).resolve().parents[1] / "artifacts"
        artifacts.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=artifacts, prefix="residual-") as directory:
            reference = Path(directory) / "reference.npz"
            remaining = Path(directory) / "remaining.npz"
            _, original = project(vectors, "model", reference)
            result = residual_view(vectors, np.arange(len(vectors)), "model", reference, original, remaining)
            repeated = residual_view(vectors, np.arange(len(vectors)), "model", reference, original, remaining)
            np.testing.assert_allclose(result["coords"], repeated["coords"])
            self.assertEqual(result["removedProjectionId"], original["id"])
            self.assertLess(result["maximumRemainingComponent"], 1e-12)
            with np.load(reference) as source, np.load(remaining) as target:
                np.testing.assert_allclose(source["axes"] @ target["axes"].T, 0, atol=1e-12)
            self.assertTrue(result["available"])

    def test_reference_basis_preserves_coordinates_when_the_corpus_changes(self):
        vectors = np.array([[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]])
        artifacts = Path(__file__).resolve().parents[1] / "artifacts"
        artifacts.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=artifacts, prefix="projection-") as directory:
            reference = Path(directory) / "projection.npz"
            single_reference = Path(directory) / "single.npz"
            single, _ = project(vectors[:1], "model", single_reference)
            repeated, _ = project(vectors[:1], "model", single_reference)
            np.testing.assert_allclose(single, repeated)
            before, metadata = project(vectors, "model", reference)
            after, changed = project(np.vstack([vectors, [0.5, 0.5, 0.5]]), "model", reference)
            np.testing.assert_allclose(before, after[:3])
            self.assertEqual(metadata["id"], changed["id"])
            with self.assertRaisesRegex(ValueError, "model/dimensions changed"):
                project(vectors, "different-model", reference)
            annotations = Path(directory) / "axes.json"
            annotations.write_text('{"projectionId":"wrong","axes":[]}')
            with self.assertRaisesRegex(ValueError, "different projection"):
                annotate(before, metadata, annotations)
            import json
            annotations.write_text(json.dumps({"projectionId": metadata["id"], "axes": [
                {"label": "PC1: reviewed direction", "direction": -1}, {"label": "PC2: reviewed direction"}]}))
            labeled, labels = annotate(before, metadata, annotations)
            np.testing.assert_allclose(labeled[:, 0], -before[:, 0])
            np.testing.assert_allclose(labeled[:, 1], before[:, 1])
            self.assertEqual(labels[0], "PC1: reviewed direction")
            # Original and residual interpretations are independently bound to their bases.
            residual_value = {"projectionId": "original", "residual": {
                "projectionId": metadata["id"], "axes": [
                    {"label": "Residual one"}, {"label": "Residual two", "direction": -1}]}}
            annotations.write_text(json.dumps(residual_value))
            reviewed, names = annotate(before, metadata, annotations, "residual", ["Residual PC1", "Residual PC2"])
            np.testing.assert_allclose(reviewed[:, 1], -before[:, 1])
            self.assertEqual(names, ["Residual one", "Residual two"])
            residual_value.pop("residual")
            annotations.write_text(json.dumps(residual_value))
            _, defaults = annotate(before, metadata, annotations, "residual", ["Residual PC1", "Residual PC2"])
            self.assertEqual(defaults, ["Residual PC1", "Residual PC2"])

    def test_canonical_input_order_and_samples_do_not_expose_source(self):
        active = [{"id": str(i), "hash": str(i), "file": f"feature/{i}.ts", "line": 1,
                   "module": "feature", "input": "PRIVATE_BODY"} for i in range(4)]
        index = {"active": active, "vectors": {str(i): row for i, row in enumerate([[1, 0], [0, 1], [-1, 0], [0, -1]])},
                 "model": "fixture"}
        evidence = {"config": {}, "records": [], "funnel": [], "algorithm": "average-linkage"}
        first = analyze_index(index, evidence)
        second = analyze_index({**index, "active": list(reversed(active))}, evidence)
        np.testing.assert_allclose(first["coords"], list(reversed(second["coords"])))
        self.assertEqual(first["projection"]["id"], second["projection"]["id"])
        selected = samples(active, np.asarray(first["coords"]))
        self.assertNotIn("PRIVATE_BODY", str(selected))
        self.assertEqual(len(selected), 2)
        self.assertEqual(selected[0]["bands"][0]["samples"][0]["coordinates"][0], min(row[0] for row in first["coords"]))

    def test_engine_location_and_test_categories_are_preserved(self):
        self.assertEqual(family("src/feature/index.ts", "vendor/lint"), "Application")
        self.assertEqual(family("tests/feature.test.ts", "vendor/lint"), "Application tests")
        self.assertEqual(family("src/feature/index.test.ts", "vendor/lint"), "Application tests")
        self.assertEqual(family("vendor/lint/src/index.ts", "vendor/lint"), "Hyperlinter")
        self.assertEqual(family("vendor/lint/tests/index.ts", "vendor/lint"), "Hyperlinter tests")
        self.assertEqual(family("src/index.ts", "."), "Hyperlinter")
        self.assertEqual(family("src/index.ts", "../external-engine"), "Application")

    def test_density_has_a_peak_and_decays_without_singular_covariance(self):
        axis = np.linspace(-1, 1, 51)
        density = density_surface(np.zeros((8, 2)), axis, axis, 0.1)
        self.assertTrue(np.isfinite(density).all())
        self.assertEqual(np.unravel_index(density.argmax(), density.shape), (25, 25))
        self.assertGreater(density[25, 25], density[0, 0])
        self.assertAlmostEqual(float(density.sum() * (axis[1] - axis[0]) ** 2), 1, places=6)

    def test_single_vector_projection_and_small_clusters_render(self):
        active = [{"id": "one", "hash": "one", "module": "feature", "file": "feature/index.ts", "line": 1}]
        evidence = {"algorithm": "average-linkage", "records": [{"module": "feature", "functions": 1,
            "clusters": [["one"]]}], "funnel": [1, 0, 0, 0], "config": {
            "maximumMergeDistance": 0.25, "minimumClusterDistance": 0.8, "minimumClusterFunctions": 8}}
        data = analyze_index({"active": active, "vectors": {"one": [1]}, "model": "fixture"}, evidence)
        self.assertEqual(data["coords"], [[0, 0]])
        self.assertEqual(data["cross"], [])
        self.assertEqual(data["within"], [])
        data["title"] = "Portable project"
        artifacts = Path(__file__).resolve().parents[1] / "artifacts"
        artifacts.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=artifacts, prefix="report-render-") as directory:
            output = Path(directory) / "overview.png"
            write_overview(data, output)
            self.assertEqual(output.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")


if __name__ == "__main__":
    unittest.main()
