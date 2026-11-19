"""
CSV Processing Service for BELIMO | Collia.

Provides directory management, file inspection, validation, dummy generation,
and equipment-CSV association utilities for the data/csv/ folder.
"""

from __future__ import annotations

import csv
import logging
import os
import platform
import re
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from backend.app.models.entity import Equipment, EquipmentType, EQUIPMENT_PARAMETERS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------


class CSVReadError(Exception):
    """Raised when a CSV file exists but cannot be parsed by pandas."""


# ---------------------------------------------------------------------------
# Equipment standard CSV column definitions
# ---------------------------------------------------------------------------

EQUIPMENT_CSV_COLUMNS: Dict[EquipmentType, List[str]] = {
    EquipmentType.RAQS: [
        "Timestamp",
        "Temperature",
        "Humidity",
        "CO2"
    ],
    EquipmentType.VAV: [
        "Timestamp",
        "Airflow",
        "Temperature",
        "Pressure"
    ],
    EquipmentType.EV: [
        "Timestamp",
        "Actuator_Position",
        "Flow_Rate",
        "T1",
        "T2",
        "Tonnage",
        "Control_Signal"
    ],
    EquipmentType.AHU: [
        "Timestamp",
        "Fan_Speed",
        "Airflow",
        "Flow_Rate",
        "T1",
        "T2",
        "Tonnage",
        "Return_Air_Temp",
        "Supply_Air_Temp",
        "Filter_Status",
        "Heat_Recovery_Wheel_Status"
    ],
    EquipmentType.CHILLER: [
        "Timestamp",
        "Operating_Status",
        "Compressor_Speed",
        "CHW_Supply_Temp",
        "CHW_Supply_Pressure",
        "CHW_Supply_Flow",
        "CHW_Return_Temp",
        "CHW_Return_Pressure",
        "CHW_Return_Flow"
    ]
}


# ---------------------------------------------------------------------------
# Data-transfer objects
# ---------------------------------------------------------------------------


@dataclass
class MissingFileReport:
    """Describes a piece of equipment whose expected CSV file is absent."""

    equipment_id: str
    equipment_name: str
    equipment_type: str
    expected_filename: str


@dataclass
class InvalidFileReport:
    """Describes a CSV file that is present but fails to parse."""

    filename: str
    error_message: str


@dataclass
class EquipmentStatusReport:
    """Describes the CSV data status for an individual equipment item."""

    equipment_id: str
    equipment_name: str
    equipment_type: str
    csv_filename: str
    status: str  # 'NO_FILE' (red) | 'NO_DATA' (yellow) | 'HAS_DATA' (green) | 'INVALID' (red)
    row_count: int = 0
    headers: List[str] = field(default_factory=list)
    created_dummy: bool = False


@dataclass
class ScanResult:
    """Aggregated result of a directory rescan."""

    found_files: List[str]
    missing_reports: List[MissingFileReport]
    invalid_reports: List[InvalidFileReport]
    scanned_at: str
    created_dummy_files: List[str] = field(default_factory=list)
    equipment_statuses: Dict[str, EquipmentStatusReport] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Security & filename helpers
# ---------------------------------------------------------------------------

def sanitize_csv_name(filename: str) -> str:
    """Sanitize and normalize a filename for CSV storage."""
    if not filename:
        return ""
    # Strip whitespace
    name = filename.strip()
    # Reject path traversal
    if ".." in name or "/" in name or "\\" in name:
        raise ValueError(f"Unsafe filename rejected: {filename!r}. Filenames must not contain '..', '/', or '\\'.")
    # Clean invalid Windows/POSIX filename characters
    name = re.sub(r'[\:*?"<>|]', '_', name)
    # Ensure .csv extension
    if not name.lower().endswith(".csv"):
        name = f"{name}.csv"
    return name


