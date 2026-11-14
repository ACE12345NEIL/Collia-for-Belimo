"""
Pydantic validation schemas for BELIMO | Collia entity management.
"""

from typing import Optional, List
from pydantic import BaseModel, Field, field_validator
from backend.app.models.entity import (
    EquipmentType,
    EquipmentCategory,
    RelationshipType,
    EQUIPMENT_CATEGORY_MAP,
    EQUIPMENT_PARAMETERS
)


# --- Building Schemas ---
class BuildingCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default="")


class BuildingUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = None


class BuildingResponse(BaseModel):
    id: str
    name: str
    description: str
    created_at: str
    updated_at: str


# --- Floor Schemas ---
class FloorCreate(BaseModel):
    building_id: str
    name: str = Field(..., min_length=1, max_length=120)
    floor_number: int = Field(default=1)
    description: Optional[str] = Field(default="")


class FloorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    floor_number: Optional[int] = None
    description: Optional[str] = None


class FloorResponse(BaseModel):
    id: str
    building_id: str
    name: str
    floor_number: int
    description: str
    created_at: str
    updated_at: str


# --- Room Schemas ---
class RoomCreate(BaseModel):
    floor_id: str
    name: str = Field(..., min_length=1, max_length=120)
    room_number: Optional[str] = Field(default="")
    area_sqm: Optional[float] = Field(default=0.0, ge=0.0)
    description: Optional[str] = Field(default="")


class RoomUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    room_number: Optional[str] = None
    area_sqm: Optional[float] = Field(None, ge=0.0)
    description: Optional[str] = None


class RoomResponse(BaseModel):
    id: str
    floor_id: str
    name: str
    room_number: str
    area_sqm: float
    description: str
    created_at: str
    updated_at: str


# --- Equipment Schemas ---
class EquipmentCreate(BaseModel):
    equipment_type: EquipmentType
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default="")
    csv_filename: Optional[str] = Field(default="", max_length=255)
    room_id: Optional[str] = None
    building_id: Optional[str] = None

    @field_validator("csv_filename")
    @classmethod
    def sanitize_csv_filename(cls, v: Optional[str]) -> str:
        if not v:
            return ""
        v = v.strip()
        # Security check: Prevent path traversal
        if ".." in v or "/" in v or "\\" in v:
            raise ValueError("CSV filename cannot contain path separators or parent directory references ('..').")
        return v


class EquipmentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = None
    csv_filename: Optional[str] = None
    room_id: Optional[str] = None

    @field_validator("csv_filename")
    @classmethod
    def sanitize_csv_filename(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if ".." in v or "/" in v or "\\" in v:
            raise ValueError("CSV filename cannot contain path separators or parent directory references ('..').")
        return v


class EquipmentResponse(BaseModel):
    id: str
    equipment_type: EquipmentType
    category: EquipmentCategory
    name: str
    description: str
    csv_filename: str
    room_id: Optional[str] = None
    building_id: Optional[str] = None
    standard_parameters: List[str] = []
    created_at: str
    updated_at: str


# --- Relationship Schemas ---
class RelationshipCreate(BaseModel):
    source_id: str
    source_type: str
    relationship_type: RelationshipType
    target_id: str
    target_type: str
    description: Optional[str] = Field(default="")


class RelationshipResponse(BaseModel):
    id: str
    source_id: str
    source_type: str
    relationship_type: RelationshipType
    target_id: str
    target_type: str
    description: str
    created_at: str


# --- Complete System Topology ---
class SystemTopologyResponse(BaseModel):
    building: Optional[BuildingResponse] = None
    floors: List[FloorResponse] = []
    rooms: List[RoomResponse] = []
    room_equipment: List[EquipmentResponse] = []
    shared_equipment: List[EquipmentResponse] = []
    relationships: List[RelationshipResponse] = []
