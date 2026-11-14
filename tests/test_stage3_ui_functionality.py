"""
Automated Test Suite for Stage 3:
User Interface Functionality, Entity Creation, CSV Filename Binding, and CRUD
"""

import unittest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.services.configuration_service import ConfigurationService


class TestStage3UIFunctionality(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.service = ConfigurationService()

    def test_ui_template_contains_modals_and_drawer(self):
        """Verifies that the index.html template contains all required Stage 3 modals and detail drawer."""
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        html = resp.text

        # Drawer components
        self.assertIn('id="entity-detail-drawer"', html)
        self.assertIn('id="drawer-csv-input"', html)
        self.assertIn('id="drawer-name-input"', html)
        self.assertIn('id="drawer-params-list"', html)
        self.assertIn('id="drawer-relationships-list"', html)

        # Modals
        self.assertIn('id="modal-add-floor"', html)
        self.assertIn('id="modal-add-room"', html)
        self.assertIn('id="modal-add-room-device"', html)
        self.assertIn('id="modal-add-plant"', html)

        # Floors sidebar
        self.assertIn('id="floors-list"', html)
        self.assertIn('id="floor-counter-badge"', html)

        # Top layer SVG
        self.assertIn('z-20', html)

        # Verified CFM is removed
        self.assertNotIn('820 CFM', html)
        self.assertNotIn('240 CFM', html)

        # Verified ready indicator is removed
        self.assertNotIn('>Ready</div>', html)

        # Script
        self.assertIn('/static/js/app.js', html)

    def test_static_app_js_served(self):
        """Verifies app.js is properly mounted and served."""
        resp = self.client.get("/static/js/app.js")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("loadTopology", resp.text)
        self.assertIn("openDetailDrawer", resp.text)
        self.assertIn("submitAddRoom", resp.text)
        self.assertIn("submitAddRoomDevice", resp.text)
        self.assertIn("submitAddPlant", resp.text)

    def test_e2e_creation_of_all_5_equipment_types(self):
        """Tests complete UI workflow for creating a room, adding RAQS & VAV, and creating shared AHU, EV, and Chiller."""
        floors = self.client.get("/api/floors").json()
        self.assertTrue(len(floors) > 0)
        floor_id = floors[0]["id"]

        # 1. Create a new Room
        room_resp = self.client.post("/api/rooms", json={
            "floor_id": floor_id,
            "name": "104 - Testing Suite",
            "room_number": "104",
            "area_sqm": 50.0,
            "description": "Room for E2E testing"
        })
        self.assertEqual(room_resp.status_code, 201)
        room = room_resp.json()
        room_id = room["id"]

        # 2. Add Room-level RAQS with CSV filename
        raqs_resp = self.client.post("/api/equipment", json={
            "equipment_type": "RAQS",
            "name": "Room 104 Air Monitor",
            "description": "Monitors Temp, Humidity, CO2",
            "csv_filename": "RAQS_104.csv",
            "room_id": room_id
        })
        self.assertEqual(raqs_resp.status_code, 201)
        raqs = raqs_resp.json()
        self.assertEqual(raqs["category"], "ROOM_LEVEL")
        self.assertEqual(raqs["csv_filename"], "RAQS_104.csv")
        self.assertIn("CO2", raqs["standard_parameters"])

        # 3. Add Room-level VAV with CSV filename
        vav_resp = self.client.post("/api/equipment", json={
            "equipment_type": "VAV",
            "name": "Room 104 Terminal VAV",
            "description": "Airflow damper",
            "csv_filename": "VAV_104.csv",
            "room_id": room_id
        })
        self.assertEqual(vav_resp.status_code, 201)
        vav = vav_resp.json()
        self.assertEqual(vav["category"], "ROOM_LEVEL")
        self.assertEqual(vav["csv_filename"], "VAV_104.csv")
        self.assertIn("Airflow", vav["standard_parameters"])

        # 4. Add Shared AHU
        ahu_resp = self.client.post("/api/equipment", json={
            "equipment_type": "AHU",
            "name": "AHU-02 East Wing",
            "description": "Shared Air Handler",
            "csv_filename": "AHU_02.csv"
        })
        self.assertEqual(ahu_resp.status_code, 201)
        ahu = ahu_resp.json()
        self.assertEqual(ahu["category"], "SHARED")
        self.assertEqual(ahu["csv_filename"], "AHU_02.csv")

        # 5. Add Shared EV (Energy Valve)
        ev_resp = self.client.post("/api/equipment", json={
            "equipment_type": "EV",
            "name": "EV-02 Ultrasonic",
            "description": "Energy Valve",
            "csv_filename": "EV_02.csv"
        })
        self.assertEqual(ev_resp.status_code, 201)
        ev = ev_resp.json()
        self.assertEqual(ev["category"], "SHARED")
        self.assertEqual(ev["csv_filename"], "EV_02.csv")

        # 6. Add Shared Chiller
        chiller_resp = self.client.post("/api/equipment", json={
            "equipment_type": "CHILLER",
            "name": "Chiller-02 Plant",
            "description": "Modular Chilled Water Unit",
            "csv_filename": "Chiller_02.csv"
        })
        self.assertEqual(chiller_resp.status_code, 201)
        chiller = chiller_resp.json()
        self.assertEqual(chiller["category"], "SHARED")
        self.assertEqual(chiller["csv_filename"], "Chiller_02.csv")

        # 7. Edit equipment details (e.g. updating CSV filename and name)
        update_resp = self.client.put(f"/api/equipment/{vav['id']}", json={
            "name": "Room 104 Terminal VAV (Updated)",
            "csv_filename": "VAV_104_renamed.csv"
        })
        self.assertEqual(update_resp.status_code, 200)
        updated_vav = update_resp.json()
        self.assertEqual(updated_vav["name"], "Room 104 Terminal VAV (Updated)")
        self.assertEqual(updated_vav["csv_filename"], "VAV_104_renamed.csv")

        # 8. Clean up created test entities
        self.client.delete(f"/api/equipment/{raqs['id']}")
        self.client.delete(f"/api/equipment/{vav['id']}")
        self.client.delete(f"/api/equipment/{ahu['id']}")
        self.client.delete(f"/api/equipment/{ev['id']}")
        self.client.delete(f"/api/equipment/{chiller['id']}")
        self.client.delete(f"/api/rooms/{room_id}")

    def test_csv_filename_security_path_traversal_prevention(self):
        """Verifies that attempting to pass directory traversal in csv_filename is rejected."""
        rooms = self.client.get("/api/rooms").json()
        room_id = rooms[0]["id"]

        resp = self.client.post("/api/equipment", json={
            "equipment_type": "VAV",
            "name": "Malicious VAV",
            "csv_filename": "../../secret.csv",
            "room_id": room_id
        })
        self.assertEqual(resp.status_code, 422)  # Pydantic validation error


if __name__ == "__main__":
    unittest.main()