def _validate_filename(filename: str) -> None:
    """Raise *ValueError* if *filename* contains path-traversal characters or is invalid."""
    if not filename:
        raise ValueError("Filename cannot be empty.")
    if ".." in filename or "/" in filename or "\\" in filename:
        raise ValueError(
            f"Unsafe filename rejected: {filename!r}. "
            "Filenames must not contain '..', '/', or '\\'."
        )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class CSVService:
    """Core service for equipment CSV file management."""

    def __init__(self, csv_dir: Optional[Path] = None) -> None:
        if csv_dir is None:
            project_root = Path(__file__).resolve().parent.parent.parent.parent
            self.csv_dir: Path = project_root / "data" / "csv"
        else:
            self.csv_dir = Path(csv_dir).resolve()

        self.csv_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Native Directory Opener (Windows / Mac / Linux)
    # ------------------------------------------------------------------

    def open_csv_directory(self) -> bool:
        """Open the CSV directory in the operating system's native file explorer."""
        path = self.csv_dir.resolve()
        try:
            system_name = platform.system()
            if system_name == "Windows":
                # Launch Windows File Explorer directly with subprocess
                subprocess.Popen(["explorer", str(path)])
                return True
            elif system_name == "Darwin":
                subprocess.Popen(["open", str(path)])
                return True
            else:
                subprocess.Popen(["xdg-open", str(path)])
                return True
        except Exception as e:
            logger.warning(f"Failed to open directory via subprocess: {e}")
            try:
                if platform.system() == "Windows":
                    os.startfile(str(path))
                    return True
            except Exception:
                pass
            return False

    # ------------------------------------------------------------------
    # Filename helpers
    # ------------------------------------------------------------------

    def get_expected_filename(self, equipment: Equipment) -> str:
        """Return the expected CSV filename for *equipment*.

        If equipment.csv_filename is set, it is sanitized and returned.
        Otherwise a canonical name is derived from the equipment id:
        e.g. eq_raqs_101 -> RAQS_101.csv
        """
        if equipment.csv_filename and equipment.csv_filename.strip():
            try:
                return sanitize_csv_name(equipment.csv_filename)
            except ValueError:
                return equipment.csv_filename.strip()

        eq_type = equipment.equipment_type.value.upper()
        suffix = equipment.id.rsplit("_", maxsplit=1)[-1]
        return f"{eq_type}_{suffix}.csv"

    # ------------------------------------------------------------------
    # File existence and directory scanning
    # ------------------------------------------------------------------

    def file_exists(self, filename: str) -> bool:
        """Return *True* if *filename* exists in :attr:`csv_dir`."""
        _validate_filename(filename)
        # Direct check
        target = self.csv_dir / filename
        if target.is_file():
            return True
        # Case-insensitive fallback for cross-platform safety
        fn_lower = filename.lower()
        try:
            for p in self.csv_dir.iterdir():
                if p.is_file() and p.name.lower() == fn_lower:
                    return True
        except Exception:
            pass
        return False

    def scan_directory(self) -> List[str]:
        """Return a sorted list of all ``.csv`` basenames in :attr:`csv_dir`."""
        return sorted(
            p.name
            for p in self.csv_dir.iterdir()
            if p.is_file() and p.suffix.lower() == ".csv"
        )

    # ------------------------------------------------------------------
    # CSV reading with Pandas
    # ------------------------------------------------------------------

    def read_csv(self, filename: str) -> pd.DataFrame:
        """Read *filename* from :attr:`csv_dir` into a :class:`pandas.DataFrame`."""
        _validate_filename(filename)
        path = self.csv_dir / filename
        if not path.is_file():
            # Try case-insensitive lookup
            fn_lower = filename.lower()
            matched = None
            for p in self.csv_dir.iterdir():
                if p.is_file() and p.name.lower() == fn_lower:
                    matched = p
                    break
            if matched:
                path = matched
            else:
                raise FileNotFoundError(
                    f"CSV file not found in {self.csv_dir}: {filename!r}"
                )
        try:
            # 1. Try utf-8-sig with automatic separator detection (handles comma, semicolon, tab, and BOM)
            try:
                df = pd.read_csv(path, sep=None, engine="python", encoding="utf-8-sig")
            except Exception:
                df = pd.read_csv(path, encoding="utf-8-sig")

            # Clean headers: strip whitespace and remove any stray BOM (\ufeff) or wrapping quotes
            df.columns = [str(c).strip().replace("\ufeff", "").strip('"\'') for c in df.columns]
            return df
        except Exception as exc:  # noqa: BLE001
            raise CSVReadError(
                f"Failed to parse {filename!r}: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Header & data inspection
    # ------------------------------------------------------------------

    def inspect_headers(self, filename: str) -> List[str]:
        """Return the column names of *filename*."""
        df = self.read_csv(filename)
        return list(df.columns)

    def inspect_data(self, filename: str, max_rows: int = 5) -> dict:
        """Return a summary dictionary describing the content of *filename*."""
        df = self.read_csv(filename)
        headers = list(df.columns)
        row_count = len(df)
        preview = df.head(max_rows).to_dict(orient="records") if row_count > 0 else []
        return {
            "headers": headers,
            "row_count": row_count,
            "preview": preview,
        }

    # ------------------------------------------------------------------
    # Dummy CSV Generation (Right columns, 0 data rows)
    # ------------------------------------------------------------------

    def create_dummy_csv(self, filename: str, equipment_type: EquipmentType) -> Path:
        """Create a dummy CSV file containing only the standard headers (WITHOUT ANY DATA rows).

        Writes a single header line with the canonical columns for the equipment type.
        Resulting file has exactly 0 data rows.
        """
        clean_name = sanitize_csv_name(filename)
        path = self.csv_dir / clean_name
        headers = EQUIPMENT_CSV_COLUMNS.get(
            equipment_type,
            ["Timestamp"] + EQUIPMENT_PARAMETERS.get(equipment_type, ["Value"])
        )
        with open(path, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
        return path

    # ------------------------------------------------------------------
    # Reporting
    # ------------------------------------------------------------------

    def report_missing_files(
        self, equipment_list: List[Equipment]
    ) -> List[MissingFileReport]:
        """Return a report of equipment whose expected CSV files are missing."""
        reports: List[MissingFileReport] = []
        for eq in equipment_list:
            expected = self.get_expected_filename(eq)
            try:
                exists = self.file_exists(expected)
            except ValueError:
                exists = False
            if not exists:
                reports.append(
                    MissingFileReport(
                        equipment_id=eq.id,
                        equipment_name=eq.name,
                        equipment_type=eq.equipment_type.value,
                        expected_filename=expected,
                    )
                )
        return reports

    def report_invalid_files(self) -> List[InvalidFileReport]:
        """Return a report of CSV files in :attr:`csv_dir` that fail to parse."""
        reports: List[InvalidFileReport] = []
        for filename in self.scan_directory():
            try:
                self.read_csv(filename)
            except CSVReadError as exc:
                reports.append(
                    InvalidFileReport(filename=filename, error_message=str(exc))
                )
            except FileNotFoundError:
                pass
        return reports

    # ------------------------------------------------------------------
    # Full rescan & process
    # ------------------------------------------------------------------

    def rescan(self, create_dummies_for_missing: bool = False) -> ScanResult:
        """Perform a fresh full scan of the CSV directory and equipment list.

        Parameters
        ----------
        create_dummies_for_missing:
            If *True*, creates dummy CSV files with standard headers and zero data rows
            for any equipment whose expected CSV file is missing.
        """
        from backend.app.services.configuration_service import ConfigurationService

        config_svc = ConfigurationService()
        equipment_list = config_svc.get_equipment()

        missing: List[MissingFileReport] = []
        created_dummy_files: List[str] = []
        equipment_statuses: Dict[str, EquipmentStatusReport] = {}

        for eq in equipment_list:
            # Check if user configured a filename
            has_configured_filename = bool(eq.csv_filename and eq.csv_filename.strip())
            expected = self.get_expected_filename(eq)

            exists = False
            try:
                exists = self.file_exists(expected)
            except ValueError:
                exists = False

            if not exists:
                # File does not exist
                missing.append(
                    MissingFileReport(
                        equipment_id=eq.id,
                        equipment_name=eq.name,
                        equipment_type=eq.equipment_type.value,
                        expected_filename=expected,
                    )
                )

                if create_dummies_for_missing:
                    # User requested scan and process: create dummy file with right columns but 0 data
                    try:
                        self.create_dummy_csv(expected, eq.equipment_type)
                        created_dummy_files.append(expected)
                        equipment_statuses[eq.id] = EquipmentStatusReport(
                            equipment_id=eq.id,
                            equipment_name=eq.name,
                            equipment_type=eq.equipment_type.value,
                            csv_filename=expected,
                            status="NO_DATA",  # Yellow dot (file without data)
                            row_count=0,
                            headers=EQUIPMENT_CSV_COLUMNS.get(eq.equipment_type, []),
                            created_dummy=True,
                        )
                    except Exception as e:
                        logger.error(f"Failed to create dummy CSV for {expected}: {e}")
                        equipment_statuses[eq.id] = EquipmentStatusReport(
                            equipment_id=eq.id,
                            equipment_name=eq.name,
                            equipment_type=eq.equipment_type.value,
                            csv_filename=expected if has_configured_filename else "",
                            status="NO_FILE",  # Red dot (box without a file)
                            row_count=0,
                            headers=[],
                            created_dummy=False,
                        )
                else:
                    # Regular status check without auto-generation
                    if has_configured_filename:
                        # User chose a filename, but file is missing
                        status = "NO_FILE"  # Red dot
                    else:
                        # User did not configure a file at all
                        status = "NO_FILE"  # Red dot
                    equipment_statuses[eq.id] = EquipmentStatusReport(
                        equipment_id=eq.id,
                        equipment_name=eq.name,
                        equipment_type=eq.equipment_type.value,
                        csv_filename=expected if has_configured_filename else "",
                        status=status,
                        row_count=0,
                        headers=[],
                        created_dummy=False,
                    )
            else:
                # File exists: inspect data
                try:
                    data = self.inspect_data(expected)
                    row_count = data["row_count"]
                    headers = data["headers"]
                    # If row_count > 0 -> HAS_DATA (green dot)
                    # If row_count == 0 -> NO_DATA (yellow dot)
                    status = "HAS_DATA" if row_count > 0 else "NO_DATA"
                    equipment_statuses[eq.id] = EquipmentStatusReport(
                        equipment_id=eq.id,
                        equipment_name=eq.name,
                        equipment_type=eq.equipment_type.value,
                        csv_filename=expected,
                        status=status,
                        row_count=row_count,
                        headers=headers,
                        created_dummy=False,
                    )
                except CSVReadError:
                    equipment_statuses[eq.id] = EquipmentStatusReport(
                        equipment_id=eq.id,
                        equipment_name=eq.name,
                        equipment_type=eq.equipment_type.value,
                        csv_filename=expected,
                        status="INVALID",  # Red dot
                        row_count=0,
                        headers=[],
                        created_dummy=False,
                    )

        found_files = self.scan_directory()
        invalid = self.report_invalid_files()
        scanned_at = datetime.now(timezone.utc).isoformat()

        return ScanResult(
            found_files=found_files,
            missing_reports=missing,
            invalid_reports=invalid,
            scanned_at=scanned_at,
            created_dummy_files=created_dummy_files,
            equipment_statuses=equipment_statuses,
        )

    # ------------------------------------------------------------------
    # Equipment ↔ CSV association
    # ------------------------------------------------------------------

    def get_equipment_csv_data(self, equipment: Equipment) -> Optional[dict]:
        """Return CSV data preview for *equipment*, or *None* if unavailable."""
        if not equipment.csv_filename:
            return None
        try:
            if not self.file_exists(equipment.csv_filename):
                return None
        except ValueError:
            return None
        return self.inspect_data(equipment.csv_filename)
