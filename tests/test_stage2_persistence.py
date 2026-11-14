"""
Automated Test Suite for Stage 2:
Entity Model and Configuration Persistence
"""

import unittest
import tempfile
import shutil
from pathlib import Path

from backend.app.models.entity import (
    EquipmentType,
    EquipmentCategory,
    RelationshipType,
    EQUIPMENT_PARAMETERS,
    EQUIPMENT_CATEGORY_MAP
)
from backend.app.schemas.entity_schemas import (
    BuildingCreate,
    BuildingUpdate,
    FloorCreate,
    RoomCreate,
    EquipmentCreate,
    EquipmentUpdate,
    RelationshipCreate
)
from backend.app.services.configuration_service import ConfigurationService


class TestStage2Persistence(unittest.TestCase):
    def setUp(self):
        # Create an isolated temporary directory for test CSV persistence
        self.test_dir = tempfile.mkdtemp()
        self.service = ConfigurationService(config_dir=Path(self.test_dir))

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_default_topology_seeded_in_csv(self):
        """Verifies default reference topology is correctly initialized into pure CSV files."""
        # Check files exist
        for filename in ["buildings.csv", "floors.csv", "rooms.csv", "equipment.csv", "relationships.csv"]:
            csv_path = Path(self.test_dir) / filename
            self.assertTrue(csv_path.exists(), f"{filename} must exist")
            self.assertTrue(csv_path.stat().st_size > 0, f"{filename} must not be empty")

        # Verify no JSON or database files were created
        all_files = list(Path(self.test_dir).glob("*"))
        non_csv = [f.name for f in all_files if not f.name.endswith(".csv") and not f.name.endswith(".tmp")]
        self.assertEqual(non_csv, [], f"No non-CSV files allowed in config dir: {non_csv}")

        # Verify default topology loaded
        topology = self.service.get_system_topology()
        self.assertIsNotNone(topology.building)
        self.assertEqual(topology.building.name, "BELIMO CESIM House, Mumbai")
        self.assertEqual(len(topology.floors), 1)
        self.assertEqual(len(topology.rooms), 3)
        self.assertEqual(len(topology.room_equipment), 6)  # 3 VAVs + 3 RAQS
        self.assertEqual(len(topology.shared_equipment), 3)  # Chiller, EV, AHU
        self.assertEqual(len(topology.relationships), 18)

    def test_unique_entity_identifiers(self):
        """Verifies unique internal IDs are generated for entities."""
        bldg = self.service.create_building(BuildingCreate(name="Research Tower"))
        floor = self.service.create_floor(FloorCreate(building_id=bldg.id, name="Level 2", floor_number=2))
        room = self.service.create_room(RoomCreate(floor_id=floor.id, name="Lab 201"))

        self.assertTrue(bldg.id.startswith("bldg_"))
        self.assertTrue(floor.id.startswith("flr_"))
        self.assertTrue(room.id.startswith("rm_"))
        self.assertNotEqual(bldg.id, floor.id)
        self.assertNotEqual(floor.id, room.id)

    def test_equipment_category_distinction_and_parameters(self):
        """Verifies distinction between room-level and shared equipment and standard parameters."""
        # 1. Room-level equipment requires valid room_id
        with self.assertRaises(ValueError):
            self.service.create_equipment(EquipmentCreate(
                equipment_type=EquipmentType.VAV,
                name="Orphan VAV",
                room_id=None
            ))

        # 2. Shared equipment cannot be assigned to an individual room
        rooms = self.service.get_rooms()
        valid_room_id = rooms[0].id
        with self.assertRaises(ValueError):
            self.service.create_equipment(EquipmentCreate(
                equipment_type=EquipmentType.AHU,
                name="Misplaced AHU",
                room_id=valid_room_id
            ))

        # 3. Create valid room-level equipment
        vav = self.service.create_equipment(EquipmentCreate(
            equipment_type=EquipmentType.VAV,
            name="Zone 101 VAV Dual Duct",
            csv_filename="VAV_custom.csv",
            room_id=valid_room_id
        ))
        self.assertEqual(vav.category, EquipmentCategory.ROOM_LEVEL)
        self.assertEqual(vav.room_id, valid_room_id)
        self.assertEqual(vav.csv_filename, "VAV_custom.csv")

        # 4. Create valid shared equipment
        chiller = self.service.create_equipment(EquipmentCreate(
            equipment_type=EquipmentType.CHILLER,
            name="Backup Modular Chiller",
            csv_filename="Chiller_backup.csv"
        ))
        self.assertEqual(chiller.category, EquipmentCategory.SHARED)
        self.assertIsNone(chiller.room_id)
        self.assertEqual(chiller.csv_filename, "Chiller_backup.csv")

        # 5. Check parameter definitions
        self.assertIn("Temperature", EQUIPMENT_PARAMETERS[EquipmentType.RAQS])
        self.assertIn("Humidity", EQUIPMENT_PARAMETERS[EquipmentType.RAQS])
        self.assertIn("CO2", EQUIPMENT_PARAMETERS[EquipmentType.RAQS])
        self.assertIn("Flow Rate", EQUIPMENT_PARAMETERS[EquipmentType.EV])
        self.assertIn("Compressor Speed", EQUIPMENT_PARAMETERS[EquipmentType.CHILLER])

    def test_relationships_structural_and_equipment(self):
        """Tests structural and equipment relationships creation and cascading."""
        rooms = self.service.get_rooms()
        room_id = rooms[0].id
        ahu_list = [eq for eq in self.service.get_equipment() if eq.equipment_type == EquipmentType.AHU]
        ahu_id = ahu_list[0].id

        # Verify default SERVES relationship
        serves_rels = self.service.get_relationships(
            source_id=ahu_id,
            target_id=room_id,
            relationship_type=RelationshipType.SERVES
        )
        self.assertEqual(len(serves_rels), 1)

        # Create custom relationship
        rel = self.service.create_relationship(RelationshipCreate(
            source_id=ahu_id,
            source_type="EQUIPMENT",
            relationship_type=RelationshipType.MEASURES,
            target_id=room_id,
            target_type="ROOM",
            description="Diagnostic sensor connection"
        ))
        self.assertTrue(rel.id.startswith("rel_"))
        found = self.service.get_relationships(relationship_type=RelationshipType.MEASURES)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].id, rel.id)

    def test_application_restart_recovery(self):
        """Simulates restarting the application by initializing a new service from the existing CSV files."""
        # 1. Add unique entities in the first service instance
        bldg = self.service.create_building(BuildingCreate(
            name="Innovation Center",
            description="Sustainable Net Zero Building"
        ))
        floor = self.service.create_floor(FloorCreate(
            building_id=bldg.id,
            name="Floor 3",
            floor_number=3,
            description="R&D Floor"
        ))
        room = self.service.create_room(RoomCreate(
            floor_id=floor.id,
            name="Testing Lab 305",
            room_number="305",
            area_sqm=54.5
        ))
        vav = self.service.create_equipment(EquipmentCreate(
            equipment_type=EquipmentType.VAV,
            name="Lab 305 VAV",
            csv_filename="VAV_305.csv",
            room_id=room.id
        ))

        # 2. Simulate application restart: instantiate a completely new service instance pointing to the same directory
        restarted_service = ConfigurationService(config_dir=Path(self.test_dir))

        # 3. Verify all entities exist and match exactly
        recovered_bldg = restarted_service.get_building(bldg.id)
        self.assertIsNotNone(recovered_bldg)
        self.assertEqual(recovered_bldg.name, "Innovation Center")
        self.assertEqual(recovered_bldg.description, "Sustainable Net Zero Building")

        recovered_floor = restarted_service.get_floor(floor.id)
        self.assertIsNotNone(recovered_floor)
        self.assertEqual(recovered_floor.name, "Floor 3")
        self.assertEqual(recovered_floor.floor_number, 3)

        recovered_room = restarted_service.get_room(room.id)
        self.assertIsNotNone(recovered_room)
        self.assertEqual(recovered_room.name, "Testing Lab 305")
        self.assertEqual(recovered_room.area_sqm, 54.5)

        recovered_eq = restarted_service.get_equipment_by_id(vav.id)
        self.assertIsNotNone(recovered_eq)
        self.assertEqual(recovered_eq.name, "Lab 305 VAV")
        self.assertEqual(recovered_eq.csv_filename, "VAV_305.csv")
        self.assertEqual(recovered_eq.room_id, room.id)
        self.assertEqual(recovered_eq.category, EquipmentCategory.ROOM_LEVEL)


if __name__ == "__main__":
    unittest.main()
