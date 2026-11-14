"""
Domain entity models and enums for BELIMO | Collia.
"""

from enum import Enum
from typing import Optional, List, Dict
from dataclasses import dataclass, field
from datetime import datetime, timezone


class EquipmentCategory(str, Enum):
    ROOM_LEVEL = "ROOM_LEVEL"
    SHARED = "SHARED"


class EquipmentType(str, Enum):
    RAQS = "RAQS"
    VAV = "VAV"
    AHU = "AHU"
    EV = "EV"
    CHILLER = "CHILLER"


class RelationshipType(str, Enum):
    CONTAINS = "CONTAINS"
    HAS_EQUIPMENT = "HAS_EQUIPMENT"
    SERVES = "SERVES"
    SUPPLIES = "SUPPLIES"
    CONNECTED_TO = "CONNECTED_TO"
    CONTROLS = "CONTROLS"
    MEASURES = "MEASURES"


# Equipment parameter reference definitions as per master specification
EQUIPMENT_PARAMETERS: Dict[EquipmentType, List[str]] = {
    EquipmentType.RAQS: [
        "Temperature",
        "Humidity",
        "CO2"
    ],
    EquipmentType.VAV: [
        "Airflow",
        "Temperature",
        "Pressure"
    ],
    EquipmentType.EV: [
        "Actuator Position / Valve Opening",
        "Flow Rate",
        "T1",
        "T2",
        "Tonnage / Power",
        "Control Signal"
    ],
    EquipmentType.AHU: [
        "Fan Speed",
        "Airflow",
        "Flow Rate",
        "T1",
        "T2",
        "Tonnage / Power",
        "Return Air Temperature",
        "Supply Air Temperature",
        "Filter Status",
        "Heat Recovery Wheel Status"
    ],
    EquipmentType.CHILLER: [
        "Operating Status (ON/OFF)",
        "Compressor Speed",
        "Chilled Water Supply Temperature",
        "Chilled Water Supply Pressure",
        "Chilled Water Supply Flow Rate",
        "Chilled Water Return Temperature",
        "Chilled Water Return Pressure",
        "Chilled Water Return Flow Rate"
    ]
}

# Equipment category lookup
EQUIPMENT_CATEGORY_MAP: Dict[EquipmentType, EquipmentCategory] = {
    EquipmentType.RAQS: EquipmentCategory.ROOM_LEVEL,
    EquipmentType.VAV: EquipmentCategory.ROOM_LEVEL,
    EquipmentType.AHU: EquipmentCategory.SHARED,
    EquipmentType.EV: EquipmentCategory.SHARED,
    EquipmentType.CHILLER: EquipmentCategory.SHARED
}


def get_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Building:
    id: str
    name: str
    description: str = ""
    created_at: str = field(default_factory=get_utc_now)
    updated_at: str = field(default_factory=get_utc_now)


@dataclass
class Floor:
    id: str
    building_id: str
    name: str
    floor_number: int = 1
    description: str = ""
    created_at: str = field(default_factory=get_utc_now)
    updated_at: str = field(default_factory=get_utc_now)


@dataclass
class Room:
    id: str
    floor_id: str
    name: str
    room_number: str = ""
    area_sqm: float = 0.0
    description: str = ""
    created_at: str = field(default_factory=get_utc_now)
    updated_at: str = field(default_factory=get_utc_now)


@dataclass
class Equipment:
    id: str
    equipment_type: EquipmentType
    category: EquipmentCategory
    name: str
    description: str = ""
    csv_filename: str = ""
    room_id: Optional[str] = None  # Populated for ROOM_LEVEL
    building_id: Optional[str] = None  # Populated for SHARED or root association
    created_at: str = field(default_factory=get_utc_now)
    updated_at: str = field(default_factory=get_utc_now)


@dataclass
class Relationship:
    id: str
    source_id: str
    source_type: str  # e.g., 'BUILDING', 'FLOOR', 'ROOM', 'EQUIPMENT'
    relationship_type: RelationshipType
    target_id: str
    target_type: str  # e.g., 'FLOOR', 'ROOM', 'EQUIPMENT'
    description: str = ""
    created_at: str = field(default_factory=get_utc_now)
