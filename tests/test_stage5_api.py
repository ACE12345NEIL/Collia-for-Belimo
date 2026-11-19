"""
Stage 5 — CSV Extraction and Data Validation: API Endpoint Integration Tests
=============================================================================
Tests:
  - POST /api/extraction/run
  - GET  /api/extraction/summary
  - GET  /api/extraction/equipment/{id}
  - GET  /api/extraction/equipment/{invalid_id} -> 404
"""

import unittest
from fastapi.testclient import TestClient
from backend.app.main import app


class TestExtractionAPI(unittest.TestCase):
    """Integration tests for the /api/extraction router using FastAPI TestClient."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_run_extraction_endpoint(self):
        """POST /api/extraction/run should return 200 with ExtractionReport."""
        resp = self.client.post("/api/extraction/run")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("extracted_at", data)
        self.assertIn("total_equipment", data)
        self.assertIn("equipment_results", data)
        self.assertGreater(data["total_equipment"], 0)

    def test_extraction_summary_endpoint(self):
        """GET /api/extraction/summary should return 200 with summary list."""
        resp = self.client.get("/api/extraction/summary")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("total_equipment", data)
        self.assertIn("equipment", data)
        self.assertIsInstance(data["equipment"], list)

    def test_extract_single_equipment_valid(self):
        """GET /api/extraction/equipment/{valid_id} should return 200."""
        summary_resp = self.client.get("/api/extraction/summary")
        data = summary_resp.json()
        if data["equipment"]:
            eq_id = data["equipment"][0]["equipment_id"]
            resp = self.client.get(f"/api/extraction/equipment/{eq_id}")
            self.assertEqual(resp.status_code, 200)
            eq_data = resp.json()
            self.assertEqual(eq_data["equipment_id"], eq_id)
            self.assertIn("quality", eq_data)
            self.assertIn("latest_readings", eq_data)

    def test_extract_single_equipment_not_found(self):
        """GET /api/extraction/equipment/nonexistent_id should return 404."""
        resp = self.client.get("/api/extraction/equipment/eq_nonexistent_xyz_999")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
