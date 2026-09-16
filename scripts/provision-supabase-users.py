#!/usr/bin/env python3
"""Pre-provision roster identities in Supabase Auth without sending email."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import secrets
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--credentials", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    credentials = json.loads(args.credentials.read_text(encoding="utf-8-sig"))
    project_ref = credentials["project_ref"]
    service_key = credentials["service_role_key"]
    base = f"https://{project_ref}.supabase.co/auth/v1/admin"
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "Content-Type": "application/json",
        "User-Agent": "DEPI-Identity-Provisioner/1.0",
    }

    def call(path: str, method: str = "GET", payload: dict[str, object] | None = None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(base + path, data=data, method=method, headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))

    existing: set[str] = set()
    page = 1
    while True:
        result = call(f"/users?page={page}&per_page=1000")
        users = result.get("users", [])
        existing.update(str(user.get("email", "")).strip().lower() for user in users)
        if len(users) < 1000:
            break
        page += 1

    connection = sqlite3.connect(args.database)
    rows = connection.execute("SELECT email,name FROM students ORDER BY id").fetchall()
    connection.close()
    pending = [(email.strip().lower(), name) for email, name in rows if email.strip().lower() not in existing]
    print(f"existing identities: {len(existing)}")
    print(f"identities to create: {len(pending)}")

    def create(identity: tuple[str, str]):
        email, name = identity
        try:
            call(
                "/users",
                "POST",
                {
                    "email": email,
                    "password": secrets.token_urlsafe(36),
                    "email_confirm": False,
                    "user_metadata": {"full_name": name, "account_source": "DEPI Round 5 roster"},
                },
            )
            return "created"
        except urllib.error.HTTPError as error:
            if error.code == 422:
                return "existing"
            return f"http_{error.code}"
        except Exception:
            return "failed"

    totals: dict[str, int] = {}
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 12))) as pool:
        for status in pool.map(create, pending):
            totals[status] = totals.get(status, 0) + 1
            completed += 1
            if completed % 250 == 0 or completed == len(pending):
                print(f"processed: {completed}/{len(pending)}")
    print(json.dumps(totals, indent=2))
    failures = sum(value for key, value in totals.items() if key not in {"created", "existing"})
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
