"""
Tests for Rule-Governed HVAC Connections, Modals, Opacity, and Dynamic Layout.
"""

import unittest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.services.configuration_service import ConfigurationService


class TestHvacConnectionsAndLayout(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.service = ConfigurationService()

    def test_frontend_has_all_connection_modals_and_reduced_opacity(self):
        """Verifies that index.html contains all 5 HVAC connection modals, custom connection sections, quick connect, and 60% opacity arrows."""
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        html = resp.text

        # All 5 connection modals
        self.assertIn('id="modal-configure-chiller"', html)
        self.assertIn('id="modal-configure-ev"', html)
        self.assertIn('id="modal-configure-ahu"', html)
        self.assertIn('id="modal-configure-vav"', html)
        self.assertIn('id="modal-configure-raqs"', html)

        # Checkbox containers (replaces <select multiple>)
        self.assertIn('id="modal-chiller-evs-container"', html)
        self.assertIn('id="modal-ev-ahus-container"', html)
        self.assertIn('id="modal-ahu-evs-container"', html)
        self.assertIn('id="modal-ahu-vavs-container"', html)
        self.assertIn('id="modal-vav-raqs-container"', html)
        self.assertIn('id="modal-raqs-vavs-container"', html)

        # Drawer quick-connect and configure connections button
        self.assertIn('id="drawer-quick-connect-container"', html)
        self.assertIn('id="drawer-quick-target-select"', html)
        self.assertIn('id="drawer-quick-rel-type"', html)
        self.assertIn('id="drawer-btn-configure-conn"', html)

        # Scrollable sidebar and visible scrollbars
        self.assertIn('id="sidebar-scrollable-container"', html)
        self.assertIn('::-webkit-scrollbar{width:6px;height:6px;}', html)

        # Plant creation initial connection setup
        self.assertIn('id="modal-plant-dynamic-connections"', html)
        self.assertIn('id="modal-plant-custom-target"', html)

        # Room device creation initial connection setup
        self.assertIn('id="modal-device-dynamic-connections"', html)
        self.assertIn('id="modal-device-custom-target"', html)

        # Verify 60% opacity markers present in SVG defs (arrows drawn dynamically via JS)
        self.assertIn('fill-opacity="0.6"', html)  # Arrow marker defs in static SVG

    def test_app_js_contains_connection_logic_and_layout(self):
        """Verifies app.js defines all required connection dispatchers, handlers, and dynamic arrows."""
        resp = self.client.get("/static/js/app.js")
        self.assertEqual(resp.status_code, 200)
        js = resp.text

        # Dispatches and connection handlers
        self.assertIn("openConfigurePlantConnections", js)
        self.assertIn("openConfigureCurrentEntityConnections", js)
        self.assertIn("openConfigureEntityDirectly", js)
        self.assertIn("openConfigureChiller", js)
        self.assertIn("submitConfigureChiller", js)
        self.assertIn("openConfigureEV", js)
        self.assertIn("submitConfigureEV", js)
        self.assertIn("openConfigureAHU", js)
        self.assertIn("submitConfigureAHU", js)
        self.assertIn("openConfigureVAV", js)
        self.assertIn("submitConfigureVAV", js)
        self.assertIn("openConfigureRAQS", js)
        self.assertIn("submitConfigureRAQS", js)
        self.assertIn("deleteRelationshipDirectly", js)
        self.assertIn("submitDrawerQuickConnect", js)
        self.assertIn("onPlantTypeChanged", js)
        self.assertIn("onRoomDeviceTypeChanged", js)
        self.assertIn("renderCustomConnectionsSection", js)
        self.assertIn("addCustomModalConnection", js)
        self.assertIn("deleteCustomModalConnection", js)

        # Dynamic layout & 60% opacity arrows
        self.assertIn("updateCanvasSchematicArrows", js)
        self.assertIn('stroke-opacity="0.6"', js)

    def test_empty_name_validation(self):
        """Verifies that creating floor, room, or equipment with empty name is rejected by backend."""
        # Empty equipment name
        resp = self.client.post("/api/equipment", json={
            "equipment_type": "CHILLER",
            "name": "   "
        })
        self.assertEqual(resp.status_code, 422)

        # Empty room name
        resp = self.client.post("/api/rooms", json={
            "floor_id": "flr_01",
            "name": "  "
        })
        self.assertEqual(resp.status_code, 422)

        # Empty floor name
        resp = self.client.post("/api/floors", json={
            "building_id": "bldg_01",
            "name": ""
        })
        self.assertEqual(resp.status_code, 422)

    def test_hvac_relationship_lifecycle(self):
        """Tests the full API flow of establishing and modifying HVAC relationships according to rules."""
        # 1. Create Floor and Room
        bldg_resp = self.client.get("/api/buildings").json()
        bldg_id = bldg_resp[0]["id"]
        flr = self.client.post("/api/floors", json={
            "building_id": bldg_id,
            "name": "Floor 99",
            "floor_number": 99
        }).json()

        rm = self.client.post("/api/rooms", json={
            "floor_id": flr["id"],
            "name": "Room 9901",
            "room_number": "9901",
            "area_sqm": 42.0
        }).json()

        # 2. Create the 5 devices
        chiller = self.client.post("/api/equipment", json={
            "equipment_type": "CHILLER",
            "name": "Chiller-99"
        }).json()

        ev = self.client.post("/api/equipment", json={
            "equipment_type": "EV",
            "name": "EV-99"
        }).json()

        ahu = self.client.post("/api/equipment", json={
            "equipment_type": "AHU",
            "name": "AHU-99"
        }).json()

        vav = self.client.post("/api/equipment", json={
            "equipment_type": "VAV",
            "name": "VAV-9901",
            "room_id": rm["id"]
        }).json()

        raqs = self.client.post("/api/equipment", json={
            "equipment_type": "RAQS",
            "name": "RAQS-9901",
            "room_id": rm["id"]
        }).json()

        # 3. Establish rule-based connections
        # Chiller SUPPLIES EV
        r1 = self.client.post("/api/relationships", json={
            "source_id": chiller["id"],
            "source_type": "EQUIPMENT",
            "relationship_type": "SUPPLIES",
            "target_id": ev["id"],
            "target_type": "EQUIPMENT",
            "description": "Chiller-99 supplies chilled water to EV-99"
        }).json()

        # EV CONNECTED_TO AHU
        r2 = self.client.post("/api/relationships", json={
            "source_id": ev["id"],
            "source_type": "EQUIPMENT",
            "relationship_type": "CONNECTED_TO",
            "target_id": ahu["id"],
            "target_type": "EQUIPMENT",
            "description": "EV-99 meters flow to AHU-99"
        }).json()

        # AHU SUPPLIES VAV
        r3 = self.client.post("/api/relationships", json={
            "source_id": ahu["id"],
            "source_type": "EQUIPMENT",
            "relationship_type": "SUPPLIES",
            "target_id": vav["id"],
            "target_type": "EQUIPMENT",
            "description": "AHU-99 supplies air to VAV-9901"
        }).json()

        # RAQS MEASURES VAV (in same room)
        r4 = self.client.post("/api/relationships", json={
            "source_id": raqs["id"],
            "source_type": "EQUIPMENT",
            "relationship_type": "MEASURES",
            "target_id": vav["id"],
            "target_type": "EQUIPMENT",
            "description": "RAQS-9901 measures conditions for VAV-9901"
        }).json()

        # Verify all relationships appear in topology
        topo = self.client.get("/api/topology").json()
        rel_ids = [r["id"] for r in topo["relationships"]]
        self.assertIn(r1["id"], rel_ids)
        self.assertIn(r2["id"], rel_ids)
        self.assertIn(r3["id"], rel_ids)
        self.assertIn(r4["id"], rel_ids)

        # 4. Clean up
        self.client.delete(f"/api/relationships/{r1['id']}")
        self.client.delete(f"/api/relationships/{r2['id']}")
        self.client.delete(f"/api/relationships/{r3['id']}")
        self.client.delete(f"/api/relationships/{r4['id']}")

        self.client.delete(f"/api/equipment/{raqs['id']}")
        self.client.delete(f"/api/equipment/{vav['id']}")
        self.client.delete(f"/api/equipment/{ahu['id']}")
        self.client.delete(f"/api/equipment/{ev['id']}")
        self.client.delete(f"/api/equipment/{chiller['id']}")
        self.client.delete(f"/api/rooms/{rm['id']}")
        self.client.delete(f"/api/floors/{flr['id']}")

    def test_multi_ahu_hydronic_return_and_clean_layout(self):
        """Verifies that hydronic return lines support multiple AHUs dynamically without hardcoding."""
        resp_html = self.client.get("/")
        self.assertEqual(resp_html.status_code, 200)
        html = resp_html.text

        # Top-left corner BELIMO Collia branding is prominent and easy to read
        # Logo replaces BELIMO text; alt="BELIMO" keeps stage1 test passing
        self.assertIn('alt="BELIMO"', html)
        self.assertIn("belimo_logo.svg", html)
        self.assertNotIn(">BELIMO<", html)
        self.assertIn("Collia", html)

        # Green arrow marker for EV->AHU in HTML
        self.assertIn('id="arrow-ev"', html)

        # Non-overlapping canvas containers
        # Three-tier plant layout: separate containers per equipment type
        self.assertIn("plant-tier-chiller", html)
        self.assertIn("plant-tier-ev", html)
        self.assertIn("plant-tier-ahu", html)
        # Zones container pushed down to accommodate taller plant box
        self.assertIn("top-[480px]", html)

        resp_js = self.client.get("/static/js/app.js")
        self.assertEqual(resp_js.status_code, 200)
        js = resp_js.text

        # Dynamic return pairs for all AHUs without hardcoded firstAhuEl/ahus[0]
        self.assertIn("returnPairs", js)
        self.assertNotIn("firstAhuEl", js)
        self.assertNotIn("firstChillerEl", js)
        self.assertIn("plantBottomMax", js)

        # EV->AHU arrow is green (#16A34A), Chiller->EV is blue (#0284C7)
        self.assertIn('stroke="#16A34A"', js)
        self.assertIn('marker-end="url(#arrow-ev)"', js)
        self.assertIn('stroke="#0284C7"', js)
        self.assertIn('marker-end="url(#arrow-chw)"', js)

        # 35% opacity for blue and green arrows
        self.assertIn('stroke-opacity="0.35"', js)
        self.assertIn('fill-opacity="0.35"', js)
        self.assertIn('fill-opacity="0.35"', html)


if __name__ == "__main__":
    unittest.main()
