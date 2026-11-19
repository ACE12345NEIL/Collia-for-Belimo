"""
Stage 5 — CSV Extraction and Data Validation Tests
Tests extraction_service.py for:
  1. Column mapping (exact, alias, unrecognised)
  2. Timestamp detection and parsing
  3. Latest-reading extraction (last row)
  4. Validation flags (NULL, NON_NUMERIC, OUT_OF_RANGE, INVALID_TIMESTAMP)
  5. Quality assessment (GOOD / PARTIAL / EMPTY / INVALID)
  6. Full extraction pipeline with mock CSV files
"""

import io
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

import pandas as pd

# ---------------------------------------------------------------------------
# Minimal stubs so the import chain resolves without a running FastAPI server
# ---------------------------------------------------------------------------

# Stub backend package
backend_pkg = types.ModuleType("backend")
backend_app_pkg = types.ModuleType("backend.app")
backend_models_pkg = types.ModuleType("backend.app.models")
backend_csv_pkg = types.ModuleType("backend.app.csv_processing")
backend_services_pkg = types.ModuleType("backend.app.services")

sys.modules.setdefault("backend", backend_pkg)
sys.modules.setdefault("backend.app", backend_app_pkg)
sys.modules.setdefault("backend.app.models", backend_models_pkg)
sys.modules.setdefault("backend.app.csv_processing", backend_csv_pkg)
sys.modules.setdefault("backend.app.services", backend_services_pkg)

# Stub entity model
from enum import Enum


class EquipmentType(str, Enum):
    RAQS = "RAQS"
    VAV = "VAV"
    EV = "EV"
    AHU = "AHU"
    CHILLER = "CHILLER"


class EquipmentCategory(str, Enum):
    ROOM_LEVEL = "ROOM_LEVEL"
    SHARED = "SHARED"


@dataclass
class Equipment:
    id: str
    equipment_type: EquipmentType
    category: EquipmentCategory
    name: str
    description: str = ""
    csv_filename: str = ""
    room_id: Optional[str] = None
    building_id: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""


entity_module = types.ModuleType("backend.app.models.entity")
entity_module.Equipment = Equipment
entity_module.EquipmentType = EquipmentType
entity_module.EquipmentCategory = EquipmentCategory
entity_module.EQUIPMENT_PARAMETERS = {}
sys.modules["backend.app.models.entity"] = entity_module

# Stub csv_service
EQUIPMENT_CSV_COLUMNS_STUB = {
    EquipmentType.RAQS:    ["Timestamp", "Temperature", "Humidity", "CO2"],
    EquipmentType.VAV:     ["Timestamp", "Airflow", "Temperature", "Pressure"],
    EquipmentType.EV:      ["Timestamp", "Actuator_Position", "Flow_Rate", "T1", "T2", "Tonnage", "Control_Signal"],
    EquipmentType.AHU:     ["Timestamp", "Fan_Speed", "Airflow", "Flow_Rate", "T1", "T2", "Tonnage",
                            "Return_Air_Temp", "Supply_Air_Temp", "Filter_Status", "Heat_Recovery_Wheel_Status"],
    EquipmentType.CHILLER: ["Timestamp", "Operating_Status", "Compressor_Speed", "CHW_Supply_Temp",
                            "CHW_Supply_Pressure", "CHW_Supply_Flow", "CHW_Return_Temp",
                            "CHW_Return_Pressure", "CHW_Return_Flow"],
}


class CSVReadErrorStub(Exception):
    pass


class CSVServiceStub:
    """Minimal stub — real methods are replaced per-test via MagicMock."""
    pass


csv_service_module = types.ModuleType("backend.app.csv_processing.csv_service")
csv_service_module.EQUIPMENT_CSV_COLUMNS = EQUIPMENT_CSV_COLUMNS_STUB
csv_service_module.CSVReadError = CSVReadErrorStub
csv_service_module.CSVService = CSVServiceStub
sys.modules["backend.app.csv_processing.csv_service"] = csv_service_module

# ---------------------------------------------------------------------------
# Now import the real extraction service (it will pick up our stubs)
# ---------------------------------------------------------------------------

# Point sys.modules so the real module can find our stubs
sys.modules["backend.app.csv_processing.csv_service"] = csv_service_module
sys.modules["backend.app.models.entity"] = entity_module

import importlib, importlib.util, os

