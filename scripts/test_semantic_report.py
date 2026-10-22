"""Numerical and rendering regressions; run through manage.py test-semantic-report."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from semantic_report import analyze_index, density_surface, family, write_overview


class ReportTests(unittest.TestCase):
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
        active = [{"id": "one", "hash": "one", "module": "feature"}]
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
