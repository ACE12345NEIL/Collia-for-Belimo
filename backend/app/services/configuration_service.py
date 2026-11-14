"""
Configuration Persistence Service for BELIMO | Collia.
Stores all building, floor, room, equipment, and relationship configurations
using structured CSV files in data/configuration/.
Strictly no SQL, no JSON, and no external databases.
"""

import csv
import os
import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any

from backend.app.models.entity import (
    Building,
    Floor,
    Room,
    Equipment,
    Relationship,
    EquipmentCategory,
    EquipmentType,
    RelationshipType,
    EQUIPMENT_CATEGORY_MAP,
    EQUIPMENT_PARAMETERS,
    get_utc_now
)
from backend.app.schemas.entity_schemas import (
    BuildingCreate,
    BuildingUpdate,
    FloorCreate,
    FloorUpdate,
    RoomCreate,
    RoomUpdate,
    EquipmentCreate,
    EquipmentUpdate,
    RelationshipCreate,
    SystemTopologyResponse,
    BuildingResponse,
    FloorResponse,
    RoomResponse,
    EquipmentResponse,
    RelationshipResponse
)


class ConfigurationService:
    def __init__(self, config_dir: Optional[Path] = None):
        if config_dir is None:
            base_dir = Path(__file__).resolve().parent.parent.parent.parent
            self.config_dir = base_dir / "data" / "configuration"
        else:
            self.config_dir = Path(config_dir)

        self.config_dir.mkdir(parents=True, exist_ok=True)

        self.buildings_csv = self.config_dir / "buildings.csv"
        self.floors_csv = self.config_dir / "floors.csv"
        self.rooms_csv = self.config_dir / "rooms.csv"
        self.equipment_csv = self.config_dir / "equipment.csv"
        self.relationships_csv = self.config_dir / "relationships.csv"

        self._ensure_csv_files()
        self._seed_default_topology_if_empty()

    # -------------------------------------------------------------
    # Low-level CSV operations
    # -------------------------------------------------------------
    def _ensure_csv_files(self):
        """Initializes CSV files with headers if they do not exist."""
        headers = {
            self.buildings_csv: ["id", "name", "description", "created_at", "updated_at"],
            self.floors_csv: ["id", "building_id", "name", "floor_number", "description", "created_at", "updated_at"],
            self.rooms_csv: ["id", "floor_id", "name", "room_number", "area_sqm", "description", "created_at", "updated_at"],
            self.equipment_csv: ["id", "equipment_type", "category", "name", "description", "csv_filename", "room_id", "building_id", "created_at", "updated_at"],
            self.relationships_csv: ["id", "source_id", "source_type", "relationship_type", "target_id", "target_type", "description", "created_at"]
        }

        for path, cols in headers.items():
            if not path.exists() or path.stat().st_size == 0:
                with open(path, mode="w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow(cols)

    def _read_csv(self, path: Path) -> List[Dict[str, str]]:
        if not path.exists():
            return []
        with open(path, mode="r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            return list(reader)

    def _write_csv(self, path: Path, fieldnames: List[str], rows: List[Dict[str, Any]]):
        """Writes rows atomically to avoid corruption."""
        temp_path = path.with_suffix(".tmp")
        with open(temp_path, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for r in rows:
                writer.writerow(r)
        temp_path.replace(path)

    # -------------------------------------------------------------
    # Building CRUD
    # -------------------------------------------------------------
    def get_buildings(self) -> List[Building]:
        rows = self._read_csv(self.buildings_csv)
        return [
            Building(
                id=r["id"],
                name=r["name"],
                description=r.get("description", ""),
                created_at=r.get("created_at", ""),
                updated_at=r.get("updated_at", "")
            )
            for r in rows
        ]

    def get_building(self, building_id: str) -> Optional[Building]:
        for b in self.get_buildings():
            if b.id == building_id:
                return b
        return None

    def create_building(self, data: BuildingCreate) -> Building:
        buildings = self.get_buildings()
        new_id = f"bldg_{uuid.uuid4().hex[:8]}"
        now = get_utc_now()
        bldg = Building(
            id=new_id,
            name=data.name.strip(),
            description=data.description.strip() if data.description else "",
            created_at=now,
            updated_at=now
        )
        rows = [b.__dict__ for b in buildings]
        rows.append(bldg.__dict__)
        self._write_csv(self.buildings_csv, ["id", "name", "description", "created_at", "updated_at"], rows)
        return bldg

    def update_building(self, building_id: str, data: BuildingUpdate) -> Optional[Building]:
        buildings = self.get_buildings()
        updated = None
        rows = []
        for b in buildings:
            if b.id == building_id:
                if data.name is not None:
                    b.name = data.name.strip()
                if data.description is not None:
                    b.description = data.description.strip()
                b.updated_at = get_utc_now()
                updated = b
            rows.append(b.__dict__)
        if updated:
            self._write_csv(self.buildings_csv, ["id", "name", "description", "created_at", "updated_at"], rows)
        return updated

    def delete_building(self, building_id: str) -> bool:
        buildings = self.get_buildings()
        remaining = [b for b in buildings if b.id != building_id]
        if len(remaining) == len(buildings):
            return False
        self._write_csv(self.buildings_csv, ["id", "name", "description", "created_at", "updated_at"], [b.__dict__ for b in remaining])

        # Cascade floors
        floors = self.get_floors(building_id)
        for fl in floors:
            self.delete_floor(fl.id)
        return True

    # -------------------------------------------------------------
    # Floor CRUD
    # -------------------------------------------------------------
    def get_floors(self, building_id: Optional[str] = None) -> List[Floor]:
        rows = self._read_csv(self.floors_csv)
        floors = [
            Floor(
                id=r["id"],
                building_id=r["building_id"],
                name=r["name"],
                floor_number=int(r.get("floor_number", 1)),
                description=r.get("description", ""),
                created_at=r.get("created_at", ""),
                updated_at=r.get("updated_at", "")
            )
            for r in rows
        ]
        if building_id:
            return [f for f in floors if f.building_id == building_id]
        return floors

    def get_floor(self, floor_id: str) -> Optional[Floor]:
        for f in self.get_floors():
            if f.id == floor_id:
                return f
        return None

    def create_floor(self, data: FloorCreate) -> Floor:
        if not self.get_building(data.building_id):
            raise ValueError(f"Building '{data.building_id}' does not exist.")
        floors = self.get_floors()
        new_id = f"flr_{uuid.uuid4().hex[:8]}"
        now = get_utc_now()
        floor = Floor(
            id=new_id,
            building_id=data.building_id,
            name=data.name.strip(),
            floor_number=data.floor_number,
            description=data.description.strip() if data.description else "",
            created_at=now,
            updated_at=now
        )
        rows = [f.__dict__ for f in floors]
        rows.append(floor.__dict__)
        self._write_csv(self.floors_csv, ["id", "building_id", "name", "floor_number", "description", "created_at", "updated_at"], rows)

        # Structural relationship: Building CONTAINS Floor
        self.create_relationship(RelationshipCreate(
            source_id=data.building_id,
            source_type="BUILDING",
            relationship_type=RelationshipType.CONTAINS,
            target_id=new_id,
            target_type="FLOOR",
            description=f"Building contains {floor.name}"
        ))
        return floor

    def update_floor(self, floor_id: str, data: FloorUpdate) -> Optional[Floor]:
        floors = self.get_floors()
        updated = None
        rows = []
        for f in floors:
            if f.id == floor_id:
                if data.name is not None:
                    f.name = data.name.strip()
                if data.floor_number is not None:
                    f.floor_number = data.floor_number
                if data.description is not None:
                    f.description = data.description.strip()
                f.updated_at = get_utc_now()
                updated = f
            rows.append(f.__dict__)
        if updated:
            self._write_csv(self.floors_csv, ["id", "building_id", "name", "floor_number", "description", "created_at", "updated_at"], rows)
        return updated

    def delete_floor(self, floor_id: str) -> bool:
        floors = self.get_floors()
        remaining = [f for f in floors if f.id != floor_id]
        if len(remaining) == len(floors):
            return False
        self._write_csv(self.floors_csv, ["id", "building_id", "name", "floor_number", "description", "created_at", "updated_at"], [f.__dict__ for f in remaining])

        # Cascade rooms
        rooms = self.get_rooms(floor_id)
        for rm in rooms:
            self.delete_room(rm.id)

        # Remove relationships involving this floor
        self.delete_relationships_by_entity(floor_id)
        return True

    # -------------------------------------------------------------
    # Room CRUD
    # -------------------------------------------------------------
    def get_rooms(self, floor_id: Optional[str] = None) -> List[Room]:
        rows = self._read_csv(self.rooms_csv)
        rooms = [
            Room(
                id=r["id"],
                floor_id=r["floor_id"],
                name=r["name"],
                room_number=r.get("room_number", ""),
                area_sqm=float(r.get("area_sqm", 0.0) or 0.0),
                description=r.get("description", ""),
                created_at=r.get("created_at", ""),
                updated_at=r.get("updated_at", "")
            )
            for r in rows
        ]
        if floor_id:
            return [rm for rm in rooms if rm.floor_id == floor_id]
        return rooms

    def get_room(self, room_id: str) -> Optional[Room]:
        for r in self.get_rooms():
            if r.id == room_id:
                return r
        return None

    def create_room(self, data: RoomCreate) -> Room:
        if not self.get_floor(data.floor_id):
            raise ValueError(f"Floor '{data.floor_id}' does not exist.")
        rooms = self.get_rooms()
        new_id = f"rm_{uuid.uuid4().hex[:8]}"
        now = get_utc_now()
        room = Room(
            id=new_id,
            floor_id=data.floor_id,
            name=data.name.strip(),
            room_number=data.room_number.strip() if data.room_number else "",
            area_sqm=data.area_sqm or 0.0,
            description=data.description.strip() if data.description else "",
            created_at=now,
            updated_at=now
        )
        rows = [r.__dict__ for r in rooms]
        rows.append(room.__dict__)
        self._write_csv(self.rooms_csv, ["id", "floor_id", "name", "room_number", "area_sqm", "description", "created_at", "updated_at"], rows)

        # Structural relationship: Floor CONTAINS Room
        self.create_relationship(RelationshipCreate(
            source_id=data.floor_id,
            source_type="FLOOR",
            relationship_type=RelationshipType.CONTAINS,
            target_id=new_id,
            target_type="ROOM",
            description=f"Floor contains {room.name}"
        ))
        return room

    def update_room(self, room_id: str, data: RoomUpdate) -> Optional[Room]:
        rooms = self.get_rooms()
        updated = None
        rows = []
        for r in rooms:
            if r.id == room_id:
                if data.name is not None:
                    r.name = data.name.strip()
                if data.room_number is not None:
                    r.room_number = data.room_number.strip()
                if data.area_sqm is not None:
                    r.area_sqm = data.area_sqm
                if data.description is not None:
                    r.description = data.description.strip()
                r.updated_at = get_utc_now()
                updated = r
            rows.append(r.__dict__)
        if updated:
            self._write_csv(self.rooms_csv, ["id", "floor_id", "name", "room_number", "area_sqm", "description", "created_at", "updated_at"], rows)
        return updated

    def delete_room(self, room_id: str) -> bool:
        rooms = self.get_rooms()
        remaining = [r for r in rooms if r.id != room_id]
        if len(remaining) == len(rooms):
            return False
        self._write_csv(self.rooms_csv, ["id", "floor_id", "name", "room_number", "area_sqm", "description", "created_at", "updated_at"], [r.__dict__ for r in remaining])

        # Cascade room equipment
        equipment = self.get_equipment(room_id=room_id)
        for eq in equipment:
            self.delete_equipment(eq.id)

        # Remove relationships involving this room
        self.delete_relationships_by_entity(room_id)
        return True

    # -------------------------------------------------------------
    # Equipment CRUD
    # -------------------------------------------------------------
    def get_equipment(
        self,
        category: Optional[EquipmentCategory] = None,
        room_id: Optional[str] = None
    ) -> List[Equipment]:
        rows = self._read_csv(self.equipment_csv)
        items = [
            Equipment(
                id=r["id"],
                equipment_type=EquipmentType(r["equipment_type"]),
                category=EquipmentCategory(r["category"]),
                name=r["name"],
                description=r.get("description", ""),
                csv_filename=r.get("csv_filename", ""),
                room_id=r.get("room_id") or None,
                building_id=r.get("building_id") or None,
                created_at=r.get("created_at", ""),
                updated_at=r.get("updated_at", "")
            )
            for r in rows
        ]
        if category:
            items = [eq for eq in items if eq.category == category]
        if room_id:
            items = [eq for eq in items if eq.room_id == room_id]
        return items

    def get_equipment_by_id(self, equipment_id: str) -> Optional[Equipment]:
        for eq in self.get_equipment():
            if eq.id == equipment_id:
                return eq
        return None

    def create_equipment(self, data: EquipmentCreate) -> Equipment:
        category = EQUIPMENT_CATEGORY_MAP[data.equipment_type]
        if category == EquipmentCategory.ROOM_LEVEL:
            if not data.room_id:
                raise ValueError(f"Equipment of type {data.equipment_type.value} is room-level and requires a valid 'room_id'.")
            if not self.get_room(data.room_id):
                raise ValueError(f"Room '{data.room_id}' does not exist.")
        elif category == EquipmentCategory.SHARED:
            # Shared equipment must not be constrained to a room
            if data.room_id:
                raise ValueError(f"Shared equipment of type {data.equipment_type.value} cannot be assigned to an individual room.")

        equipment_list = self.get_equipment()
        prefix = f"eq_{data.equipment_type.value.lower()}"
        new_id = f"{prefix}_{uuid.uuid4().hex[:6]}"
        now = get_utc_now()

        eq = Equipment(
            id=new_id,
            equipment_type=data.equipment_type,
            category=category,
            name=data.name.strip(),
            description=data.description.strip() if data.description else "",
            csv_filename=data.csv_filename.strip() if data.csv_filename else "",
            room_id=data.room_id if category == EquipmentCategory.ROOM_LEVEL else None,
            building_id=data.building_id or None,
            created_at=now,
            updated_at=now
        )

        rows = [e.__dict__ for e in equipment_list]
        rows.append({
            "id": eq.id,
            "equipment_type": eq.equipment_type.value,
            "category": eq.category.value,
            "name": eq.name,
            "description": eq.description,
            "csv_filename": eq.csv_filename,
            "room_id": eq.room_id or "",
            "building_id": eq.building_id or "",
            "created_at": eq.created_at,
            "updated_at": eq.updated_at
        })

        self._write_csv(
            self.equipment_csv,
            ["id", "equipment_type", "category", "name", "description", "csv_filename", "room_id", "building_id", "created_at", "updated_at"],
            rows
        )

        # Structural relationship for room-level equipment: Room HAS_EQUIPMENT Equipment
        if category == EquipmentCategory.ROOM_LEVEL and eq.room_id:
            self.create_relationship(RelationshipCreate(
                source_id=eq.room_id,
                source_type="ROOM",
                relationship_type=RelationshipType.HAS_EQUIPMENT,
                target_id=new_id,
                target_type="EQUIPMENT",
                description=f"Room has {eq.name}"
            ))

        return eq

    def update_equipment(self, equipment_id: str, data: EquipmentUpdate) -> Optional[Equipment]:
        equipment_list = self.get_equipment()
        updated = None
        rows = []
        for eq in equipment_list:
            if eq.id == equipment_id:
                if data.name is not None:
                    eq.name = data.name.strip()
                if data.description is not None:
                    eq.description = data.description.strip()
                if data.csv_filename is not None:
                    eq.csv_filename = data.csv_filename.strip()
                if eq.category == EquipmentCategory.ROOM_LEVEL and data.room_id is not None:
                    if not self.get_room(data.room_id):
                        raise ValueError(f"Room '{data.room_id}' does not exist.")
                    eq.room_id = data.room_id
                eq.updated_at = get_utc_now()
                updated = eq

            rows.append({
                "id": eq.id,
                "equipment_type": eq.equipment_type.value,
                "category": eq.category.value,
                "name": eq.name,
                "description": eq.description,
                "csv_filename": eq.csv_filename,
                "room_id": eq.room_id or "",
                "building_id": eq.building_id or "",
                "created_at": eq.created_at,
                "updated_at": eq.updated_at
            })

        if updated:
            self._write_csv(
                self.equipment_csv,
                ["id", "equipment_type", "category", "name", "description", "csv_filename", "room_id", "building_id", "created_at", "updated_at"],
                rows
            )
        return updated

    def delete_equipment(self, equipment_id: str) -> bool:
        equipment_list = self.get_equipment()
        remaining = [eq for eq in equipment_list if eq.id != equipment_id]
        if len(remaining) == len(equipment_list):
            return False

        rows = [{
            "id": eq.id,
            "equipment_type": eq.equipment_type.value,
            "category": eq.category.value,
            "name": eq.name,
            "description": eq.description,
            "csv_filename": eq.csv_filename,
            "room_id": eq.room_id or "",
            "building_id": eq.building_id or "",
            "created_at": eq.created_at,
            "updated_at": eq.updated_at
        } for eq in remaining]

        self._write_csv(
            self.equipment_csv,
            ["id", "equipment_type", "category", "name", "description", "csv_filename", "room_id", "building_id", "created_at", "updated_at"],
            rows
        )

        # Remove relationships involving this equipment
        self.delete_relationships_by_entity(equipment_id)
        return True

    # -------------------------------------------------------------
    # Relationship CRUD
    # -------------------------------------------------------------
    def get_relationships(
        self,
        source_id: Optional[str] = None,
        target_id: Optional[str] = None,
        relationship_type: Optional[RelationshipType] = None
    ) -> List[Relationship]:
        rows = self._read_csv(self.relationships_csv)
        rels = [
            Relationship(
                id=r["id"],
                source_id=r["source_id"],
                source_type=r["source_type"],
                relationship_type=RelationshipType(r["relationship_type"]),
                target_id=r["target_id"],
                target_type=r["target_type"],
                description=r.get("description", ""),
                created_at=r.get("created_at", "")
            )
            for r in rows
        ]
        if source_id:
            rels = [r for r in rels if r.source_id == source_id]
        if target_id:
            rels = [r for r in rels if r.target_id == target_id]
        if relationship_type:
            rels = [r for r in rels if r.relationship_type == relationship_type]
        return rels

    def create_relationship(self, data: RelationshipCreate) -> Relationship:
        rels = self.get_relationships()
        new_id = f"rel_{uuid.uuid4().hex[:8]}"
        rel = Relationship(
            id=new_id,
            source_id=data.source_id,
            source_type=data.source_type.upper(),
            relationship_type=data.relationship_type,
            target_id=data.target_id,
            target_type=data.target_type.upper(),
            description=data.description.strip() if data.description else "",
            created_at=get_utc_now()
        )
        rows = [{
            "id": r.id,
            "source_id": r.source_id,
            "source_type": r.source_type,
            "relationship_type": r.relationship_type.value,
            "target_id": r.target_id,
            "target_type": r.target_type,
            "description": r.description,
            "created_at": r.created_at
        } for r in rels]

        rows.append({
            "id": rel.id,
            "source_id": rel.source_id,
            "source_type": rel.source_type,
            "relationship_type": rel.relationship_type.value,
            "target_id": rel.target_id,
            "target_type": rel.target_type,
            "description": rel.description,
            "created_at": rel.created_at
        })

        self._write_csv(
            self.relationships_csv,
            ["id", "source_id", "source_type", "relationship_type", "target_id", "target_type", "description", "created_at"],
            rows
        )
        return rel

    def delete_relationship(self, relationship_id: str) -> bool:
        rels = self.get_relationships()
        remaining = [r for r in rels if r.id != relationship_id]
        if len(remaining) == len(rels):
            return False
        rows = [{
            "id": r.id,
            "source_id": r.source_id,
            "source_type": r.source_type,
            "relationship_type": r.relationship_type.value,
            "target_id": r.target_id,
            "target_type": r.target_type,
            "description": r.description,
            "created_at": r.created_at
        } for r in remaining]

        self._write_csv(
            self.relationships_csv,
            ["id", "source_id", "source_type", "relationship_type", "target_id", "target_type", "description", "created_at"],
            rows
        )
        return True

    def delete_relationships_by_entity(self, entity_id: str) -> int:
        rels = self.get_relationships()
        remaining = [r for r in rels if r.source_id != entity_id and r.target_id != entity_id]
        deleted_count = len(rels) - len(remaining)
        if deleted_count > 0:
            rows = [{
                "id": r.id,
                "source_id": r.source_id,
                "source_type": r.source_type,
                "relationship_type": r.relationship_type.value,
                "target_id": r.target_id,
                "target_type": r.target_type,
                "description": r.description,
                "created_at": r.created_at
            } for r in remaining]

            self._write_csv(
                self.relationships_csv,
                ["id", "source_id", "source_type", "relationship_type", "target_id", "target_type", "description", "created_at"],
                rows
            )
        return deleted_count

    # -------------------------------------------------------------
    # Full System Topology
    # -------------------------------------------------------------
    def get_system_topology(self) -> SystemTopologyResponse:
        buildings = self.get_buildings()
        primary_building = buildings[0] if buildings else None

        floors = self.get_floors()
        rooms = self.get_rooms()
        all_equipment = self.get_equipment()

        room_eq = [eq for eq in all_equipment if eq.category == EquipmentCategory.ROOM_LEVEL]
        shared_eq = [eq for eq in all_equipment if eq.category == EquipmentCategory.SHARED]
        relationships = self.get_relationships()

        def to_eq_response(eq: Equipment) -> EquipmentResponse:
            return EquipmentResponse(
                id=eq.id,
                equipment_type=eq.equipment_type,
                category=eq.category,
                name=eq.name,
                description=eq.description,
                csv_filename=eq.csv_filename,
                room_id=eq.room_id,
                building_id=eq.building_id,
                standard_parameters=EQUIPMENT_PARAMETERS.get(eq.equipment_type, []),
                created_at=eq.created_at,
                updated_at=eq.updated_at
            )

        return SystemTopologyResponse(
            building=BuildingResponse(
                id=primary_building.id,
                name=primary_building.name,
                description=primary_building.description,
                created_at=primary_building.created_at,
                updated_at=primary_building.updated_at
            ) if primary_building else None,
            floors=[FloorResponse(
                id=f.id,
                building_id=f.building_id,
                name=f.name,
                floor_number=f.floor_number,
                description=f.description,
                created_at=f.created_at,
                updated_at=f.updated_at
            ) for f in floors],
            rooms=[RoomResponse(
                id=r.id,
                floor_id=r.floor_id,
                name=r.name,
                room_number=r.room_number,
                area_sqm=r.area_sqm,
                description=r.description,
                created_at=r.created_at,
                updated_at=r.updated_at
            ) for r in rooms],
            room_equipment=[to_eq_response(eq) for eq in room_eq],
            shared_equipment=[to_eq_response(eq) for eq in shared_eq],
            relationships=[RelationshipResponse(
                id=rel.id,
                source_id=rel.source_id,
                source_type=rel.source_type,
                relationship_type=rel.relationship_type,
                target_id=rel.target_id,
                target_type=rel.target_type,
                description=rel.description,
                created_at=rel.created_at
            ) for rel in relationships]
        )

    # -------------------------------------------------------------
    # Default Reference System Seeding
    # -------------------------------------------------------------
    def _seed_default_topology_if_empty(self):
        """Seeds the default 3-zone reference system if configuration tables are empty."""
        buildings = self.get_buildings()
        if buildings:
            return

        now = get_utc_now()

        # 1. Primary Building
        bldg = Building(
            id="bldg_01",
            name="Campus North — Building 04",
            description="Belimo Commercial Facility Baseline",
            created_at=now,
            updated_at=now
        )
        self._write_csv(self.buildings_csv, ["id", "name", "description", "created_at", "updated_at"], [bldg.__dict__])

        # 2. Floor 1
        floor = Floor(
            id="flr_01",
            building_id=bldg.id,
            name="Floor 1",
            floor_number=1,
            description="Ground Level Commercial & Executive Suites",
            created_at=now,
            updated_at=now
        )
        self._write_csv(self.floors_csv, ["id", "building_id", "name", "floor_number", "description", "created_at", "updated_at"], [floor.__dict__])

        # 3. Rooms (101, 102, 103)
        rooms = [
            Room(id="rm_101", floor_id=floor.id, name="101 - Conf. North", room_number="101", area_sqm=38.0, description="North Conference Room", created_at=now, updated_at=now),
            Room(id="rm_102", floor_id=floor.id, name="102 - Open Work", room_number="102", area_sqm=85.0, description="Open Workspace Zone", created_at=now, updated_at=now),
            Room(id="rm_103", floor_id=floor.id, name="103 - Exec. Office", room_number="103", area_sqm=32.0, description="Executive Office Suite", created_at=now, updated_at=now),
        ]
        self._write_csv(self.rooms_csv, ["id", "floor_id", "name", "room_number", "area_sqm", "description", "created_at", "updated_at"], [r.__dict__ for r in rooms])

        # 4. Equipment
        eq_rows = [
            # Room-level equipment (Zone 101)
            {"id": "eq_raqs_101", "equipment_type": "RAQS", "category": "ROOM_LEVEL", "name": "RAQS (Air Quality)", "description": "Zone 101 Indoor Air Quality Sensor", "csv_filename": "RAQS_101.csv", "room_id": "rm_101", "building_id": "", "created_at": now, "updated_at": now},
            {"id": "eq_vav_101", "equipment_type": "VAV", "category": "ROOM_LEVEL", "name": "VAV Actuator", "description": "Zone 101 Belimo VAV-Compact Actuator LM24A-V", "csv_filename": "VAV_101.csv", "room_id": "rm_101", "building_id": "", "created_at": now, "updated_at": now},
            # Room-level equipment (Zone 102)
            {"id": "eq_raqs_102", "equipment_type": "RAQS", "category": "ROOM_LEVEL", "name": "RAQS (Air Quality)", "description": "Zone 102 Indoor Air Quality Sensor", "csv_filename": "RAQS_102.csv", "room_id": "rm_102", "building_id": "", "created_at": now, "updated_at": now},
            {"id": "eq_vav_102", "equipment_type": "VAV", "category": "ROOM_LEVEL", "name": "VAV Actuator", "description": "Zone 102 Belimo VAV-Compact Actuator LM24A-V", "csv_filename": "VAV_102.csv", "room_id": "rm_102", "building_id": "", "created_at": now, "updated_at": now},
            # Room-level equipment (Zone 103)
            {"id": "eq_raqs_103", "equipment_type": "RAQS", "category": "ROOM_LEVEL", "name": "RAQS (Air Quality)", "description": "Zone 103 Indoor Air Quality Sensor", "csv_filename": "RAQS_103.csv", "room_id": "rm_103", "building_id": "", "created_at": now, "updated_at": now},
            {"id": "eq_vav_103", "equipment_type": "VAV", "category": "ROOM_LEVEL", "name": "VAV Actuator", "description": "Zone 103 Belimo VAV-Compact Actuator LM24A-V", "csv_filename": "VAV_103.csv", "room_id": "rm_103", "building_id": "", "created_at": now, "updated_at": now},
            # Shared plant equipment
            {"id": "eq_chiller_01", "equipment_type": "CHILLER", "category": "SHARED", "name": "Chiller-01", "description": "Central Chilled Water Plant 01", "csv_filename": "Chiller_01.csv", "room_id": "", "building_id": bldg.id, "created_at": now, "updated_at": now},
            {"id": "eq_ev_01", "equipment_type": "EV", "category": "SHARED", "name": "EV-01 (Energy Valve)", "description": "Belimo Energy Valve Ultrasonic Meter", "csv_filename": "EV_01.csv", "room_id": "", "building_id": bldg.id, "created_at": now, "updated_at": now},
            {"id": "eq_ahu_01", "equipment_type": "AHU", "category": "SHARED", "name": "AHU-01", "description": "Air Handling Unit AHU-01 DX Loop", "csv_filename": "AHU_01.csv", "room_id": "", "building_id": bldg.id, "created_at": now, "updated_at": now},
        ]
        self._write_csv(
            self.equipment_csv,
            ["id", "equipment_type", "category", "name", "description", "csv_filename", "room_id", "building_id", "created_at", "updated_at"],
            eq_rows
        )

        # 5. Relationships
        rel_rows = [
            # Structural
            {"id": "rel_01", "source_id": bldg.id, "source_type": "BUILDING", "relationship_type": "CONTAINS", "target_id": floor.id, "target_type": "FLOOR", "description": "Building contains Floor 1", "created_at": now},
            {"id": "rel_02", "source_id": floor.id, "source_type": "FLOOR", "relationship_type": "CONTAINS", "target_id": "rm_101", "target_type": "ROOM", "description": "Floor 1 contains Room 101", "created_at": now},
            {"id": "rel_03", "source_id": floor.id, "source_type": "FLOOR", "relationship_type": "CONTAINS", "target_id": "rm_102", "target_type": "ROOM", "description": "Floor 1 contains Room 102", "created_at": now},
            {"id": "rel_04", "source_id": floor.id, "source_type": "FLOOR", "relationship_type": "CONTAINS", "target_id": "rm_103", "target_type": "ROOM", "description": "Floor 1 contains Room 103", "created_at": now},
            {"id": "rel_05", "source_id": "rm_101", "source_type": "ROOM", "relationship_type": "HAS_EQUIPMENT", "target_id": "eq_vav_101", "target_type": "EQUIPMENT", "description": "Room 101 has VAV", "created_at": now},
            {"id": "rel_06", "source_id": "rm_101", "source_type": "ROOM", "relationship_type": "HAS_EQUIPMENT", "target_id": "eq_raqs_101", "target_type": "EQUIPMENT", "description": "Room 101 has RAQS", "created_at": now},
            {"id": "rel_07", "source_id": "rm_102", "source_type": "ROOM", "relationship_type": "HAS_EQUIPMENT", "target_id": "eq_vav_102", "target_type": "EQUIPMENT", "description": "Room 102 has VAV", "created_at": now},
            {"id": "rel_08", "source_id": "rm_102", "source_type": "ROOM", "relationship_type": "HAS_EQUIPMENT", "target_id": "eq_raqs_102", "target_type": "EQUIPMENT", "description": "Room 102 has RAQS", "created_at": now},
            {"id": "rel_09", "source_id": "rm_103", "source_type": "ROOM", "relationship_type": "HAS_EQUIPMENT", "target_id": "eq_vav_103", "target_type": "EQUIPMENT", "description": "Room 103 has VAV", "created_at": now},
            {"id": "rel_10", "source_id": "rm_103", "source_type": "ROOM", "relationship_type": "HAS_EQUIPMENT", "target_id": "eq_raqs_103", "target_type": "EQUIPMENT", "description": "Room 103 has RAQS", "created_at": now},
            # Equipment & System
            {"id": "rel_11", "source_id": "eq_chiller_01", "source_type": "EQUIPMENT", "relationship_type": "SUPPLIES", "target_id": "eq_ev_01", "target_type": "EQUIPMENT", "description": "Chiller-01 supplies chilled water to EV-01", "created_at": now},
            {"id": "rel_12", "source_id": "eq_ev_01", "source_type": "EQUIPMENT", "relationship_type": "CONNECTED_TO", "target_id": "eq_ahu_01", "target_type": "EQUIPMENT", "description": "EV-01 meters hydronic loop to AHU-01 cooling coil", "created_at": now},
            {"id": "rel_13", "source_id": "eq_ahu_01", "source_type": "EQUIPMENT", "relationship_type": "SERVES", "target_id": "rm_101", "target_type": "ROOM", "description": "AHU-01 duct supplies Room 101", "created_at": now},
            {"id": "rel_14", "source_id": "eq_ahu_01", "source_type": "EQUIPMENT", "relationship_type": "SERVES", "target_id": "rm_102", "target_type": "ROOM", "description": "AHU-01 duct supplies Room 102", "created_at": now},
            {"id": "rel_15", "source_id": "eq_ahu_01", "source_type": "EQUIPMENT", "relationship_type": "SERVES", "target_id": "rm_103", "target_type": "ROOM", "description": "AHU-01 duct supplies Room 103", "created_at": now},
            {"id": "rel_16", "source_id": "eq_raqs_101", "source_type": "EQUIPMENT", "relationship_type": "CONTROLS", "target_id": "eq_vav_101", "target_type": "EQUIPMENT", "description": "RAQS telemetry provides zone reset signal to VAV-101", "created_at": now},
            {"id": "rel_17", "source_id": "eq_raqs_102", "source_type": "EQUIPMENT", "relationship_type": "CONTROLS", "target_id": "eq_vav_102", "target_type": "EQUIPMENT", "description": "RAQS telemetry provides zone reset signal to VAV-102", "created_at": now},
            {"id": "rel_18", "source_id": "eq_raqs_103", "source_type": "EQUIPMENT", "relationship_type": "CONTROLS", "target_id": "eq_vav_103", "target_type": "EQUIPMENT", "description": "RAQS telemetry provides zone reset signal to VAV-103", "created_at": now},
        ]
        self._write_csv(
            self.relationships_csv,
            ["id", "source_id", "source_type", "relationship_type", "target_id", "target_type", "description", "created_at"],
            rel_rows
        )
