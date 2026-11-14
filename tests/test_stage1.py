import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend.app.main import app

class TestStage1Setup(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_original_backup_exists(self):
        backup = Path("frontend/original/index.html")
        self.assertTrue(backup.exists(), "Original index.html must be backed up at frontend/original/index.html")

    def test_homepage_serves_html(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response.headers.get("content-type", ""))
        self.assertIn("BELIMO", response.text)
        self.assertIn("Collia", response.text)
        self.assertIn("System Builder", response.text)
        self.assertIn("data/csv/", response.text)

    def test_health_check_endpoint(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "healthy")
        self.assertEqual(data.get("service"), "BELIMO | Collia")

if __name__ == "__main__":
    unittest.main()
