"""
Stage 4 — CSV Folder Integration: Automated Test Suite
=======================================================

Covers:
  - Unit tests for CSVService using a temporary directory (no production data touched)
  - API endpoint tests using FastAPI TestClient against real data/csv/ files

Run from the project root::

    python -m pytest tests/test_stage4_csv_integration.py -v
"""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.csv_processing.csv_service import (
    CSVReadError,
    CSVService,
    InvalidFileReport,
    MissingFileReport,
    ScanResult,
)
from backend.app.main import app
from backend.app.models.entity import Equipment, EquipmentCategory, EquipmentType

# ---------------------------------------------------------------------------
# TestClient (shared across API tests)
# ---------------------------------------------------------------------------

client = TestClient(app)


# ===========================================================================
# Unit Tests — CSVService with a temporary directory
# ===========================================================================


class TestCSVServiceUnit(unittest.TestCase):
    """Unit tests for CSVService methods using a temporary directory.

    All file operations target a freshly created ``tmpdir``; the production
    ``data/csv/`` folder is never read or written.
    """

    # ------------------------------------------------------------------
    # Fixtures
    # ------------------------------------------------------------------

    def setUp(self) -> None:
        """Create a temp directory, a valid CSV, and a binary-garbage file."""
        self.tmpdir = Path(tempfile.mkdtemp())
        self.svc = CSVService(csv_dir=self.tmpdir)

        # --- valid.csv: proper two-column CSV with 3 data rows ---
        self.valid_csv = self.tmpdir / "valid.csv"
        self.valid_csv.write_text(
            "Timestamp,Value\n"
            "2024-11-01 00:00:00,10.5\n"
            "2024-11-01 01:00:00,11.2\n"
            "2024-11-01 02:00:00,12.0\n",
            encoding="utf-8",
        )

        # --- invalid.csv: binary garbage that pandas cannot parse ---
        self.invalid_csv = self.tmpdir / "invalid.csv"
        self.invalid_csv.write_bytes(b"\xff\xfe" * 50)

    def tearDown(self) -> None:
        """Remove the entire temporary directory tree."""
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    # ------------------------------------------------------------------
    # file_exists
    # ------------------------------------------------------------------

    def test_file_exists_true(self) -> None:
        """file_exists returns True for a file that is actually in csv_dir."""
        self.assertTrue(self.svc.file_exists("valid.csv"))

    def test_file_exists_false(self) -> None:
        """file_exists returns False when the file is absent."""
        self.assertFalse(self.svc.file_exists("nonexistent.csv"))

    # ------------------------------------------------------------------
    # scan_directory
    # ------------------------------------------------------------------

    def test_scan_directory_returns_sorted_csvs(self) -> None:
        """scan_directory lists all .csv files in alphabetical order."""
        # Create 3 extra CSV files with names that would sort non-trivially
        (self.tmpdir / "zebra.csv").write_text("a,b\n1,2\n", encoding="utf-8")
        (self.tmpdir / "alpha.csv").write_text("a,b\n1,2\n", encoding="utf-8")
        (self.tmpdir / "middle.csv").write_text("a,b\n1,2\n", encoding="utf-8")

        result = self.svc.scan_directory()

        # Every result must be a .csv file
        for name in result:
            self.assertTrue(name.endswith(".csv"), f"{name!r} is not a .csv")

        # Result must be sorted
        self.assertEqual(result, sorted(result))

        # Our 3 extra files must be present
        for expected in ("alpha.csv", "middle.csv", "zebra.csv"):
            self.assertIn(expected, result)

    def test_scan_directory_ignores_non_csv(self) -> None:
        """scan_directory must not include non-.csv files."""
        readme = self.tmpdir / "README.txt"
        readme.write_text("This is a text file.\n", encoding="utf-8")

        result = self.svc.scan_directory()

        self.assertNotIn("README.txt", result)

    # ------------------------------------------------------------------
    # read_csv
    # ------------------------------------------------------------------

    def test_read_csv_valid(self) -> None:
        """read_csv returns a DataFrame with the correct shape for a valid file."""
        import pandas as pd

        df = self.svc.read_csv("valid.csv")
        self.assertIsInstance(df, pd.DataFrame)
        self.assertEqual(df.shape, (3, 2))  # 3 rows, 2 columns

    def test_read_csv_missing_raises_file_not_found(self) -> None:
        """read_csv raises FileNotFoundError for a file that does not exist."""
        with self.assertRaises(FileNotFoundError):
            self.svc.read_csv("does_not_exist.csv")

    def test_read_csv_invalid_raises_csv_read_error(self) -> None:
        """read_csv raises CSVReadError for a file with unparseable binary content."""
        with self.assertRaises(CSVReadError):
            self.svc.read_csv("invalid.csv")

    # ------------------------------------------------------------------
    # inspect_headers / inspect_data
    # ------------------------------------------------------------------

    def test_inspect_headers(self) -> None:
        """inspect_headers returns the correct column names for a valid CSV."""
        headers = self.svc.inspect_headers("valid.csv")
        self.assertEqual(headers, ["Timestamp", "Value"])

    def test_inspect_data(self) -> None:
        """inspect_data returns a dict with 'headers', 'row_count', 'preview' keys."""
        result = self.svc.inspect_data("valid.csv")

        self.assertIn("headers", result)
        self.assertIn("row_count", result)
        self.assertIn("preview", result)

        self.assertEqual(result["headers"], ["Timestamp", "Value"])
        self.assertEqual(result["row_count"], 3)
        # preview defaults to max_rows=5; we have only 3 rows
        self.assertEqual(len(result["preview"]), 3)
        # first preview row should contain our keys
        first_row = result["preview"][0]
        self.assertIn("Timestamp", first_row)
        self.assertIn("Value", first_row)

    # ------------------------------------------------------------------
    # report_missing_files
    # ------------------------------------------------------------------

    def test_report_missing_files(self) -> None:
        """report_missing_files returns a MissingFileReport for absent equipment CSV."""
        # Construct an Equipment instance whose csv_filename is NOT in tmpdir
        ghost_eq = Equipment(
            id="eq_raqs_999",
            equipment_type=EquipmentType.RAQS,
            category=EquipmentCategory.ROOM_LEVEL,
            name="Ghost RAQS",
            csv_filename="RAQS_999.csv",  # Does not exist in tmpdir
            room_id="rm_999",
        )
        reports = self.svc.report_missing_files([ghost_eq])
        self.assertEqual(len(reports), 1)
        report = reports[0]
        self.assertIsInstance(report, MissingFileReport)
        self.assertEqual(report.equipment_id, "eq_raqs_999")
        self.assertEqual(report.expected_filename, "RAQS_999.csv")

    # ------------------------------------------------------------------
    # Security — path traversal
    # ------------------------------------------------------------------

    def test_filename_path_traversal_blocked(self) -> None:
        """file_exists raises ValueError for a filename containing '..'."""
        with self.assertRaises(ValueError):
            self.svc.file_exists("../secret.csv")

    def test_filename_with_slash_blocked(self) -> None:
        """file_exists raises ValueError for a filename containing '/'."""
        with self.assertRaises(ValueError):
            self.svc.file_exists("subdir/secret.csv")

    def test_filename_with_backslash_blocked(self) -> None:
        """file_exists raises ValueError for a filename containing '\\'."""
        with self.assertRaises(ValueError):
            self.svc.file_exists("subdir\\secret.csv")

    # ------------------------------------------------------------------
    # get_expected_filename
    # ------------------------------------------------------------------

    def test_get_expected_filename_from_csv_filename(self) -> None:
        """When csv_filename is set, get_expected_filename returns it unchanged."""
        eq = Equipment(
            id="eq_raqs_101",
            equipment_type=EquipmentType.RAQS,
            category=EquipmentCategory.ROOM_LEVEL,
            name="Test RAQS",
            csv_filename="RAQS_101.csv",
            room_id="rm_101",
        )
        self.assertEqual(self.svc.get_expected_filename(eq), "RAQS_101.csv")

    def test_get_expected_filename_derived(self) -> None:
        """When csv_filename is empty, the name is derived from the equipment id."""
        eq = Equipment(
            id="eq_raqs_101",
            equipment_type=EquipmentType.RAQS,
            category=EquipmentCategory.ROOM_LEVEL,
            name="Test RAQS",
            csv_filename="",  # deliberately empty
            room_id="rm_101",
        )
        # Expected derivation: RAQS + _ + 101 = RAQS_101.csv
        self.assertEqual(self.svc.get_expected_filename(eq), "RAQS_101.csv")

    def test_get_expected_filename_derived_vav(self) -> None:
        """Derivation works correctly for a VAV equipment id."""
        eq = Equipment(
            id="eq_vav_102",
            equipment_type=EquipmentType.VAV,
            category=EquipmentCategory.ROOM_LEVEL,
            name="Test VAV",
            csv_filename="",
            room_id="rm_102",
        )
        self.assertEqual(self.svc.get_expected_filename(eq), "VAV_102.csv")

    # ------------------------------------------------------------------
    # report_missing_files — present file is not reported missing
    # ------------------------------------------------------------------

    def test_report_missing_files_present_not_reported(self) -> None:
        """Equipment whose CSV is present in csv_dir is NOT in the missing report."""
        # valid.csv exists in tmpdir; create Equipment pointing at it
        present_eq = Equipment(
            id="eq_raqs_valid",
            equipment_type=EquipmentType.RAQS,
            category=EquipmentCategory.ROOM_LEVEL,
            name="Present RAQS",
            csv_filename="valid.csv",
            room_id="rm_001",
        )
        reports = self.svc.report_missing_files([present_eq])
        self.assertEqual(reports, [])

    # ------------------------------------------------------------------
    # get_equipment_csv_data
    # ------------------------------------------------------------------

    def test_get_equipment_csv_data_returns_data(self) -> None:
        """get_equipment_csv_data returns inspect_data dict when file is present."""
        eq = Equipment(
            id="eq_raqs_valid",
            equipment_type=EquipmentType.RAQS,
            category=EquipmentCategory.ROOM_LEVEL,
            name="Present RAQS",
            csv_filename="valid.csv",
            room_id="rm_001",
        )
        data = self.svc.get_equipment_csv_data(eq)
        self.assertIsNotNone(data)
        self.assertIn("headers", data)
        self.assertIn("row_count", data)
        self.assertIn("preview", data)

    def test_get_equipment_csv_data_missing_file_returns_none(self) -> None:
        """get_equipment_csv_data returns None when the csv_filename is absent."""
        eq = Equipment(
            id="eq_raqs_ghost",
            equipment_type=EquipmentType.RAQS,
            category=EquipmentCategory.ROOM_LEVEL,
            name="Ghost RAQS",
            csv_filename="RAQS_GHOST.csv",
            room_id="rm_ghost",
        )
        result = self.svc.get_equipment_csv_data(eq)
        self.assertIsNone(result)

    def test_get_equipment_csv_data_no_filename_returns_none(self) -> None:
        """get_equipment_csv_data returns None when csv_filename is empty."""
        eq = Equipment(
            id="eq_raqs_nofn",
            equipment_type=EquipmentType.RAQS,
            category=EquipmentCategory.ROOM_LEVEL,
            name="No Filename RAQS",
            csv_filename="",
            room_id="rm_nofn",
        )
        result = self.svc.get_equipment_csv_data(eq)
        self.assertIsNone(result)

    # ------------------------------------------------------------------
    # inspect_data — max_rows clipping
    # ------------------------------------------------------------------

    def test_inspect_data_max_rows_clipped(self) -> None:
        """inspect_data respects max_rows and returns at most that many preview rows."""
        result = self.svc.inspect_data("valid.csv", max_rows=1)
        self.assertEqual(len(result["preview"]), 1)

    # ------------------------------------------------------------------
    # report_invalid_files
    # ------------------------------------------------------------------

    def test_report_invalid_files_detects_binary_garbage(self) -> None:
        """report_invalid_files includes a report for the binary-garbage file."""
        reports = self.svc.report_invalid_files()
        filenames = [r.filename for r in reports]
        self.assertIn("invalid.csv", filenames)
        # valid.csv must NOT be in the report
        self.assertNotIn("valid.csv", filenames)


