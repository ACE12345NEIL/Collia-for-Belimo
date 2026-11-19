"""
BELIMO | Collia - CSV Folder Integration Router
Stage 4: CSV Folder Integration

Exposes CSVService endpoints under /api/csv prefix.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.app.csv_processing.csv_service import CSVService, CSVReadError
from backend.app.services.configuration_service import ConfigurationService

# ---------------------------------------------------------------------------
# Singleton service instances
# ---------------------------------------------------------------------------

csv_service = CSVService()
config_service = ConfigurationService()

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class MissingFileInfo(BaseModel):
    equipment_id: str
    equipment_name: str
    equipment_type: str
    expected_filename: str


class InvalidFileInfo(BaseModel):
    filename: str
    error_message: str


class EquipmentStatusInfo(BaseModel):
    equipment_id: str
    equipment_name: str
    equipment_type: str
    csv_filename: str
    status: str  # 'NO_FILE' | 'NO_DATA' | 'HAS_DATA' | 'INVALID'
    row_count: int = 0
    headers: List[str] = []
    created_dummy: bool = False


class ScanStatusResponse(BaseModel):
    csv_dir: str
    total_files_found: int
    found_files: List[str]
    missing_count: int
    missing_files: List[MissingFileInfo]
    invalid_count: int
    invalid_files: List[InvalidFileInfo]
    created_dummy_files: List[str] = []
    equipment_statuses: Dict[str, EquipmentStatusInfo] = {}
    scanned_at: str


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/csv", tags=["CSV Integration"])


def _build_scan_status(result) -> ScanStatusResponse:
    """Convert a ScanResult dataclass into a ScanStatusResponse."""
    eq_status_dict = {}
    for eq_id, item in getattr(result, "equipment_statuses", {}).items():
        eq_status_dict[eq_id] = EquipmentStatusInfo(
            equipment_id=item.equipment_id,
            equipment_name=item.equipment_name,
            equipment_type=item.equipment_type,
            csv_filename=item.csv_filename,
            status=item.status,
            row_count=item.row_count,
            headers=item.headers,
            created_dummy=item.created_dummy,
        )

    return ScanStatusResponse(
        csv_dir=str(csv_service.csv_dir),
        total_files_found=len(result.found_files),
        found_files=result.found_files,
        missing_count=len(result.missing_reports),
        missing_files=[
            MissingFileInfo(
                equipment_id=r.equipment_id,
                equipment_name=r.equipment_name,
                equipment_type=r.equipment_type,
                expected_filename=r.expected_filename,
            )
            for r in result.missing_reports
        ],
        invalid_count=len(result.invalid_reports),
        invalid_files=[
            InvalidFileInfo(filename=r.filename, error_message=r.error_message)
            for r in result.invalid_reports
        ],
        created_dummy_files=getattr(result, "created_dummy_files", []),
        equipment_statuses=eq_status_dict,
        scanned_at=result.scanned_at,
    )


@router.post("/open-directory", summary="Open CSV directory in OS file manager")
async def open_csv_directory():
    """Open the local data/csv/ folder in the host OS file explorer (Windows / Mac / Linux)."""
    opened = csv_service.open_csv_directory()
    return {
        "status": "opened" if opened else "failed_or_headless",
        "csv_dir": str(csv_service.csv_dir),
        "opened": opened,
    }


@router.get("/status", response_model=ScanStatusResponse, summary="CSV directory status")
async def get_csv_status():
    """Run a status check on CSV directory without creating dummy files."""
    result = csv_service.rescan(create_dummies_for_missing=False)
    return _build_scan_status(result)


@router.post("/process", response_model=ScanStatusResponse, summary="Scan and process CSVs")
async def process_csvs():
    """Scan and process CSV files without creating dummy files.

    Inspects headers, rows, and reports missing or invalid files.
    """
    result = csv_service.rescan(create_dummies_for_missing=False)
    return _build_scan_status(result)


@router.post("/create-dummy-files", response_model=ScanStatusResponse, summary="Create missing dummy CSV templates")
async def create_missing_dummy_files():
    """Create dummy CSV template files (headers only, 0 data rows) for any configured equipment missing its file."""
    result = csv_service.rescan(create_dummies_for_missing=True)
    return _build_scan_status(result)


@router.get("/files", summary="List CSV files")
async def list_csv_files():
    """Scan the CSV directory and return a sorted list of filenames."""
    files = csv_service.scan_directory()
    return {"files": files, "count": len(files)}


@router.get("/files/{filename}", summary="Inspect a CSV file")
async def inspect_csv_file(filename: str):
    """Return full data inspection (headers, row count, preview) for a CSV file."""
    try:
        data = csv_service.inspect_data(filename, max_rows=10)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    except CSVReadError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"filename": filename, **data}


@router.get("/files/{filename}/headers", summary="Inspect CSV headers only")
async def inspect_csv_headers(filename: str):
    """Return just the column headers for a CSV file."""
    try:
        headers = csv_service.inspect_headers(filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    except CSVReadError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"filename": filename, "headers": headers}


@router.get("/equipment/{equipment_id}/csv", summary="Get CSV data for equipment")
async def get_equipment_csv(equipment_id: str):
    """Return the CSV data associated with the given equipment ID."""
    equipment = config_service.get_equipment_by_id(equipment_id)
    if equipment is None:
        raise HTTPException(
            status_code=404,
            detail=f"Equipment not found: {equipment_id}",
        )

    csv_data = csv_service.get_equipment_csv_data(equipment)
    csv_filename = equipment.csv_filename or csv_service.get_expected_filename(equipment)

    status = "NO_FILE"
    if csv_data is not None:
        status = "HAS_DATA" if csv_data.get("row_count", 0) > 0 else "NO_DATA"
    elif csv_service.file_exists(csv_filename) if csv_filename else False:
        status = "NO_DATA"

    return {
        "equipment_id": equipment.id,
        "equipment_name": equipment.name,
        "csv_filename": csv_filename,
        "status": status,
        "data": csv_data,
    }


@router.post("/rescan", response_model=ScanStatusResponse, summary="Trigger a fresh rescan")
async def post_rescan():
    """Trigger a fresh rescan of the CSV directory and return the updated status."""
    result = csv_service.rescan(create_dummies_for_missing=False)
    return _build_scan_status(result)
