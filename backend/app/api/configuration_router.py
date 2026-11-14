"""
Configuration REST API Router for BELIMO | Collia.
Provides entity management endpoints for Building, Floor, Room, Equipment, and Relationships.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status

from backend.app.services.configuration_service import ConfigurationService
from backend.app.schemas.entity_schemas import (
    BuildingCreate,
    BuildingUpdate,
    BuildingResponse,
    FloorCreate,
    FloorUpdate,
    FloorResponse,
    RoomCreate,
    RoomUpdate,
    RoomResponse,
    EquipmentCreate,
    EquipmentUpdate,
    EquipmentResponse,
    RelationshipCreate,
    RelationshipResponse,
    SystemTopologyResponse
)
from backend.app.models.entity import (
    EquipmentCategory,
    RelationshipType,
    EQUIPMENT_PARAMETERS
)

router = APIRouter(prefix="/api", tags=["Configuration"])
config_service = ConfigurationService()


# --- Full Topology ---
@router.get("/topology", response_model=SystemTopologyResponse)
async def get_system_topology():
    return config_service.get_system_topology()


# --- Buildings ---
@router.get("/buildings", response_model=List[BuildingResponse])
async def list_buildings():
    return [
        BuildingResponse(
            id=b.id,
            name=b.name,
            description=b.description,
            created_at=b.created_at,
            updated_at=b.updated_at
        )
        for b in config_service.get_buildings()
    ]


@router.post("/buildings", response_model=BuildingResponse, status_code=status.HTTP_201_CREATED)
async def create_building(data: BuildingCreate):
    b = config_service.create_building(data)
    return BuildingResponse(
        id=b.id,
        name=b.name,
        description=b.description,
        created_at=b.created_at,
        updated_at=b.updated_at
    )


@router.get("/buildings/{building_id}", response_model=BuildingResponse)
async def get_building(building_id: str):
    b = config_service.get_building(building_id)
    if not b:
        raise HTTPException(status_code=404, detail=f"Building '{building_id}' not found.")
    return BuildingResponse(
        id=b.id,
        name=b.name,
        description=b.description,
        created_at=b.created_at,
        updated_at=b.updated_at
    )


@router.put("/buildings/{building_id}", response_model=BuildingResponse)
async def update_building(building_id: str, data: BuildingUpdate):
    b = config_service.update_building(building_id, data)
    if not b:
        raise HTTPException(status_code=404, detail=f"Building '{building_id}' not found.")
    return BuildingResponse(
        id=b.id,
        name=b.name,
        description=b.description,
        created_at=b.created_at,
        updated_at=b.updated_at
    )


@router.delete("/buildings/{building_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_building(building_id: str):
    success = config_service.delete_building(building_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Building '{building_id}' not found.")
    return None


# --- Floors ---
@router.get("/floors", response_model=List[FloorResponse])
async def list_floors(building_id: Optional[str] = None):
    return [
        FloorResponse(
            id=f.id,
            building_id=f.building_id,
            name=f.name,
            floor_number=f.floor_number,
            description=f.description,
            created_at=f.created_at,
            updated_at=f.updated_at
        )
        for f in config_service.get_floors(building_id)
    ]


@router.post("/floors", response_model=FloorResponse, status_code=status.HTTP_201_CREATED)
async def create_floor(data: FloorCreate):
    try:
        f = config_service.create_floor(data)
        return FloorResponse(
            id=f.id,
            building_id=f.building_id,
            name=f.name,
            floor_number=f.floor_number,
            description=f.description,
            created_at=f.created_at,
            updated_at=f.updated_at
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/floors/{floor_id}", response_model=FloorResponse)
async def get_floor(floor_id: str):
    f = config_service.get_floor(floor_id)
    if not f:
        raise HTTPException(status_code=404, detail=f"Floor '{floor_id}' not found.")
    return FloorResponse(
        id=f.id,
        building_id=f.building_id,
        name=f.name,
        floor_number=f.floor_number,
        description=f.description,
        created_at=f.created_at,
        updated_at=f.updated_at
    )


@router.put("/floors/{floor_id}", response_model=FloorResponse)
async def update_floor(floor_id: str, data: FloorUpdate):
    f = config_service.update_floor(floor_id, data)
    if not f:
        raise HTTPException(status_code=404, detail=f"Floor '{floor_id}' not found.")
    return FloorResponse(
        id=f.id,
        building_id=f.building_id,
        name=f.name,
        floor_number=f.floor_number,
        description=f.description,
        created_at=f.created_at,
        updated_at=f.updated_at
    )


@router.delete("/floors/{floor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_floor(floor_id: str):
    success = config_service.delete_floor(floor_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Floor '{floor_id}' not found.")
    return None


# --- Rooms ---
@router.get("/rooms", response_model=List[RoomResponse])
async def list_rooms(floor_id: Optional[str] = None):
    return [
        RoomResponse(
            id=r.id,
            floor_id=r.floor_id,
            name=r.name,
            room_number=r.room_number,
            area_sqm=r.area_sqm,
            description=r.description,
            created_at=r.created_at,
            updated_at=r.updated_at
        )
        for r in config_service.get_rooms(floor_id)
    ]


@router.post("/rooms", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(data: RoomCreate):
    try:
        r = config_service.create_room(data)
        return RoomResponse(
            id=r.id,
            floor_id=r.floor_id,
            name=r.name,
            room_number=r.room_number,
            area_sqm=r.area_sqm,
            description=r.description,
            created_at=r.created_at,
            updated_at=r.updated_at
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/rooms/{room_id}", response_model=RoomResponse)
async def get_room(room_id: str):
    r = config_service.get_room(room_id)
    if not r:
        raise HTTPException(status_code=404, detail=f"Room '{room_id}' not found.")
    return RoomResponse(
        id=r.id,
        floor_id=r.floor_id,
        name=r.name,
        room_number=r.room_number,
        area_sqm=r.area_sqm,
        description=r.description,
        created_at=r.created_at,
        updated_at=r.updated_at
    )


@router.put("/rooms/{room_id}", response_model=RoomResponse)
async def update_room(room_id: str, data: RoomUpdate):
    r = config_service.update_room(room_id, data)
    if not r:
        raise HTTPException(status_code=404, detail=f"Room '{room_id}' not found.")
    return RoomResponse(
        id=r.id,
        floor_id=r.floor_id,
        name=r.name,
        room_number=r.room_number,
        area_sqm=r.area_sqm,
        description=r.description,
        created_at=r.created_at,
        updated_at=r.updated_at
    )


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(room_id: str):
    success = config_service.delete_room(room_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Room '{room_id}' not found.")
    return None


# --- Equipment ---
@router.get("/equipment", response_model=List[EquipmentResponse])
async def list_equipment(
    category: Optional[EquipmentCategory] = None,
    room_id: Optional[str] = None
):
    items = config_service.get_equipment(category=category, room_id=room_id)
    return [
        EquipmentResponse(
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
        for eq in items
    ]


@router.post("/equipment", response_model=EquipmentResponse, status_code=status.HTTP_201_CREATED)
async def create_equipment(data: EquipmentCreate):
    try:
        eq = config_service.create_equipment(data)
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/equipment/{equipment_id}", response_model=EquipmentResponse)
async def get_equipment(equipment_id: str):
    eq = config_service.get_equipment_by_id(equipment_id)
    if not eq:
        raise HTTPException(status_code=404, detail=f"Equipment '{equipment_id}' not found.")
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


@router.put("/equipment/{equipment_id}", response_model=EquipmentResponse)
async def update_equipment(equipment_id: str, data: EquipmentUpdate):
    try:
        eq = config_service.update_equipment(equipment_id, data)
        if not eq:
            raise HTTPException(status_code=404, detail=f"Equipment '{equipment_id}' not found.")
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/equipment/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_equipment(equipment_id: str):
    success = config_service.delete_equipment(equipment_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Equipment '{equipment_id}' not found.")
    return None


# --- Relationships ---
@router.get("/relationships", response_model=List[RelationshipResponse])
async def list_relationships(
    source_id: Optional[str] = None,
    target_id: Optional[str] = None,
    relationship_type: Optional[RelationshipType] = None
):
    return [
        RelationshipResponse(
            id=r.id,
            source_id=r.source_id,
            source_type=r.source_type,
            relationship_type=r.relationship_type,
            target_id=r.target_id,
            target_type=r.target_type,
            description=r.description,
            created_at=r.created_at
        )
        for r in config_service.get_relationships(source_id, target_id, relationship_type)
    ]


@router.post("/relationships", response_model=RelationshipResponse, status_code=status.HTTP_201_CREATED)
async def create_relationship(data: RelationshipCreate):
    r = config_service.create_relationship(data)
    return RelationshipResponse(
        id=r.id,
        source_id=r.source_id,
        source_type=r.source_type,
        relationship_type=r.relationship_type,
        target_id=r.target_id,
        target_type=r.target_type,
        description=r.description,
        created_at=r.created_at
    )


@router.delete("/relationships/{relationship_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relationship(relationship_id: str):
    success = config_service.delete_relationship(relationship_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Relationship '{relationship_id}' not found.")
    return None