_svc_path = os.path.join(
    os.path.dirname(__file__), "..", "backend", "app", "csv_processing", "extraction_service.py"
)
_spec = importlib.util.spec_from_file_location("backend.app.csv_processing.extraction_service", _svc_path)
es_module = importlib.util.module_from_spec(_spec)
sys.modules["backend.app.csv_processing.extraction_service"] = es_module
_spec.loader.exec_module(es_module)

ExtractionService = es_module.ExtractionService
ColumnMapping = es_module.ColumnMapping
ValidationFlag = es_module.ValidationFlag
COLUMN_ALIASES = es_module.COLUMN_ALIASES
PARAMETER_RANGES = es_module.PARAMETER_RANGES


# ---------------------------------------------------------------------------
# Helper — build an ExtractionService with a mocked CSVService
# ---------------------------------------------------------------------------

def _make_service(tmp_path: Path) -> ExtractionService:
    svc = ExtractionService.__new__(ExtractionService)
    svc.processed_dir = tmp_path
    svc.csv_service = MagicMock()
    svc.csv_service.get_expected_filename.side_effect = lambda eq: eq.csv_filename or f"{eq.equipment_type.value}.csv"
    return svc


def _eq(eq_type: EquipmentType, csv_file: str = "test.csv") -> Equipment:
    return Equipment(
        id=f"eq_{eq_type.value.lower()}_test",
        equipment_type=eq_type,
        category=EquipmentCategory.SHARED,
        name=f"{eq_type.value} Test",
        csv_filename=csv_file,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestColumnMapping(unittest.TestCase):
    """Stage 5.3 — Map available columns."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_exact_match_all_raqs_columns(self):
        """All standard RAQS columns should map to themselves."""
        cols = ["Timestamp", "Temperature", "Humidity", "CO2"]
        expected = ["Timestamp", "Temperature", "Humidity", "CO2"]
        mappings = self.svc._map_columns(cols, expected)
        for m in mappings:
            self.assertEqual(m.source_column, m.canonical_column)

    def test_alias_mapping_co2_variant(self):
        """'co2_ppm' alias should map to 'CO2'."""
        mappings = self.svc._map_columns(
            ["Timestamp", "Temperature", "Humidity", "co2_ppm"],
            ["Timestamp", "Temperature", "Humidity", "CO2"],
        )
        co2_m = next(m for m in mappings if m.source_column == "co2_ppm")
        self.assertEqual(co2_m.canonical_column, "CO2")
        self.assertTrue(co2_m.is_expected)

    def test_alias_mapping_fan_rpm(self):
        """'fan_rpm' alias should map to 'Fan_Speed'."""
        mappings = self.svc._map_columns(
            ["Timestamp", "fan_rpm"],
            ["Timestamp", "Fan_Speed"],
        )
        m = next(x for x in mappings if x.source_column == "fan_rpm")
        self.assertEqual(m.canonical_column, "Fan_Speed")

    def test_unrecognised_column_flagged(self):
        """A column not in expected or alias table should be marked unrecognised."""
        mappings = self.svc._map_columns(
            ["Timestamp", "Temperature", "WeirdSensor"],
            ["Timestamp", "Temperature", "Humidity", "CO2"],
        )
        weird = next(m for m in mappings if m.source_column == "WeirdSensor")
        self.assertTrue(weird.is_unrecognised)

    def test_timestamp_column_flagged(self):
        """The 'Timestamp' column should have is_timestamp=True."""
        mappings = self.svc._map_columns(["Timestamp", "Temperature"], ["Timestamp", "Temperature"])
        ts_m = next(m for m in mappings if m.source_column == "Timestamp")
        self.assertTrue(ts_m.is_timestamp)

    def test_expected_columns_found_vs_missing(self):
        """When a column is missing from CSV it appears in expected_columns_missing."""
        # Provide RAQS CSV without CO2
        df = pd.DataFrame({"Timestamp": ["2024-11-01"], "Temperature": [22.5], "Humidity": [50.0]})
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df

        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertIn("CO2", reading.expected_columns_missing)
        self.assertNotIn("CO2", reading.expected_columns_found)


class TestTimestampDetection(unittest.TestCase):
    """Stage 5.2 — Identify timestamps."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_standard_timestamp_column_detected(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00"],
            "Temperature": [22.3],
            "Humidity": [49.6],
            "CO2": [520],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertTrue(reading.has_timestamp)
        self.assertEqual(reading.timestamp_column, "Timestamp")

    def test_latest_timestamp_is_last_row(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00", "2024-11-01 23:00:00"],
            "Temperature": [22.0, 23.0],
            "Humidity": [48.0, 50.0],
            "CO2": [500, 600],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        # Latest timestamp should correspond to 2024-11-01 23:00:00
        self.assertIsNotNone(reading.latest_timestamp)
        self.assertIn("2024-11-01", reading.latest_timestamp)
        self.assertIn("23", reading.latest_timestamp)

    def test_no_timestamp_column(self):
        df = pd.DataFrame({"Temperature": [22.0], "Humidity": [50.0], "CO2": [500]})
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertFalse(reading.has_timestamp)
        self.assertIsNone(reading.latest_timestamp)


class TestLatestReadings(unittest.TestCase):
    """Stage 5 spec: 'if there are multiple rows, refer to the last one'."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_latest_readings_uses_last_row(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00", "2024-11-01 23:00:00"],
            "Temperature": [22.0, 99.0],
            "Humidity": [48.0, 55.0],
            "CO2": [500, 777],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertAlmostEqual(reading.latest_readings["Temperature"], 99.0)
        self.assertAlmostEqual(reading.latest_readings["CO2"], 777.0)

    def test_null_in_last_row_stored_as_none(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00", "2024-11-01 01:00:00"],
            "Temperature": [22.0, None],
            "Humidity": [48.0, 50.0],
            "CO2": [500, 510],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertIsNone(reading.latest_readings.get("Temperature"))


class TestValidationFlags(unittest.TestCase):
    """Stage 5.5 and 5.6 — Validate extracted readings, identify missing or inconsistent info."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def _run(self, df, eq_type=EquipmentType.RAQS):
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(eq_type, "test.csv")
        return self.svc.extract_equipment(eq)

    def test_null_flag_raised(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00"],
            "Temperature": [None],
            "Humidity": [50.0],
            "CO2": [500],
        })
        reading = self._run(df)
        null_flags = [f for f in reading.validation_flags if f.flag_type == "NULL"]
        self.assertTrue(len(null_flags) >= 1)
        self.assertEqual(null_flags[0].column, "Temperature")

    def test_out_of_range_flag_raised(self):
        """Humidity > 100 should trigger OUT_OF_RANGE."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00"],
            "Temperature": [22.0],
            "Humidity": [150.0],  # Out of [0, 100]
            "CO2": [500],
        })
        reading = self._run(df)
        oor_flags = [f for f in reading.validation_flags if f.flag_type == "OUT_OF_RANGE"]
        self.assertTrue(any(f.column == "Humidity" for f in oor_flags))

    def test_non_numeric_flag_raised(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00"],
            "Temperature": ["hot"],  # Non-numeric
            "Humidity": [50.0],
            "CO2": [500],
        })
        reading = self._run(df)
        nn_flags = [f for f in reading.validation_flags if f.flag_type == "NON_NUMERIC"]
        self.assertTrue(len(nn_flags) >= 1)

    def test_invalid_timestamp_flag(self):
        df = pd.DataFrame({
            "Timestamp": ["NOT_A_DATE"],
            "Temperature": [22.0],
            "Humidity": [50.0],
            "CO2": [500],
        })
        reading = self._run(df)
        ts_flags = [f for f in reading.validation_flags if f.flag_type == "INVALID_TIMESTAMP"]
        self.assertTrue(len(ts_flags) >= 1)

    def test_valid_data_no_flags(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00"],
            "Temperature": [22.3],
            "Humidity": [49.6],
            "CO2": [520],
        })
        reading = self._run(df)
        self.assertEqual(len(reading.validation_flags), 0)

    def test_co2_out_of_range(self):
        """CO2 above 5000 should trigger OUT_OF_RANGE."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00"],
            "Temperature": [22.0],
            "Humidity": [50.0],
            "CO2": [9999],
        })
        reading = self._run(df)
        oor_flags = [f for f in reading.validation_flags if f.flag_type == "OUT_OF_RANGE" and f.column == "CO2"]
        self.assertTrue(len(oor_flags) >= 1)


