"""
BELIMO | Collia — Stage 5: Extraction Router

Exposes CSV extraction and data validation endpoints under /api/extraction prefix.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.app.csv_processing.extraction_service import (
    ExtractionService,
    ExtractedReading,
    ColumnMapping,
    ValidationFlag,
)
from backend.app.services.configuration_service import ConfigurationService

# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------

extraction_service = ExtractionService()
config_service = ConfigurationService()

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class ColumnMappingOut(BaseModel):
    source_column: str
    canonical_column: str
    is_timestamp: bool
    is_expected: bool
    is_unrecognised: bool


class ValidationFlagOut(BaseModel):
    row_index: int
    column: str
    source_value: Any
    flag_type: str
    detail: str


class ExtractedReadingOut(BaseModel):
    equipment_id: str
    equipment_name: str
    equipment_type: str
    source_csv: str
    extracted_at: str

    has_timestamp: bool
    timestamp_column: str
    latest_timestamp: Optional[str]
    total_rows: int
    valid_rows: int

    column_mappings: List[ColumnMappingOut] = []
    expected_columns_found: List[str] = []
    expected_columns_missing: List[str] = []
    unrecognised_columns: List[str] = []
    latest_readings: Dict[str, Any] = {}
    validation_flags: List[ValidationFlagOut] = []
    quality: str


class ExtractionReportOut(BaseModel):
    extracted_at: str
    total_equipment: int
    extracted_count: int
    empty_count: int
    missing_count: int
    error_count: int
    equipment_results: Dict[str, ExtractedReadingOut] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _reading_to_out(r: ExtractedReading) -> ExtractedReadingOut:
    return ExtractedReadingOut(
        equipment_id=r.equipment_id,
        equipment_name=r.equipment_name,
        equipment_type=r.equipment_type,
        source_csv=r.source_csv,
        extracted_at=r.extracted_at,
        has_timestamp=r.has_timestamp,
        timestamp_column=r.timestamp_column,
        latest_timestamp=r.latest_timestamp,
        total_rows=r.total_rows,
        valid_rows=r.valid_rows,
        column_mappings=[
            ColumnMappingOut(
                source_column=m.source_column,
                canonical_column=m.canonical_column,
                is_timestamp=m.is_timestamp,
                is_expected=m.is_expected,
                is_unrecognised=m.is_unrecognised,
            )
            for m in r.column_mappings
        ],
        expected_columns_found=r.expected_columns_found,
        expected_columns_missing=r.expected_columns_missing,
        unrecognised_columns=r.unrecognised_columns,
        latest_readings=r.latest_readings,
        validation_flags=[
            ValidationFlagOut(
                row_index=f.row_index,
                column=f.column,
                source_value=f.source_value,
                flag_type=f.flag_type,
                detail=f.detail,
            )
            for f in r.validation_flags
        ],
        quality=r.quality,
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/extraction", tags=["Stage 5 — CSV Extraction"])


@router.post("/run", response_model=ExtractionReportOut, summary="Run full Stage 5 extraction")
async def run_extraction():
    """
    Run Stage 5 extraction across all configured equipment.

    For each equipment item:
    - Locates the associated CSV file.
    - Maps columns to canonical parameter names (alias-aware).
    - Validates readings (nulls, type, range, timestamps).
    - Extracts the latest (last row) readings.
    - Saves structured output to data/processed/<equipment_id>.csv.
    - Returns a full extraction report.
    """
    equipment_list = config_service.get_equipment()
    report = extraction_service.run_full_extraction(equipment_list)
    return ExtractionReportOut(
        extracted_at=report.extracted_at,
        total_equipment=report.total_equipment,
        extracted_count=report.extracted_count,
        empty_count=report.empty_count,
        missing_count=report.missing_count,
        error_count=report.error_count,
        equipment_results={eid: _reading_to_out(r) for eid, r in report.equipment_results.items()},
    )


@router.get(
    "/equipment/{equipment_id}",
    response_model=ExtractedReadingOut,
    summary="Extract data for one equipment item",
)
async def extract_single(equipment_id: str):
    """
    Run Stage 5 extraction for a single equipment item and return its result.
    Does NOT save to disk — use POST /run to persist.
    """
    equipment = config_service.get_equipment_by_id(equipment_id)
    if equipment is None:
        raise HTTPException(status_code=404, detail=f"Equipment not found: {equipment_id}")

    reading = extraction_service.extract_equipment(equipment)
    return _reading_to_out(reading)


@router.get("/summary", summary="Extraction summary across all equipment")
async def extraction_summary():
    """
    Run extraction across all equipment and return only summary statistics
    (quality counts, latest readings per equipment) without full flag details.
    Faster than /run for dashboard display.
    """
    equipment_list = config_service.get_equipment()
    report = extraction_service.run_full_extraction(equipment_list)

    summary = []
    for eq_id, reading in report.equipment_results.items():
        summary.append({
            "equipment_id": reading.equipment_id,
            "equipment_name": reading.equipment_name,
            "equipment_type": reading.equipment_type,
            "source_csv": reading.source_csv,
            "quality": reading.quality,
            "total_rows": reading.total_rows,
            "valid_rows": reading.valid_rows,
            "latest_timestamp": reading.latest_timestamp,
            "latest_readings": reading.latest_readings,
            "expected_columns_missing": reading.expected_columns_missing,
            "unrecognised_columns": reading.unrecognised_columns,
            "flag_count": len(reading.validation_flags),
        })

    return {
        "extracted_at": report.extracted_at,
        "total_equipment": report.total_equipment,
        "extracted_count": report.extracted_count,
        "empty_count": report.empty_count,
        "missing_count": report.missing_count,
        "error_count": report.error_count,
        "equipment": summary,
    }
