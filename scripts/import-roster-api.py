#!/usr/bin/env python3
"""Import the private roster SQLite build into a deployed DEPI Site over HTTPS."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path


def chunks(rows: list[dict[str, object]], size: int = 75):
    for index in range(0, len(rows), size):
        yield rows[index : index + size]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--credentials", required=True, type=Path)
    args = parser.parse_args()
    site = args.site.rstrip("/")
    credentials = json.loads(args.credentials.read_text(encoding="utf-8-sig"))
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(path: str, payload: dict[str, object] | None = None):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            site + path,
            data=data,
            method="GET" if data is None else "POST",
            headers={"Content-Type": "application/json", "Origin": site, "User-Agent": "DEPI-Roster-Importer/1.0"},
        )
        try:
            with opener.open(req, timeout=120) as response:
                value = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{path} returned HTTP {error.code}: {detail[:1000]}") from error
        if value.get("error"):
            raise RuntimeError(f"{path}: {value['error']}")
        return value

    request("/api/auth/login", {
        "email": credentials["bootstrap_admin_email"],
        "password": credentials["bootstrap_admin_password"],
    })
    state = request("/api/operations")
    if state.get("setup"):
        request("/api/operations", {"action": "setup", "mode": "production"})

    connection = sqlite3.connect(args.database)
    connection.row_factory = sqlite3.Row
    imported = dict(connection.execute("SELECT * FROM roster_imports LIMIT 1").fetchone())
    tracks = [dict(row) for row in connection.execute("SELECT * FROM tracks ORDER BY name")]
    groups = [dict(row) for row in connection.execute("SELECT * FROM groups ORDER BY id")]
    students = [dict(row) for row in connection.execute("SELECT * FROM students ORDER BY id")]
    sources = [dict(row) for row in connection.execute("SELECT * FROM roster_source_rows ORDER BY row_number")]
    connection.close()

    summary = json.loads(imported["summary"])
    request("/api/roster-import", {
        "stage": "metadata",
        "import": {
            "id": imported["id"],
            "source_name": imported["source_name"],
            "source_sheet": imported["source_sheet"],
            "source_sha256": imported["source_sha256"],
            "total_rows": imported["total_rows"],
            "canonical_students": imported["canonical_students"],
            "duplicate_rows": imported["duplicate_rows"],
            "summary": summary,
            "created_at": imported["created_at"],
        },
        "tracks": tracks,
        "groups": groups,
    })
    print(f"metadata: {len(tracks)} tracks, {len(groups)} groups")

    completed = 0
    for batch in chunks(students):
        request("/api/roster-import", {"stage": "students", "import_id": imported["id"], "rows": batch})
        completed += len(batch)
        if completed % 450 == 0 or completed == len(students):
            print(f"students: {completed}/{len(students)}")

    completed = 0
    for batch in chunks(sources):
        request("/api/roster-import", {"stage": "sources", "import_id": imported["id"], "rows": batch})
        completed += len(batch)
        if completed % 450 == 0 or completed == len(sources):
            print(f"source rows: {completed}/{len(sources)}")

    result = request("/api/roster-import", {"stage": "finalize", "import_id": imported["id"]})
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