# ===========================================================================
# API Endpoint Tests — real data/csv/ folder
# ===========================================================================


class TestCSVAPIEndpoints(unittest.TestCase):
    """Integration tests for CSV API endpoints using FastAPI TestClient.

    These tests rely on the real ``data/csv/`` directory being populated
    with the 9 seeded equipment CSV files.
    """

    # ------------------------------------------------------------------
    # GET /api/csv/status
    # ------------------------------------------------------------------

    def test_get_csv_status(self) -> None:
        """GET /api/csv/status returns 200 with all required response keys."""
        response = client.get("/api/csv/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        required_keys = {
            "csv_dir",
            "total_files_found",
            "found_files",
            "missing_count",
            "missing_files",
            "invalid_count",
            "invalid_files",
            "scanned_at",
        }
        for key in required_keys:
            self.assertIn(key, body, f"Missing key in /api/csv/status response: {key!r}")

    # ------------------------------------------------------------------
    # GET /api/csv/files
    # ------------------------------------------------------------------

    def test_get_csv_files(self) -> None:
        """GET /api/csv/files returns 200 with 'files' list and 'count' integer."""
        response = client.get("/api/csv/files")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("files", body)
        self.assertIn("count", body)
        self.assertIsInstance(body["files"], list)
        self.assertIsInstance(body["count"], int)
        self.assertEqual(body["count"], len(body["files"]))

    # ------------------------------------------------------------------
    # GET /api/csv/files/{filename}
    # ------------------------------------------------------------------

    def test_get_csv_file_inspect_valid(self) -> None:
        """GET /api/csv/files/RAQS_101.csv returns 200 with headers/row_count/preview."""
        response = client.get("/api/csv/files/RAQS_101.csv")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("headers", body)
        self.assertIn("row_count", body)
        self.assertIn("preview", body)

    def test_get_csv_file_inspect_all_seeded(self) -> None:
        """Every seeded CSV file returns 200 when queried by name."""
        seeded = [
            "RAQS_101.csv",
            "RAQS_102.csv",
            "RAQS_103.csv",
            "VAV_101.csv",
            "VAV_102.csv",
            "VAV_103.csv",
            "Chiller_01.csv",
            "EV_01.csv",
            "AHU_01.csv",
        ]
        for name in seeded:
            with self.subTest(filename=name):
                response = client.get(f"/api/csv/files/{name}")
                self.assertEqual(
                    response.status_code,
                    200,
                    f"Expected 200 for {name!r}, got {response.status_code}",
                )

    # ------------------------------------------------------------------
    # GET /api/csv/files/{filename}/headers
    # ------------------------------------------------------------------

    def test_get_csv_file_headers_only(self) -> None:
        """GET /api/csv/files/RAQS_101.csv/headers returns 200 with Timestamp header."""
        response = client.get("/api/csv/files/RAQS_101.csv/headers")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("headers", body)
        self.assertIsInstance(body["headers"], list)
        self.assertIn("Timestamp", body["headers"])

    # ------------------------------------------------------------------
    # 404 — file not found
    # ------------------------------------------------------------------

    def test_get_csv_file_not_found(self) -> None:
        """GET /api/csv/files/NONEXISTENT_999.csv returns 404."""
        response = client.get("/api/csv/files/NONEXISTENT_999.csv")
        self.assertEqual(response.status_code, 404)

    def test_get_csv_file_headers_not_found(self) -> None:
        """GET /api/csv/files/NONEXISTENT_999.csv/headers returns 404."""
        response = client.get("/api/csv/files/NONEXISTENT_999.csv/headers")
        self.assertEqual(response.status_code, 404)

    # ------------------------------------------------------------------
    # 422 — path traversal blocked
    # ------------------------------------------------------------------

    def test_get_csv_file_path_traversal_blocked(self) -> None:
        """GET with a URL-encoded path traversal returns 422."""
        # ..%2F..%2Fsecret.csv decodes to ../../secret.csv
        response = client.get("/api/csv/files/..%2F..%2Fsecret.csv")
        self.assertEqual(response.status_code, 422)

    def test_get_csv_file_headers_path_traversal_blocked(self) -> None:
        """GET headers with a URL-encoded path traversal returns 422."""
        response = client.get("/api/csv/files/..%2Fsecret.csv/headers")
        self.assertEqual(response.status_code, 422)

    # ------------------------------------------------------------------
    # GET /api/csv/equipment/{equipment_id}/csv
    # ------------------------------------------------------------------

    def test_get_equipment_csv_data(self) -> None:
        """GET /api/csv/equipment/{id}/csv returns 200 with equipment data."""
        from backend.app.services.configuration_service import ConfigurationService
        config_svc = ConfigurationService()
        eq_list = config_svc.get_equipment()
        self.assertTrue(len(eq_list) > 0, "Expected at least one equipment configured")
        target = next((e for e in eq_list if e.id == "eq_raqs_101"), eq_list[0])
        response = client.get(f"/api/csv/equipment/{target.id}/csv")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("equipment_id", body)
        self.assertIn("csv_filename", body)
        self.assertIn("data", body)
        self.assertEqual(body["equipment_id"], target.id)

    def test_get_equipment_csv_data_not_found(self) -> None:
        """GET /api/csv/equipment/eq_nonexistent/csv returns 404."""
        response = client.get("/api/csv/equipment/eq_nonexistent/csv")
        self.assertEqual(response.status_code, 404)

    # ------------------------------------------------------------------
    # POST /api/csv/rescan
    # ------------------------------------------------------------------

    def test_post_rescan(self) -> None:
        """POST /api/csv/rescan returns 200 with the same structure as /status."""
        response = client.post("/api/csv/rescan")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        required_keys = {
            "csv_dir",
            "total_files_found",
            "found_files",
            "missing_count",
            "missing_files",
            "invalid_count",
            "invalid_files",
            "scanned_at",
        }
        for key in required_keys:
            self.assertIn(key, body, f"Missing key in POST /api/csv/rescan response: {key!r}")

    # ------------------------------------------------------------------
    # Counts sanity check
    # ------------------------------------------------------------------

    def test_scan_counts_match_actual_files(self) -> None:
        """total_files_found in /api/csv/status must be >= 9 (all seeded files)."""
        response = client.get("/api/csv/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertGreaterEqual(
            body["total_files_found"],
            9,
            f"Expected at least 9 CSV files, found {body['total_files_found']}",
        )

    def test_files_count_consistent_with_status(self) -> None:
        """'count' from /files must equal 'total_files_found' from /status."""
        status_resp = client.get("/api/csv/status")
        files_resp = client.get("/api/csv/files")
        self.assertEqual(status_resp.status_code, 200)
        self.assertEqual(files_resp.status_code, 200)
        status_total = status_resp.json()["total_files_found"]
        files_count = files_resp.json()["count"]
        self.assertEqual(
            status_total,
            files_count,
            f"/status reported {status_total} files but /files reported {files_count}",
        )

    def test_rescan_scanned_at_is_iso_string(self) -> None:
        """scanned_at field in /status is a non-empty ISO-8601 string."""
        response = client.get("/api/csv/status")
        self.assertEqual(response.status_code, 200)
        scanned_at = response.json().get("scanned_at", "")
        self.assertTrue(len(scanned_at) > 0, "scanned_at must not be empty")
        # Basic ISO-8601 format check: contains 'T' separator or a date portion
        self.assertTrue(
            "T" in scanned_at or "-" in scanned_at,
            f"scanned_at does not look like ISO-8601: {scanned_at!r}",
        )

    def test_found_files_list_contains_all_seeded(self) -> None:
        """Every seeded filename appears in found_files returned by /status."""
        seeded = {
            "RAQS_101.csv",
            "RAQS_102.csv",
            "RAQS_103.csv",
            "VAV_101.csv",
            "VAV_102.csv",
            "VAV_103.csv",
            "Chiller_01.csv",
            "EV_01.csv",
            "AHU_01.csv",
        }
        response = client.get("/api/csv/status")
        self.assertEqual(response.status_code, 200)
        found = set(response.json()["found_files"])
        for name in seeded:
            self.assertIn(name, found, f"{name!r} not in found_files from /status")

    def test_open_directory_endpoint(self) -> None:
        """POST /api/csv/open-directory returns 200 and reports status."""
        response = client.post("/api/csv/open-directory")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("status", body)
        self.assertIn("csv_dir", body)
        self.assertIn("opened", body)

    def test_process_does_not_create_dummies(self) -> None:
        """POST /api/csv/process scans and reports missing files WITHOUT creating dummy files."""
        from backend.app.schemas.entity_schemas import EquipmentCreate
        from backend.app.services.configuration_service import ConfigurationService
        config_svc = ConfigurationService()

        dummy_filename = "TEST_MISSING_NO_CREATE_998.csv"
        dummy_path = Path(config_svc.config_dir).parent / "csv" / dummy_filename
        if dummy_path.exists():
            dummy_path.unlink()

        rooms = config_svc.get_rooms()
        self.assertTrue(len(rooms) > 0)
        room_id = rooms[0].id

        eq = config_svc.create_equipment(EquipmentCreate(
            equipment_type=EquipmentType.VAV,
            name="Missing Scan Only VAV",
            csv_filename=dummy_filename,
            room_id=room_id
        ))

        try:
            resp = client.post("/api/csv/process")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()

            # Reported as missing
            missing_names = [m["expected_filename"] for m in data["missing_files"]]
            self.assertIn(dummy_filename, missing_names)

            # File must NOT have been created on disk by process
            self.assertFalse(dummy_path.exists(), "process must not create dummy files")

            # Equipment status is NO_FILE (red dot)
            eq_status = data["equipment_statuses"].get(eq.id)
            self.assertIsNotNone(eq_status)
            self.assertEqual(eq_status["status"], "NO_FILE")
        finally:
            config_svc.delete_equipment(eq.id)
            if dummy_path.exists():
                dummy_path.unlink()

    def test_create_dummy_files_endpoint(self) -> None:
        """POST /api/csv/create-dummy-files creates dummy CSV with headers and no data for missing files."""
        from backend.app.schemas.entity_schemas import EquipmentCreate
        from backend.app.services.configuration_service import ConfigurationService
        config_svc = ConfigurationService()

        dummy_filename = "TEST_CREATE_DUMMY_999.csv"
        dummy_path = Path(config_svc.config_dir).parent / "csv" / dummy_filename
        if dummy_path.exists():
            dummy_path.unlink()

        rooms = config_svc.get_rooms()
        self.assertTrue(len(rooms) > 0)
        room_id = rooms[0].id

        eq = config_svc.create_equipment(EquipmentCreate(
            equipment_type=EquipmentType.VAV,
            name="Missing Dummy Creator VAV",
            csv_filename=dummy_filename,
            room_id=room_id
        ))

        try:
            resp = client.post("/api/csv/create-dummy-files")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()

            # Reported and created
            self.assertIn(dummy_filename, data["created_dummy_files"])
            self.assertTrue(dummy_path.exists(), "Dummy file must be created on disk")

            # Verify 0 data rows
            import pandas as pd
            df = pd.read_csv(dummy_path)
            self.assertEqual(len(df), 0, "Dummy file must contain 0 data rows")
            self.assertIn("Airflow", df.columns)

            # Equipment status is NO_DATA (yellow dot)
            eq_status = data["equipment_statuses"].get(eq.id)
            self.assertIsNotNone(eq_status)
            self.assertEqual(eq_status["status"], "NO_DATA")
        finally:
            config_svc.delete_equipment(eq.id)
            if dummy_path.exists():
                dummy_path.unlink()


# ===========================================================================
# Entry point
# ===========================================================================

if __name__ == "__main__":
    unittest.main()