class TestQualityAssessment(unittest.TestCase):
    """Stage 5.5 — Quality outcomes."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def _run(self, df=None, file_exists=True, read_error=False, eq_type=EquipmentType.RAQS):
        if read_error:
            self.svc.csv_service.file_exists.return_value = True
            self.svc.csv_service.read_csv.side_effect = CSVReadErrorStub("bad csv")
        else:
            self.svc.csv_service.file_exists.return_value = file_exists
            self.svc.csv_service.read_csv.return_value = df
        eq = _eq(eq_type, "test.csv")
        return self.svc.extract_equipment(eq)

    def test_good_quality_all_columns_no_flags(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00"],
            "Temperature": [22.3],
            "Humidity": [49.6],
            "CO2": [520],
        })
        reading = self._run(df=df)
        self.assertEqual(reading.quality, "GOOD")

    def test_empty_quality_header_only(self):
        df = pd.DataFrame(columns=["Timestamp", "Temperature", "Humidity", "CO2"])
        reading = self._run(df=df)
        self.assertEqual(reading.quality, "EMPTY")

    def test_partial_quality_missing_expected_column(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00"],
            "Temperature": [22.3],
            # Humidity and CO2 missing
        })
        reading = self._run(df=df)
        self.assertEqual(reading.quality, "PARTIAL")

    def test_invalid_quality_file_missing(self):
        reading = self._run(file_exists=False)
        self.assertEqual(reading.quality, "INVALID")

    def test_invalid_quality_read_error(self):
        reading = self._run(read_error=True)
        self.assertEqual(reading.quality, "INVALID")


class TestTotalAndValidRows(unittest.TestCase):
    """Stage 5 — total_rows and valid_rows counts."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_total_rows_counted_correctly(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00"] * 5,
            "Temperature": [22.0] * 5,
            "Humidity": [50.0] * 5,
            "CO2": [500] * 5,
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertEqual(reading.total_rows, 5)

    def test_valid_rows_excludes_nulls(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00", "2024-11-01 01:00:00"],
            "Temperature": [22.0, None],  # Row 1 has a null
            "Humidity": [50.0, 55.0],
            "CO2": [500, 510],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertEqual(reading.total_rows, 2)
        self.assertEqual(reading.valid_rows, 1)


class TestSourceReferencePreserved(unittest.TestCase):
    """Stage 5.7 — Preserve source references."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_source_csv_preserved_in_reading(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00"],
            "Temperature": [22.3],
            "Humidity": [49.6],
            "CO2": [520],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "RAQS101.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertEqual(reading.source_csv, "RAQS101.csv")
        self.assertEqual(reading.equipment_id, eq.id)

    def test_validation_flag_carries_row_index(self):
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00", "2024-11-01 01:00:00"],
            "Temperature": [22.0, None],
            "Humidity": [50.0, 55.0],
            "CO2": [500, 510],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)
        null_flags = [f for f in reading.validation_flags if f.flag_type == "NULL"]
        self.assertTrue(len(null_flags) >= 1)
        # row_index must be an integer
        self.assertIsInstance(null_flags[0].row_index, int)


class TestFullExtractionPipeline(unittest.TestCase):
    """Stage 5.8 — Produce structured processed information."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_full_run_mixed_equipment(self):
        """
        Run extraction across a list of 3 equipment items:
        - 1 with data (GOOD)
        - 1 header-only (EMPTY)
        - 1 missing file (INVALID)
        """
        eq_good = _eq(EquipmentType.RAQS, "RAQS101.csv")
        eq_empty = _eq(EquipmentType.VAV, "VAV101.csv")
        eq_missing = _eq(EquipmentType.AHU, "AHU_MISSING.csv")

        eq_good.id = "eq_raqs_good"
        eq_empty.id = "eq_vav_empty"
        eq_missing.id = "eq_ahu_missing"

        df_good = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00"],
            "Temperature": [22.3],
            "Humidity": [49.6],
            "CO2": [520],
        })
        df_empty = pd.DataFrame(columns=["Timestamp", "Airflow", "Temperature", "Pressure"])

        def file_exists_side_effect(filename):
            return filename != "AHU_MISSING.csv"

        def read_csv_side_effect(filename):
            if filename == "RAQS101.csv":
                return df_good
            elif filename == "VAV101.csv":
                return df_empty
            raise FileNotFoundError(filename)

        self.svc.csv_service.file_exists.side_effect = file_exists_side_effect
        self.svc.csv_service.read_csv.side_effect = read_csv_side_effect

        report = self.svc.run_full_extraction([eq_good, eq_empty, eq_missing])

        self.assertEqual(report.total_equipment, 3)
        self.assertEqual(report.equipment_results["eq_raqs_good"].quality, "GOOD")
        self.assertEqual(report.equipment_results["eq_vav_empty"].quality, "EMPTY")
        self.assertEqual(report.equipment_results["eq_ahu_missing"].quality, "INVALID")

    def test_persistence_creates_processed_csv(self):
        """After extraction with data, a processed CSV should exist on disk."""
        eq = _eq(EquipmentType.RAQS, "RAQS101.csv")
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00"],
            "Temperature": [22.3],
            "Humidity": [49.6],
            "CO2": [520],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df

        self.svc.run_full_extraction([eq])

        processed_file = self.tmp / f"{eq.id}.csv"
        self.assertTrue(processed_file.exists(), "Processed CSV should be created after extraction.")

    def test_persistence_appends_on_second_run(self):
        """Running extraction twice should append a second row, not overwrite."""
        eq = _eq(EquipmentType.RAQS, "RAQS101.csv")
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00"],
            "Temperature": [22.3],
            "Humidity": [49.6],
            "CO2": [520],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df

        self.svc.run_full_extraction([eq])
        self.svc.run_full_extraction([eq])

        processed_file = self.tmp / f"{eq.id}.csv"
        result = pd.read_csv(processed_file)
        self.assertEqual(len(result), 2)


