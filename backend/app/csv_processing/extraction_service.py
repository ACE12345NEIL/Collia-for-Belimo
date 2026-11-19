"""
BELIMO | Collia — Stage 5: CSV Extraction and Data Validation Service

Responsibilities:
1. Identify available parameters per equipment type.
2. Identify and parse timestamps.
3. Map CSV columns to canonical parameter names.
4. Handle different CSV structures without assumptions.
5. Validate extracted readings (type, range, nulls, consistency).
6. Identify missing or inconsistent information.
7. Preserve source references (filename, column name, row index).
8. Produce structured ExtractedReading objects saved to data/processed/.
"""

from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from backend.app.models.entity import Equipment, EquipmentType
from backend.app.csv_processing.csv_service import (
    CSVService,
    EQUIPMENT_CSV_COLUMNS,
    CSVReadError,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Column name aliases — maps common variant spellings to canonical column name
# This handles structural differences between CSV files without hardcoding.
# ---------------------------------------------------------------------------

COLUMN_ALIASES: Dict[str, str] = {
    # Timestamp variants
    "timestamp": "Timestamp",
    "time": "Timestamp",
    "datetime": "Timestamp",
    "date_time": "Timestamp",
    "date": "Timestamp",

    # RAQS
    "temperature": "Temperature",
    "temp": "Temperature",
    "humidity": "Humidity",
    "relative_humidity": "Humidity",
    "rh": "Humidity",
    "co2": "CO2",
    "co_2": "CO2",
    "co2_ppm": "CO2",

    # VAV
    "airflow": "Airflow",
    "air_flow": "Airflow",
    "flow": "Airflow",
    "pressure": "Pressure",
    "static_pressure": "Pressure",

    # EV
    "actuator_position": "Actuator_Position",
    "valve_opening": "Actuator_Position",
    "valve_position": "Actuator_Position",
    "flow_rate": "Flow_Rate",
    "flowrate": "Flow_Rate",
    "t1": "T1",
    "t2": "T2",
    "tonnage": "Tonnage",
    "power": "Tonnage",
    "control_signal": "Control_Signal",
    "control": "Control_Signal",
    "setpoint": "Control_Signal",

    # AHU
    "fan_speed": "Fan_Speed",
    "fan_rpm": "Fan_Speed",
    "return_air_temp": "Return_Air_Temp",
    "return_air_temperature": "Return_Air_Temp",
    "rat": "Return_Air_Temp",
    "supply_air_temp": "Supply_Air_Temp",
    "supply_air_temperature": "Supply_Air_Temp",
    "sat": "Supply_Air_Temp",
    "filter_status": "Filter_Status",
    "filter": "Filter_Status",
    "heat_recovery_wheel_status": "Heat_Recovery_Wheel_Status",
    "hrw_status": "Heat_Recovery_Wheel_Status",
    "hrw": "Heat_Recovery_Wheel_Status",

    # Chiller
    "operating_status": "Operating_Status",
    "on_off": "Operating_Status",
    "status": "Operating_Status",
    "compressor_speed": "Compressor_Speed",
    "chw_supply_temp": "CHW_Supply_Temp",
    "chilled_water_supply_temp": "CHW_Supply_Temp",
    "chw_supply_pressure": "CHW_Supply_Pressure",
    "chilled_water_supply_pressure": "CHW_Supply_Pressure",
    "chw_supply_flow": "CHW_Supply_Flow",
    "chilled_water_supply_flow": "CHW_Supply_Flow",
    "chw_return_temp": "CHW_Return_Temp",
    "chilled_water_return_temp": "CHW_Return_Temp",
    "chw_return_pressure": "CHW_Return_Pressure",
    "chilled_water_return_pressure": "CHW_Return_Pressure",
    "chw_return_flow": "CHW_Return_Flow",
    "chilled_water_return_flow": "CHW_Return_Flow",
}

# ---------------------------------------------------------------------------
# Acceptable numeric ranges per canonical column name (soft validation)
# Out-of-range values are flagged, NOT discarded.
# ---------------------------------------------------------------------------

PARAMETER_RANGES: Dict[str, Tuple[float, float]] = {
    "Temperature":          (-10.0,   60.0),
    "Humidity":             (0.0,    100.0),
    "CO2":                  (300.0, 5000.0),
    "Airflow":              (0.0,  10000.0),
    "Pressure":             (0.0,   1000.0),
    "Actuator_Position":    (0.0,    100.0),
    "Flow_Rate":            (0.0,   2000.0),
    "T1":                   (-5.0,    30.0),
    "T2":                   (-5.0,    30.0),
    "Tonnage":              (0.0,   500.0),
    "Control_Signal":       (0.0,    100.0),
    "Fan_Speed":            (0.0,   5000.0),
    "Return_Air_Temp":      (0.0,     60.0),
    "Supply_Air_Temp":      (0.0,     60.0),
    "Filter_Status":        (0.0,      1.0),
    "Heat_Recovery_Wheel_Status": (0.0, 1.0),
    "Operating_Status":     (0.0,      1.0),
    "Compressor_Speed":     (0.0,    100.0),
    "CHW_Supply_Temp":      (0.0,     30.0),
    "CHW_Supply_Pressure":  (0.0,     20.0),
    "CHW_Supply_Flow":      (0.0,   2000.0),
    "CHW_Return_Temp":      (0.0,     30.0),
    "CHW_Return_Pressure":  (0.0,     20.0),
    "CHW_Return_Flow":      (0.0,   2000.0),
}

# ---------------------------------------------------------------------------
# Data classes — structured output of Stage 5
# ---------------------------------------------------------------------------


@dataclass
class ColumnMapping:
    """Describes one column found in the CSV and how it was resolved."""
    source_column: str          # Exact column name from the CSV
    canonical_column: str       # Mapped standard name (may equal source_column)
    is_timestamp: bool = False
    is_expected: bool = False   # True if canonical_column is in EQUIPMENT_CSV_COLUMNS
    is_unrecognised: bool = False


@dataclass
class ValidationFlag:
    """A single validation finding against one value in the CSV."""
    row_index: int              # 0-based data row index (not including header)
    column: str                 # Canonical column name
    source_value: Any           # Raw value from CSV
    flag_type: str              # 'NULL' | 'NON_NUMERIC' | 'OUT_OF_RANGE' | 'INVALID_TIMESTAMP'
    detail: str                 # Human-readable explanation


@dataclass
class ExtractedReading:
    """
    Structured result of Stage 5 extraction for one piece of equipment.
    Stored as a CSV row in data/processed/<equipment_id>.csv.
    """
    equipment_id: str
    equipment_name: str
    equipment_type: str
    source_csv: str                                 # Original CSV filename
    extracted_at: str                               # ISO-8601 UTC

    # Timestamp info
    has_timestamp: bool
    timestamp_column: str                           # Source column name used for timestamps
    latest_timestamp: Optional[str]                 # ISO-8601 of last row's timestamp
    total_rows: int
    valid_rows: int                                 # Rows with no NULL in expected columns

    # Column mapping results
    column_mappings: List[ColumnMapping] = field(default_factory=list)
    expected_columns_found: List[str] = field(default_factory=list)
    expected_columns_missing: List[str] = field(default_factory=list)
    unrecognised_columns: List[str] = field(default_factory=list)

    # Latest valid readings (key = canonical_column, value = last non-null value)
    latest_readings: Dict[str, Any] = field(default_factory=dict)

    # Validation findings
    validation_flags: List[ValidationFlag] = field(default_factory=list)

    # Overall quality
    quality: str = "UNKNOWN"    # 'GOOD' | 'PARTIAL' | 'EMPTY' | 'INVALID'


@dataclass
class ExtractionReport:
    """Full Stage 5 extraction report across all configured equipment."""
    extracted_at: str
    equipment_results: Dict[str, ExtractedReading] = field(default_factory=dict)
    total_equipment: int = 0
    extracted_count: int = 0    # Equipment with HAS_DATA files
    empty_count: int = 0        # Equipment with NO_DATA files (header only)
    missing_count: int = 0      # Equipment with NO_FILE
    error_count: int = 0        # Equipment whose CSV could not be parsed


def _clean_numeric_value(raw_val: Any) -> Tuple[Optional[float], bool]:
    """
    Cleans raw value: handles numbers directly, or string with units like '22.3 °C', '1,250', or '100%'.
    Returns (float_value, is_numeric).
    If null or blank representation, returns (None, True).
    If unparseable non-numeric string (e.g. 'ERR', 'offline'), returns (None, False).
    """
    if pd.isna(raw_val) or raw_val is None:
        return None, True
    if isinstance(raw_val, (int, float)):
        val = float(raw_val)
        return (None, True) if (math.isnan(val) or math.isinf(val)) else (val, True)

    s = str(raw_val).strip()
    if s in ("", "--", "—", "N/A", "n/a", "null", "None", "-", "NaN", "nan"):
        return None, True

    # Strip common HVAC units: °C, °F, %, ppm, rpm, l/s, m3/h, m³/h, kpa, pa, bar, kw, tr, ton, tons
    cleaned = re.sub(r'(?i)[°\s]*(c|f|ppm|rpm|l/s|m3/h|m³/h|kpa|pa|bar|kw|tr|ton|tons|%)\s*$', '', s).strip()
    cleaned = cleaned.replace(',', '')  # remove thousands separators like 1,250
    try:
        val = float(cleaned)
        return (None, True) if (math.isnan(val) or math.isinf(val)) else (val, True)
    except (ValueError, TypeError):
        return None, False


# ---------------------------------------------------------------------------
# Extraction Service
# ---------------------------------------------------------------------------


class ExtractionService:
    """
    Stage 5 service: Extract, map, validate, and persist structured data
    from equipment CSV files.
    """

    def __init__(
        self,
        csv_dir: Optional[Path] = None,
        processed_dir: Optional[Path] = None,
    ) -> None:
        self.csv_service = CSVService(csv_dir)

        if processed_dir is None:
            project_root = Path(__file__).resolve().parent.parent.parent.parent
            self.processed_dir: Path = project_root / "data" / "processed"
        else:
            self.processed_dir = Path(processed_dir).resolve()

        self.processed_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Column mapping
    # ------------------------------------------------------------------

    def _map_columns(
        self,
        actual_columns: List[str],
        expected_columns: List[str],
    ) -> List[ColumnMapping]:
        """
        Map each column found in the CSV to its canonical name.
        Uses exact match first, then lowercase alias lookup.
        """
        expected_set = set(expected_columns)
        mappings: List[ColumnMapping] = []

        for col in actual_columns:
            canonical = col  # Default: use as-is
            # Try exact match against expected columns
            if col in expected_set:
                canonical = col
            else:
                # Try alias lookup (case-insensitive)
                alias_key = col.lower().strip()
                if alias_key in COLUMN_ALIASES:
                    canonical = COLUMN_ALIASES[alias_key]

            is_ts = canonical == "Timestamp"
            is_expected = canonical in expected_set
            is_unrecognised = (not is_ts) and (not is_expected) and (canonical not in expected_set)

            mappings.append(ColumnMapping(
                source_column=col,
                canonical_column=canonical,
                is_timestamp=is_ts,
                is_expected=is_expected,
                is_unrecognised=is_unrecognised,
            ))

        return mappings

    # ------------------------------------------------------------------
    # Timestamp detection and parsing
    # ------------------------------------------------------------------

    def _detect_timestamp_column(self, df: pd.DataFrame, mappings: List[ColumnMapping]) -> Optional[str]:
        """Return the source column name used as timestamp, or None."""
        for m in mappings:
            if m.is_timestamp:
                return m.source_column
        return None

    def _parse_timestamp(self, value: Any) -> Optional[datetime]:
        """Try to parse a value as a datetime. Returns None on failure."""
        if pd.isna(value):
            return None
        try:
            return pd.to_datetime(value, utc=False).to_pydatetime()
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate_dataframe(
        self,
        df: pd.DataFrame,
        mappings: List[ColumnMapping],
        ts_col: Optional[str],
    ) -> List[ValidationFlag]:
        """
        Validate all rows in the dataframe.
        Checks:
        - null values
        - non-numeric in numeric columns (with unit tolerance)
        - out-of-range readings
        - discrete value validity (0 or 1 for binary status columns)
        - invalid, duplicate, or non-chronological timestamps
        - inter-system physical consistency (Chiller Return >= Supply, EV T2 >= T1, AHU SAT <= RAT)
        - completely empty columns across all rows
        """
        flags: List[ValidationFlag] = []
        col_to_canonical = {m.source_column: m.canonical_column for m in mappings}

        seen_timestamps = set()
        prev_parsed_ts: Optional[datetime] = None

        discrete_binary_cols = {
            "Operating_Status",
            "Filter_Status",
            "Heat_Recovery_Wheel_Status",
        }

        for row_idx, row in df.iterrows():
            row_numeric_values: Dict[str, Optional[float]] = {}

            for src_col, canonical in col_to_canonical.items():
                if src_col not in df.columns:
                    continue
                raw_val = row[src_col]

                # 1. Timestamp column — validate parsability and chronological order
                if src_col == ts_col:
                    if pd.isna(raw_val) or str(raw_val).strip() == "":
                        flags.append(ValidationFlag(
                            row_index=int(row_idx),
                            column=canonical,
                            source_value=raw_val,
                            flag_type="INVALID_TIMESTAMP",
                            detail=f"Row {row_idx}: Timestamp is null or empty.",
                        ))
                    else:
                        parsed_ts = self._parse_timestamp(raw_val)
                        if parsed_ts is None:
                            flags.append(ValidationFlag(
                                row_index=int(row_idx),
                                column=canonical,
                                source_value=raw_val,
                                flag_type="INVALID_TIMESTAMP",
                                detail=f"Row {row_idx}: Cannot parse '{raw_val}' as a valid timestamp.",
                            ))
                        else:
                            ts_key = parsed_ts.isoformat()
                            if ts_key in seen_timestamps:
                                flags.append(ValidationFlag(
                                    row_index=int(row_idx),
                                    column=canonical,
                                    source_value=raw_val,
                                    flag_type="DUPLICATE_TIMESTAMP",
                                    detail=f"Row {row_idx}: Duplicate timestamp '{raw_val}' detected.",
                                ))
                            seen_timestamps.add(ts_key)

                            if prev_parsed_ts and parsed_ts < prev_parsed_ts:
                                flags.append(ValidationFlag(
                                    row_index=int(row_idx),
                                    column=canonical,
                                    source_value=raw_val,
                                    flag_type="INCONSISTENT_TIMESTAMP",
                                    detail=(
                                        f"Row {row_idx}: Timestamp '{raw_val}' is not in chronological order "
                                        f"(precedes previous row)."
                                    ),
                                ))
                            prev_parsed_ts = parsed_ts
                    continue

                # 2. Expected numeric columns
                numeric_val, is_num = _clean_numeric_value(raw_val)

                if not is_num:
                    flags.append(ValidationFlag(
                        row_index=int(row_idx),
                        column=canonical,
                        source_value=raw_val,
                        flag_type="NON_NUMERIC",
                        detail=f"Row {row_idx}: '{raw_val}' is not a valid number for column '{canonical}'.",
                    ))
                    row_numeric_values[canonical] = None
                    continue

                if numeric_val is None:
                    flags.append(ValidationFlag(
                        row_index=int(row_idx),
                        column=canonical,
                        source_value=None,
                        flag_type="NULL",
                        detail=f"Row {row_idx}: Column '{canonical}' is null/missing.",
                    ))
                    row_numeric_values[canonical] = None
                    continue

                row_numeric_values[canonical] = numeric_val

                # 3. Discrete binary check
                if canonical in discrete_binary_cols:
                    if numeric_val not in (0.0, 1.0):
                        flags.append(ValidationFlag(
                            row_index=int(row_idx),
                            column=canonical,
                            source_value=numeric_val,
                            flag_type="INVALID_DISCRETE_VALUE",
                            detail=f"Row {row_idx}: {canonical} must be 0 or 1, found {numeric_val}.",
                        ))

                # 4. Physical Range check
                if canonical in PARAMETER_RANGES:
                    lo, hi = PARAMETER_RANGES[canonical]
                    if not (lo <= numeric_val <= hi):
                        flags.append(ValidationFlag(
                            row_index=int(row_idx),
                            column=canonical,
                            source_value=numeric_val,
                            flag_type="OUT_OF_RANGE",
                            detail=(
                                f"Row {row_idx}: {canonical} = {numeric_val} "
                                f"is outside expected range [{lo}, {hi}]."
                            ),
                        ))

            # 5. Intersystem / Physical consistency checks per row
            # Chiller: Return Temp must be >= Supply Temp
            ret_t = row_numeric_values.get("CHW_Return_Temp")
            sup_t = row_numeric_values.get("CHW_Supply_Temp")
            if ret_t is not None and sup_t is not None and ret_t < sup_t:
                flags.append(ValidationFlag(
                    row_index=int(row_idx),
                    column="CHW_Return_Temp",
                    source_value=ret_t,
                    flag_type="INCONSISTENT_READINGS",
                    detail=(
                        f"Row {row_idx}: Inconsistent CHW temperatures — Return Temp ({ret_t}°C) "
                        f"is lower than Supply Temp ({sup_t}°C)."
                    ),
                ))

            # Chiller: Operating_Status == 0 but Compressor_Speed active
            op_st = row_numeric_values.get("Operating_Status")
            comp_spd = row_numeric_values.get("Compressor_Speed")
            if op_st == 0.0 and comp_spd is not None and comp_spd > 5.0:
                flags.append(ValidationFlag(
                    row_index=int(row_idx),
                    column="Compressor_Speed",
                    source_value=comp_spd,
                    flag_type="INCONSISTENT_READINGS",
                    detail=(
                        f"Row {row_idx}: Inconsistent state — Chiller is OFF (Operating_Status=0) "
                        f"but Compressor_Speed is active ({comp_spd}%)."
                    ),
                ))

            # EV: T2 (return) should be >= T1 (supply)
            t1 = row_numeric_values.get("T1")
            t2 = row_numeric_values.get("T2")
            if t1 is not None and t2 is not None and t2 < t1:
                flags.append(ValidationFlag(
                    row_index=int(row_idx),
                    column="T2",
                    source_value=t2,
                    flag_type="INCONSISTENT_READINGS",
                    detail=(
                        f"Row {row_idx}: Inconsistent EV temperatures — Return T2 ({t2}°C) "
                        f"is lower than Supply T1 ({t1}°C), resulting in negative ΔT."
                    ),
                ))

            # AHU: Supply_Air_Temp vs Return_Air_Temp
            rat = row_numeric_values.get("Return_Air_Temp")
            sat = row_numeric_values.get("Supply_Air_Temp")
            if rat is not None and sat is not None and sat > rat + 2.0:
                flags.append(ValidationFlag(
                    row_index=int(row_idx),
                    column="Supply_Air_Temp",
                    source_value=sat,
                    flag_type="INCONSISTENT_READINGS",
                    detail=(
                        f"Row {row_idx}: Inconsistent AHU air temperatures — Supply Air Temp ({sat}°C) "
                        f"is higher than Return Air Temp ({rat}°C)."
                    ),
                ))

        # 6. Flag any columns present in header that have 0 valid readings across all rows
        if not df.empty:
            for m in mappings:
                if not m.is_timestamp and m.source_column in df.columns:
                    col_series = df[m.source_column]
                    non_nulls = [
                        v for v in col_series
                        if not pd.isna(v) and str(v).strip() not in ("", "--", "—", "N/A", "null")
                    ]
                    if len(non_nulls) == 0:
                        flags.append(ValidationFlag(
                            row_index=-1,
                            column=m.canonical_column,
                            source_value=None,
                            flag_type="EMPTY_COLUMN",
                            detail=(
                                f"Column '{m.canonical_column}' (source: '{m.source_column}') is present "
                                f"in CSV header but contains 0 valid readings across all {len(df)} rows."
                            ),
                        ))

        return flags

    # ------------------------------------------------------------------
    # Latest readings
    # ------------------------------------------------------------------

    def _extract_latest_readings(
        self,
        df: pd.DataFrame,
        mappings: List[ColumnMapping],
        ts_col: Optional[str],
    ) -> Dict[str, Any]:
        """
        Return the last non-null value for each expected (non-timestamp) column.
        Uses canonical column names as keys.
        Drops entirely blank trailing lines before taking the last row.
        """
        if df.empty:
            return {}

        # Drop entirely blank trailing rows (e.g. Excel export artifacts)
        df_clean = df.dropna(how="all")
        if df_clean.empty:
            df_clean = df

        # Use last row per spec ("if there are multiple rows, refer to the last one")
        last_row = df_clean.iloc[-1]
        readings: Dict[str, Any] = {}

        for m in mappings:
            if m.is_timestamp or m.source_column == ts_col:
                continue
            if m.source_column not in df_clean.columns:
                continue
            val = last_row[m.source_column]
            num_val, is_num = _clean_numeric_value(val)
            if not is_num or num_val is None:
                readings[m.canonical_column] = None if pd.isna(val) or str(val).strip() in ("", "--") else str(val)
            else:
                readings[m.canonical_column] = num_val

        return readings

    # ------------------------------------------------------------------
    # Latest timestamp
    # ------------------------------------------------------------------

    def _extract_latest_timestamp(
        self,
        df: pd.DataFrame,
        ts_col: Optional[str],
    ) -> Optional[str]:
        """Return the ISO-8601 string of the last row's timestamp, or None."""
        if ts_col is None or df.empty:
            return None
        if ts_col not in df.columns:
            return None

        # Drop entirely blank trailing rows
        df_clean = df.dropna(how="all")
        if df_clean.empty:
            df_clean = df

        val = df_clean.iloc[-1][ts_col]
        parsed = self._parse_timestamp(val)
        if parsed:
            return parsed.isoformat()
        return str(val) if not pd.isna(val) else None

    # ------------------------------------------------------------------
    # Quality assessment
    # ------------------------------------------------------------------

    def _assess_quality(
        self,
        total_rows: int,
        valid_rows: int,
        flags: List[ValidationFlag],
        expected_missing: List[str],
    ) -> str:
        """
        GOOD    — data present, all expected columns found, no critical flags.
        PARTIAL — data present but some expected columns missing or critical flags.
        EMPTY   — file exists but has no data rows.
        INVALID — file missing or cannot parse file.
        """
        if total_rows == 0:
            return "EMPTY"
        if expected_missing:
            return "PARTIAL"
        critical = [
            f for f in flags if f.flag_type in (
                "NON_NUMERIC", "INVALID_TIMESTAMP", "MISSING_COLUMN",
                "MISSING_TIMESTAMP_COLUMN", "EMPTY_COLUMN", "INCONSISTENT_READINGS",
                "INVALID_DISCRETE_VALUE"
            )
        ]
        null_flags = [f for f in flags if f.flag_type in ("NULL", "LAST_ROW_NULL")]
        if critical:
            return "PARTIAL"
        if len(null_flags) > total_rows * 0.3:
            return "PARTIAL"
        return "GOOD"

    # ------------------------------------------------------------------
    # Core extraction for a single equipment item
    # ------------------------------------------------------------------

    def extract_equipment(self, equipment: Equipment) -> ExtractedReading:
        """
        Run full Stage 5 extraction pipeline for one equipment item.
        Returns an ExtractedReading regardless of whether data exists.
        """
        now_utc = datetime.now(timezone.utc).isoformat()
        expected_cols = EQUIPMENT_CSV_COLUMNS.get(equipment.equipment_type, [])
        # Strip Timestamp from expected parameter columns
        expected_params = [c for c in expected_cols if c != "Timestamp"]

        filename = equipment.csv_filename or self.csv_service.get_expected_filename(equipment)

        # Base result shell
        result = ExtractedReading(
            equipment_id=equipment.id,
            equipment_name=equipment.name,
            equipment_type=equipment.equipment_type.value,
            source_csv=filename,
            extracted_at=now_utc,
            has_timestamp=False,
            timestamp_column="",
            latest_timestamp=None,
            total_rows=0,
            valid_rows=0,
            quality="EMPTY",
        )

        # --- Check file existence ---
        try:
            exists = self.csv_service.file_exists(filename)
        except ValueError:
            exists = False

        if not exists:
            result.quality = "INVALID"
            result.expected_columns_missing = expected_params
            flags = [
                ValidationFlag(
                    row_index=-1,
                    column="CSV",
                    source_value=filename,
                    flag_type="MISSING_FILE",
                    detail=f"Configured CSV file '{filename}' was not found in data/csv/.",
                )
            ]
            for mc in expected_params:
                flags.append(ValidationFlag(
                    row_index=-1,
                    column=mc,
                    source_value=None,
                    flag_type="MISSING_COLUMN",
                    detail=f"Expected column '{mc}' is missing because CSV file is not present.",
                ))
            result.validation_flags = flags
            return result

        # --- Read CSV ---
        try:
            df = self.csv_service.read_csv(filename)
        except CSVReadError as exc:
            result.quality = "INVALID"
            result.validation_flags = [
                ValidationFlag(
                    row_index=-1,
                    column="CSV",
                    source_value=filename,
                    flag_type="PARSE_ERROR",
                    detail=f"CSV file '{filename}' failed to parse: {exc}",
                )
            ]
            logger.warning(f"[Stage5] Cannot read {filename}: {exc}")
            return result

        # --- Map columns ---
        actual_cols = list(df.columns)
        mappings = self._map_columns(actual_cols, expected_cols)
        result.column_mappings = mappings

        # Identify canonical columns found and missing
        found_canonical = {m.canonical_column for m in mappings}
        result.expected_columns_found = [c for c in expected_params if c in found_canonical]
        result.expected_columns_missing = [c for c in expected_params if c not in found_canonical]
        result.unrecognised_columns = [
            m.source_column for m in mappings if m.is_unrecognised
        ]

        # --- Timestamp ---
        ts_col = self._detect_timestamp_column(df, mappings)
        result.has_timestamp = ts_col is not None
        result.timestamp_column = ts_col or ""

        # --- Row counts ---
        total_rows = len(df)
        result.total_rows = total_rows

        if total_rows == 0:
            result.quality = "EMPTY"
            empty_flags = [
                ValidationFlag(
                    row_index=-1,
                    column="CSV",
                    source_value=filename,
                    flag_type="EMPTY_FILE",
                    detail=f"CSV file '{filename}' contains 0 data rows (header only).",
                )
            ]
            for mc in result.expected_columns_missing:
                empty_flags.append(ValidationFlag(
                    row_index=-1,
                    column=mc,
                    source_value=None,
                    flag_type="MISSING_COLUMN",
                    detail=f"Expected equipment parameter '{mc}' is missing from CSV header.",
                ))
            if not result.has_timestamp:
                empty_flags.append(ValidationFlag(
                    row_index=-1,
                    column="Timestamp",
                    source_value=None,
                    flag_type="MISSING_TIMESTAMP_COLUMN",
                    detail="No Timestamp column found in CSV header.",
                ))
            result.validation_flags = empty_flags
            return result

        # Count valid rows (no NaN in expected parameter columns)
        expected_src_cols = [
            m.source_column for m in mappings
            if m.canonical_column in expected_params and m.source_column in df.columns
        ]
        if expected_src_cols:
            valid_mask = df[expected_src_cols].notna().all(axis=1)
            result.valid_rows = int(valid_mask.sum())
        else:
            result.valid_rows = total_rows

        # --- Validate Dataframe ---
        flags = self._validate_dataframe(df, mappings, ts_col)

        # Flag missing columns as requested by user
        for missing_col in result.expected_columns_missing:
            flags.append(ValidationFlag(
                row_index=-1,
                column=missing_col,
                source_value=None,
                flag_type="MISSING_COLUMN",
                detail=f"Expected equipment parameter '{missing_col}' is missing from CSV header.",
            ))

        if not result.has_timestamp:
            flags.append(ValidationFlag(
                row_index=-1,
                column="Timestamp",
                source_value=None,
                flag_type="MISSING_TIMESTAMP_COLUMN",
                detail="Timestamp column was not found in CSV header.",
            ))

        # --- Latest readings (last row per spec) ---
        result.latest_readings = self._extract_latest_readings(df, mappings, ts_col)
        result.latest_timestamp = self._extract_latest_timestamp(df, ts_col)

        # Flag any parameter that is null in the last row
        for param_name in result.expected_columns_found:
            if result.latest_readings.get(param_name) is None:
                flags.append(ValidationFlag(
                    row_index=total_rows - 1,
                    column=param_name,
                    source_value=None,
                    flag_type="LAST_ROW_NULL",
                    detail=f"Last row has null/missing reading for expected parameter '{param_name}'.",
                ))

        result.validation_flags = flags

        # --- Quality ---
        result.quality = self._assess_quality(
            total_rows, result.valid_rows, flags, result.expected_columns_missing
        )

        return result

    # ------------------------------------------------------------------
    # Persist structured output
    # ------------------------------------------------------------------

    def _persist_extraction(self, reading: ExtractedReading) -> Path:
        """
        Save the latest readings for one equipment item to data/processed/<equipment_id>.csv.
        One row per extraction run (append mode) so history is preserved.
        """
        output_path = self.processed_dir / f"{reading.equipment_id}.csv"

        # Flatten latest readings into one row
        row: Dict[str, Any] = {
            "extracted_at": reading.extracted_at,
            "source_csv": reading.source_csv,
            "quality": reading.quality,
            "total_rows": reading.total_rows,
            "valid_rows": reading.valid_rows,
            "latest_timestamp": reading.latest_timestamp or "",
            "validation_flag_count": len(reading.validation_flags),
        }
        row.update(reading.latest_readings)

        row_df = pd.DataFrame([row])

        if output_path.exists():
            existing = pd.read_csv(output_path)
            combined = pd.concat([existing, row_df], ignore_index=True)
            combined.to_csv(output_path, index=False)
        else:
            row_df.to_csv(output_path, index=False)

        return output_path

    # ------------------------------------------------------------------
    # Full extraction run across all configured equipment
    # ------------------------------------------------------------------

    def run_full_extraction(self, equipment_list: List[Equipment]) -> ExtractionReport:
        """
        Run Stage 5 extraction for all configured equipment items.
        Persists results to data/processed/.
        Returns a full ExtractionReport.
        """
        now_utc = datetime.now(timezone.utc).isoformat()
        report = ExtractionReport(
            extracted_at=now_utc,
            total_equipment=len(equipment_list),
        )

        for eq in equipment_list:
            try:
                reading = self.extract_equipment(eq)
                report.equipment_results[eq.id] = reading

                if reading.quality == "GOOD" or reading.quality == "PARTIAL":
                    report.extracted_count += 1
                elif reading.quality == "EMPTY":
                    report.empty_count += 1
                elif reading.quality == "INVALID":
                    if reading.total_rows == 0 and reading.source_csv:
                        report.missing_count += 1
                    else:
                        report.error_count += 1

                # Persist if there's data to store
                if reading.total_rows > 0:
                    self._persist_extraction(reading)

            except Exception as exc:
                logger.error(f"[Stage5] Unexpected error processing {eq.id}: {exc}", exc_info=True)
                report.error_count += 1

        return report
