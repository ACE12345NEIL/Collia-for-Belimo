"""
API Endpoint Test Suite for Stage 2 Configuration Persistence.
"""

import unittest
from fastapi.testclient import TestClient
from backend.app.main import app


class TestStage2API(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_get_topology(self):
        response = self.client.get("/api/topology")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("building", data)
        self.assertIn("floors", data)
        self.assertIn("rooms", data)
        self.assertIn("room_equipment", data)
        self.assertIn("shared_equipment", data)
        self.assertIn("relationships", data)

    def test_get_equipment_with_category_filter(self):
        # Room-level
        resp_room = self.client.get("/api/equipment?category=ROOM_LEVEL")
        self.assertEqual(resp_room.status_code, 200)
        items_room = resp_room.json()
        for item in items_room:
            self.assertEqual(item["category"], "ROOM_LEVEL")
            self.assertIn(item["equipment_type"], ["RAQS", "VAV"])

        # Shared
        resp_shared = self.client.get("/api/equipment?category=SHARED")
        self.assertEqual(resp_shared.status_code, 200)
        items_shared = resp_shared.json()
        for item in items_shared:
            self.assertEqual(item["category"], "SHARED")
            self.assertIn(item["equipment_type"], ["AHU", "EV", "CHILLER"])

    def test_create_and_delete_room(self):
        floors = self.client.get("/api/floors").json()
        floor_id = floors[0]["id"]

        create_resp = self.client.post("/api/rooms", json={
            "floor_id": floor_id,
            "name": "Integration Test Room",
            "room_number": "999",
            "area_sqm": 42.0
        })
        self.assertEqual(create_resp.status_code, 201)
        room_data = create_resp.json()
        room_id = room_data["id"]

        # Read back
        get_resp = self.client.get(f"/api/rooms/{room_id}")
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.json()["name"], "Integration Test Room")

        # Delete
        del_resp = self.client.delete(f"/api/rooms/{room_id}")
        self.assertEqual(del_resp.status_code, 204)

        # Confirm deleted
        get_again = self.client.get(f"/api/rooms/{room_id}")
        self.assertEqual(get_again.status_code, 404)


if __name__ == "__main__":
    unittest.main()