class TestAHUExtraction(unittest.TestCase):
    """AHU-specific extraction with real column names from AHU_01.csv structure."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_ahu_all_columns_good(self):
        df = pd.DataFrame({
            "Timestamp":                   ["2024-11-01 08:00:00"],
            "Fan_Speed":                   [1250],
            "Airflow":                     [2320.0],
            "Flow_Rate":                   [49.0],
            "T1":                          [7.4],
            "T2":                          [14.7],
            "Tonnage":                     [89.42],
            "Return_Air_Temp":             [25.5],
            "Supply_Air_Temp":             [14.5],
            "Filter_Status":               [0],
            "Heat_Recovery_Wheel_Status":  [1],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.AHU, "AHU_01.csv")
        reading = self.svc.extract_equipment(eq)
        self.assertEqual(reading.quality, "GOOD")
        self.assertEqual(reading.total_rows, 1)
        self.assertAlmostEqual(reading.latest_readings["Fan_Speed"], 1250.0)
        self.assertAlmostEqual(reading.latest_readings["T1"], 7.4)


class TestChillerExtraction(unittest.TestCase):
    """Chiller-specific extraction."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_chiller_operating_status_range(self):
        """Operating_Status should only be 0 or 1; value 2 should be flagged."""
        df = pd.DataFrame({
            "Timestamp":           ["2024-11-01 10:00:00"],
            "Operating_Status":    [2],  # Out of [0, 1]
            "Compressor_Speed":    [80.0],
            "CHW_Supply_Temp":     [7.0],
            "CHW_Supply_Pressure": [2.9],
            "CHW_Supply_Flow":     [370.0],
            "CHW_Return_Temp":     [14.0],
            "CHW_Return_Pressure": [2.3],
            "CHW_Return_Flow":     [370.0],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.CHILLER, "C01.csv")
        reading = self.svc.extract_equipment(eq)
        oor = [f for f in reading.validation_flags if f.flag_type == "OUT_OF_RANGE" and f.column == "Operating_Status"]
        self.assertTrue(len(oor) >= 1)


class TestAliasTable(unittest.TestCase):
    """Verify the alias table covers known Belimo CSV column variants."""

    def test_temperature_aliases(self):
        self.assertIn("temp", COLUMN_ALIASES)
        self.assertEqual(COLUMN_ALIASES["temp"], "Temperature")

    def test_humidity_rh_alias(self):
        self.assertIn("rh", COLUMN_ALIASES)
        self.assertEqual(COLUMN_ALIASES["rh"], "Humidity")

    def test_flow_rate_alias(self):
        self.assertIn("flowrate", COLUMN_ALIASES)
        self.assertEqual(COLUMN_ALIASES["flowrate"], "Flow_Rate")

    def test_timestamp_alias(self):
        self.assertIn("datetime", COLUMN_ALIASES)
        self.assertEqual(COLUMN_ALIASES["datetime"], "Timestamp")


class TestLoopholeProtections(unittest.TestCase):
    """Specific tests addressing missing columns, empty columns, Excel blank lines, and physical inconsistencies."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.svc = _make_service(self.tmp)

    def test_missing_column_explicitly_flagged(self):
        """When a required parameter is missing from CSV, a MISSING_COLUMN flag must be generated."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00"],
            "Temperature": [22.5],
            # Humidity and CO2 missing from RAQS
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)

        missing_flags = [f for f in reading.validation_flags if f.flag_type == "MISSING_COLUMN"]
        flagged_cols = {f.column for f in missing_flags}
        self.assertIn("Humidity", flagged_cols)
        self.assertIn("CO2", flagged_cols)

    def test_missing_timestamp_column_flagged(self):
        """When Timestamp column is missing from CSV, a MISSING_TIMESTAMP_COLUMN flag must be generated."""
        df = pd.DataFrame({
            "Temperature": [22.5],
            "Humidity": [50.0],
            "CO2": [520],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)

        ts_flags = [f for f in reading.validation_flags if f.flag_type == "MISSING_TIMESTAMP_COLUMN"]
        self.assertEqual(len(ts_flags), 1)

    def test_empty_column_all_nan_flagged(self):
        """When an expected column is present in the header but contains all NaN across all rows, flag it."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 00:00:00", "2024-11-01 01:00:00"],
            "Temperature": [22.5, 23.0],
            "Humidity": [None, None],  # present in header, but 0 valid data
            "CO2": [520, 530],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)

        empty_flags = [f for f in reading.validation_flags if f.flag_type == "EMPTY_COLUMN" and f.column == "Humidity"]
        self.assertEqual(len(empty_flags), 1)

    def test_excel_trailing_blank_rows_dropped_for_latest_readings(self):
        """Excel blank lines at end of CSV must not overwrite valid readings in latest_readings."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 12:00:00", None],
            "Temperature": [22.5, None],
            "Humidity": [50.0, None],
            "CO2": [600, None],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)

        self.assertEqual(reading.latest_readings["Temperature"], 22.5)
        self.assertEqual(reading.latest_readings["CO2"], 600)

    def test_inconsistent_temperatures_chiller(self):
        """Chiller return water cannot be colder than supply water in cooling mode."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 10:00:00"],
            "Operating_Status": [1],
            "Compressor_Speed": [80.0],
            "CHW_Supply_Temp": [10.0],
            "CHW_Supply_Pressure": [2.5],
            "CHW_Supply_Flow": [300.0],
            "CHW_Return_Temp": [6.0],  # Return is colder than supply!
            "CHW_Return_Pressure": [2.0],
            "CHW_Return_Flow": [300.0],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.CHILLER, "C01.csv")
        reading = self.svc.extract_equipment(eq)

        incon_flags = [f for f in reading.validation_flags if f.flag_type == "INCONSISTENT_READINGS"]
        self.assertTrue(len(incon_flags) >= 1)

    def test_inconsistent_temperatures_ev(self):
        """EV return temperature T2 cannot be lower than T1 in cooling valve."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 10:00:00"],
            "Actuator_Position": [50.0],
            "Flow_Rate": [15.0],
            "T1": [12.0],
            "T2": [7.0],  # T2 < T1
            "Tonnage": [20.0],
            "Control_Signal": [5.0],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.EV, "EV01.csv")
        reading = self.svc.extract_equipment(eq)

        incon_flags = [f for f in reading.validation_flags if f.flag_type == "INCONSISTENT_READINGS" and f.column == "T2"]
        self.assertTrue(len(incon_flags) >= 1)

    def test_duplicate_timestamps_flagged(self):
        """Duplicate timestamps in the CSV should be detected and flagged."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00", "2024-11-01 08:00:00"],
            "Temperature": [22.0, 22.5],
            "Humidity": [50.0, 51.0],
            "CO2": [500, 510],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)

        dup_flags = [f for f in reading.validation_flags if f.flag_type == "DUPLICATE_TIMESTAMP"]
        self.assertTrue(len(dup_flags) >= 1)

    def test_units_in_values_cleaned_gracefully(self):
        """Numbers with units attached (e.g. '22.3 °C', '520 ppm', '1,250') should be cleaned, not flagged as non-numeric."""
        df = pd.DataFrame({
            "Timestamp": ["2024-11-01 08:00:00"],
            "Temperature": ["22.3 °C"],
            "Humidity": ["49.6%"],
            "CO2": ["520 ppm"],
        })
        self.svc.csv_service.file_exists.return_value = True
        self.svc.csv_service.read_csv.return_value = df
        eq = _eq(EquipmentType.RAQS, "test.csv")
        reading = self.svc.extract_equipment(eq)

        nn_flags = [f for f in reading.validation_flags if f.flag_type == "NON_NUMERIC"]
        self.assertEqual(len(nn_flags), 0, "Values with units should be cleaned, not flagged as non-numeric")
        self.assertAlmostEqual(reading.latest_readings["Temperature"], 22.3)
        self.assertAlmostEqual(reading.latest_readings["Humidity"], 49.6)
        self.assertAlmostEqual(reading.latest_readings["CO2"], 520.0)


if __name__ == "__main__":
    unittest.main()
