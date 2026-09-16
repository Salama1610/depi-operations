#!/usr/bin/env python3
"""Build a D1-compatible DEPI roster database from the Round 5 workbook.

The script uses only the Python standard library. It creates a complete SQLite
database, a data-only SQL import file, and a reconciliation report without
putting student PII in the Git repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET


NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
REQUIRED_COLUMNS = {
    "TP ID",
    "NameEn",
    "NameAr",
    "StudentId",
    "Phone",
    "Email",
    "Track",
    "JobProfile",
    "Current Group Code",
    "Students Type",
    "Student Status",
    "Training Provider",
}
POLICY = {
    "contactDays": 7,
    "coachHours": 24,
    "l1Hours": 24,
    "qualityHours": 48,
    "correctionDays": 7,
    "failedAttempts": 5,
    "failedWindowDays": 14,
    "target": 85,
    "minGig": 5,
    "gigCount": 3,
    "minTotal": 15,
    "largeGig": 300,
    "regularSessionCount": 8,
    "industrySessionCount": 5,
    "sessionMinutes": 180,
    "riskAttendance": 70,
    "criticalAttendance": 50,
    "journeyDelayedLag": 1,
    "journeyCriticalLag": 2,
    "milestoneWeek1": 1,
    "milestoneWeek2": 2,
    "milestoneWeek3": 3,
    "milestoneWeek4": 4,
    "milestoneWeek5": 5,
    "milestoneWeek6": 6,
    "milestoneWeek7": 7,
    "milestoneWeek8": 8,
}


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def column_index(reference: str) -> int:
    letters = re.sub(r"[^A-Z]", "", reference.upper())
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - 64
    return value - 1


def workbook_rows(path: Path) -> tuple[str, list[dict[str, str]]]:
    with zipfile.ZipFile(path) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall(f"{NS}si"):
                shared.append("".join(node.text or "" for node in item.iter(f"{NS}t")))

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = workbook.find(f"{NS}sheets/{NS}sheet")
        if sheet is None:
            raise ValueError("The workbook does not contain a worksheet.")
        sheet_name = sheet.attrib.get("name", "Sheet1")
        relation_id = sheet.attrib[f"{REL_NS}id"]
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = next(
            rel.attrib["Target"]
            for rel in rels.findall(f"{PKG_REL_NS}Relationship")
            if rel.attrib.get("Id") == relation_id
        )
        sheet_path = target.lstrip("/")
        if not sheet_path.startswith("xl/"):
            sheet_path = "xl/" + sheet_path
        root = ET.fromstring(archive.read(sheet_path))
        matrix: list[list[str]] = []
        for row in root.findall(f".//{NS}sheetData/{NS}row"):
            values: list[str] = []
            for cell in row.findall(f"{NS}c"):
                index = column_index(cell.attrib.get("r", "A1"))
                while len(values) <= index:
                    values.append("")
                cell_type = cell.attrib.get("t")
                value_node = cell.find(f"{NS}v")
                raw = value_node.text if value_node is not None else ""
                if cell_type == "s" and raw:
                    value = shared[int(raw)]
                elif cell_type == "inlineStr":
                    value = "".join(node.text or "" for node in cell.iter(f"{NS}t"))
                else:
                    value = raw or ""
                values[index] = clean(value)
            matrix.append(values)

    if not matrix:
        raise ValueError("The first worksheet is empty.")
    headers = [clean(value) for value in matrix[0]]
    missing = sorted(REQUIRED_COLUMNS - set(headers))
    if missing:
        raise ValueError("Missing required columns: " + ", ".join(missing))
    rows: list[dict[str, str]] = []
    for row_number, values in enumerate(matrix[1:], start=2):
        record = {
            header: clean(values[index] if index < len(values) else "")
            for index, header in enumerate(headers)
            if header
        }
        if any(record.values()):
            record["__row_number"] = str(row_number)
            rows.append(record)
    return sheet_name, rows


def mode(values: list[str]) -> str:
    counts = Counter(value for value in values if value)
    if not counts:
        return ""
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def canonicalize(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], dict[int, dict[str, str]], list[dict[str, object]]]:
    by_identity: dict[str, list[dict[str, str]]] = defaultdict(list)
    issues: list[dict[str, object]] = []
    for row in rows:
        national_id = row["StudentId"]
        if not re.fullmatch(r"\d{14}", national_id):
            issues.append({"type": "invalid_national_id", "row": int(row["__row_number"])})
        email = row["Email"].lower()
        row["Email"] = email
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            issues.append({"type": "invalid_email", "row": int(row["__row_number"])})
        by_identity[national_id or f"missing-row-{row['__row_number']}"] .append(row)

    canonical: list[dict[str, str]] = []
    source_mapping: dict[int, dict[str, str]] = {}
    used_ids: set[str] = set()
    for identity, candidates in by_identity.items():
        selected = sorted(
            candidates,
            key=lambda row: (0 if row["TP ID"] else 1, int(row["__row_number"])),
        )[0]
        generated_id = "R5-NID-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12].upper()
        student_id = selected["TP ID"] or generated_id
        selected["__canonical_tp_id"] = selected["TP ID"]
        if student_id in used_ids:
            issues.append({
                "type": "duplicate_tp_id",
                "row": int(selected["__row_number"]),
                "resolution": "Generated a stable student key from the national ID",
            })
            student_id = generated_id
            selected["__canonical_tp_id"] = ""
        if student_id in used_ids:
            raise ValueError("Generated duplicate student key; review the source identifiers.")
        used_ids.add(student_id)
        selected["__student_key"] = student_id
        canonical.append(selected)
        if selected["Student Status"].upper() not in {"ACTIVE", "DROPOUT", "NOT ACTIVE"}:
            issues.append({
                "type": "missing_or_unknown_student_status",
                "row": int(selected["__row_number"]),
                "resolution": "Mapped to Paused for launch review",
            })
        selected_row = int(selected["__row_number"])
        for candidate in candidates:
            row_number = int(candidate["__row_number"])
            if row_number == selected_row:
                disposition = "Canonical"
                reason = "Selected as the current roster record"
            else:
                disposition = "Duplicate merged"
                reason = "Same national ID, email, and phone; canonical row has a TP ID"
            source_mapping[row_number] = {
                "student_id": student_id,
                "disposition": disposition,
                "reason": reason,
            }
        if len(candidates) > 1:
            for field in ("Email", "Phone", "NameEn", "NameAr"):
                if len({candidate[field] for candidate in candidates}) > 1:
                    issues.append({
                        "type": f"duplicate_identity_conflicting_{field.lower()}",
                        "rows": [int(candidate["__row_number"]) for candidate in candidates],
                    })
    return canonical, source_mapping, issues


def lifecycle(source_status: str) -> str:
    return {
        "ACTIVE": "Active",
        "DROPOUT": "Withdrawn",
        "NOT ACTIVE": "Paused",
    }.get(source_status.upper(), "Paused")


def apply_migrations(connection: sqlite3.Connection, migrations: Path) -> None:
    for migration in sorted(migrations.glob("*.sql")):
        sql = migration.read_text(encoding="utf-8").replace("--> statement-breakpoint", "")
        connection.executescript(sql)


def sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def insert_sql(table: str, columns: list[str], rows: list[tuple[object, ...]]) -> list[str]:
    names = ",".join(f'"{column}"' for column in columns)
    return [
        f'INSERT INTO "{table}" ({names}) VALUES ({",".join(sql_literal(value) for value in row)});'
        for row in rows
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--sql-output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--migrations", type=Path, default=Path(__file__).resolve().parents[1] / "drizzle")
    parser.add_argument("--group-start-date", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    source = args.input.resolve()
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    sheet_name, source_rows = workbook_rows(source)
    if args.limit:
        source_rows = source_rows[: args.limit]
    canonical, source_mapping, issues = canonicalize(source_rows)

    group_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in source_rows:
        group_rows[row["Current Group Code"]].append(row)
    groups: list[tuple[object, ...]] = []
    group_conflicts: list[dict[str, object]] = []
    for code, members in sorted(group_rows.items()):
        tracks = [member["Track"] for member in members]
        profiles = [member["JobProfile"] for member in members]
        providers = [member["Training Provider"] for member in members]
        track = mode(tracks)
        profile = mode(profiles)
        provider = mode(providers)
        for field, values in (("track", tracks), ("job_profile", profiles), ("provider", providers)):
            distinct = sorted(set(value for value in values if value))
            if len(distinct) > 1:
                group_conflicts.append({"group": code, "field": field, "values": distinct, "selected": mode(values)})
        delivery_model = "Industry" if track == "Depi Industry" else "Regular"
        groups.append((
            code,
            code,
            track,
            provider,
            "system-unassigned-coordinator",
            "system-unassigned-supervisor",
            "system-unassigned-coach",
            "Outcome",
            delivery_model,
            args.group_start_date,
            "Active",
            "R5-v1",
        ))

    missing_tp = sum(1 for row in canonical if not row["TP ID"])
    generated_ids = sum(1 for row in canonical if row["__student_key"].startswith("R5-NID-"))
    duplicate_rows = len(source_rows) - len(canonical)
    imported_tracks = sorted({str(group[2]) for group in groups})
    imported_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    import_id = "ROSTER-" + source_hash[:16].upper()
    report = {
        "source_file": source.name,
        "source_sheet": sheet_name,
        "source_sha256": source_hash,
        "source_rows": len(source_rows),
        "canonical_students": len(canonical),
        "duplicate_rows_merged": duplicate_rows,
        "groups": len(groups),
        "tracks": len(imported_tracks),
        "source_track_values": len({row["Track"] for row in source_rows}),
        "providers": len({row["Training Provider"] for row in source_rows}),
        "missing_email": sum(1 for row in canonical if not row["Email"]),
        "invalid_email": sum(1 for issue in issues if issue["type"] == "invalid_email"),
        "missing_tp_id_canonical_students": missing_tp,
        "generated_student_ids": generated_ids,
        "group_metadata_conflicts": group_conflicts,
        "source_validation_issues": issues,
        "required_follow_up": [
            "Replace the three system-unassigned staff assignments on every group with real coordinator, supervisor, and coach users.",
            f"Confirm each group start date; {args.group_start_date} is the import placeholder because the workbook has no start-date column.",
            "Create or invite Supabase Auth users separately; this database links a signed-in student by normalized email.",
        ],
        "created_at": imported_at,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.sql_output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        args.output.unlink()
    connection = sqlite3.connect(args.output)
    connection.execute("PRAGMA foreign_keys=ON")
    apply_migrations(connection, args.migrations)

    users = [
        ("system-unassigned-coordinator", "unassigned+coordinator@invalid.local", "Unassigned coordinator", '["Operations Coordinator"]', "[]", 0),
        ("system-unassigned-supervisor", "unassigned+supervisor@invalid.local", "Unassigned supervisor", '["Team Supervisor"]', "[]", 0),
        ("system-unassigned-coach", "unassigned+coach@invalid.local", "Unassigned coach", '["Coach"]', "[]", 0),
    ]
    policy_row = (
        "R5-v1",
        "Round 5 · v1",
        "Effective",
        json.dumps(POLICY, separators=(",", ":")),
        "roster-import",
        None,
        imported_at,
    )
    track_rows = [
        ("TRACK-" + hashlib.sha256(track.encode("utf-8")).hexdigest()[:12].upper(), track, None, None, 1, imported_at)
        for track in imported_tracks
    ]
    student_rows: list[tuple[object, ...]] = []
    for row in sorted(canonical, key=lambda item: item["__student_key"]):
        student_rows.append((
            row["__student_key"],
            row["__canonical_tp_id"] or None,
            row["StudentId"],
            row["NameEn"],
            row["NameAr"],
            row["Current Group Code"],
            row["Email"],
            row["Phone"],
            row["JobProfile"],
            row["Students Type"],
            row["Student Status"],
            row.get("Serial") or None,
            row.get("Round 1?") or None,
            int(row["__row_number"]),
            lifecycle(row["Student Status"]),
            "Active",
            "In Progress",
            0,
            None,
            imported_at,
        ))
    summary_json = json.dumps(report, ensure_ascii=False, separators=(",", ":"))
    roster_import_row = (
        import_id,
        source.name,
        sheet_name,
        source_hash,
        len(source_rows),
        len(canonical),
        duplicate_rows,
        "Reconciled",
        summary_json,
        imported_at,
    )

    with connection:
        connection.executemany(
            "INSERT INTO users(id,email,name,roles,scopes,active) VALUES(?,?,?,?,?,?)",
            users,
        )
        connection.execute(
            "INSERT INTO policies(id,name,status,config,created_by,approved_by,created_at) VALUES(?,?,?,?,?,?,?)",
            policy_row,
        )
        connection.executemany(
            "INSERT INTO tracks(id,name,provider,capacity,active,created_at) VALUES(?,?,?,?,?,?)",
            track_rows,
        )
        connection.executemany(
            "INSERT INTO groups(id,name,track,provider,coordinator,supervisor,coach,pathway,delivery_model,start_date,status,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            groups,
        )
        connection.executemany(
            "INSERT INTO students(id,tp_id,national_id,name,name_ar,group_id,email,phone,job_profile,student_type,source_status,serial,round_1,source_row,lifecycle,engagement,coaching,milestone,last_contact,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            student_rows,
        )
        connection.execute(
            "INSERT INTO roster_imports(id,source_name,source_sheet,source_sha256,total_rows,canonical_students,duplicate_rows,status,summary,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            roster_import_row,
        )
        source_db_rows = []
        for row in source_rows:
            row_number = int(row["__row_number"])
            mapping = source_mapping[row_number]
            payload = {key: value for key, value in row.items() if not key.startswith("__")}
            source_db_rows.append((
                f"{import_id}-{row_number}",
                import_id,
                row_number,
                mapping["student_id"],
                mapping["disposition"],
                mapping["reason"],
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            ))
        connection.executemany(
            "INSERT INTO roster_source_rows(id,import_id,row_number,student_id,disposition,reason,payload) VALUES(?,?,?,?,?,?,?)",
            source_db_rows,
        )
    connection.execute("PRAGMA optimize")
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
    report["database_validation"] = {
        "integrity_check": integrity,
        "foreign_key_errors": len(foreign_key_errors),
        "student_rows": connection.execute("SELECT count(*) FROM students").fetchone()[0],
        "group_rows": connection.execute("SELECT count(*) FROM groups").fetchone()[0],
        "staged_source_rows": connection.execute("SELECT count(*) FROM roster_source_rows").fetchone()[0],
    }
    connection.close()

    sql_sections = ["PRAGMA foreign_keys=ON;", "BEGIN TRANSACTION;"]
    sql_sections += insert_sql("users", ["id", "email", "name", "roles", "scopes", "active"], users)
    sql_sections += insert_sql("policies", ["id", "name", "status", "config", "created_by", "approved_by", "created_at"], [policy_row])
    sql_sections += insert_sql("tracks", ["id", "name", "provider", "capacity", "active", "created_at"], track_rows)
    sql_sections += insert_sql("groups", ["id", "name", "track", "provider", "coordinator", "supervisor", "coach", "pathway", "delivery_model", "start_date", "status", "policy_id"], groups)
    sql_sections += insert_sql("students", ["id", "tp_id", "national_id", "name", "name_ar", "group_id", "email", "phone", "job_profile", "student_type", "source_status", "serial", "round_1", "source_row", "lifecycle", "engagement", "coaching", "milestone", "last_contact", "created_at"], student_rows)
    sql_sections += insert_sql("roster_imports", ["id", "source_name", "source_sheet", "source_sha256", "total_rows", "canonical_students", "duplicate_rows", "status", "summary", "created_at"], [roster_import_row])
    source_sql_rows = []
    for row in source_rows:
        row_number = int(row["__row_number"])
        mapping = source_mapping[row_number]
        payload = {key: value for key, value in row.items() if not key.startswith("__")}
        source_sql_rows.append((f"{import_id}-{row_number}", import_id, row_number, mapping["student_id"], mapping["disposition"], mapping["reason"], json.dumps(payload, ensure_ascii=False, separators=(",", ":"))))
    sql_sections += insert_sql("roster_source_rows", ["id", "import_id", "row_number", "student_id", "disposition", "reason", "payload"], source_sql_rows)
    sql_sections.append("COMMIT;")
    args.sql_output.write_text("\n".join(sql_sections) + "\n", encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "database": str(args.output),
        "sql": str(args.sql_output),
        "report": str(args.report),
        "students": len(canonical),
        "groups": len(groups),
        "duplicate_rows_merged": duplicate_rows,
        "integrity_check": integrity,
        "foreign_key_errors": len(foreign_key_errors),
    }, indent=2))
    return 0 if integrity == "ok" and not foreign_key_errors and not any(issue["type"].startswith("invalid_") for issue in issues) else 1


if __name__ == "__main__":
    sys.exit(main())
