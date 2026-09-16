# Round 5 roster database

The roster database is generated from the first worksheet of the source XLSX. The generator uses the workbook as an immutable source, normalizes identity fields, and writes three private artifacts beside the workbook:

- `depi-r5-database.sqlite`: a complete SQLite copy with all application migrations and roster data.
- `depi-r5-roster-data.sql`: data-only SQL for a migrated, empty D1 database.
- `depi-r5-reconciliation.json`: counts, validation results, conflict resolutions, and launch follow-up without student PII.

The SQL and SQLite files contain personal data. Keep them out of source control and transfer them only through an approved private channel.

## Build

From the project root:

```powershell
python scripts/build-roster-database.py `
  --input "..\DEPI R5 Coaching Phase.xlsx" `
  --output "..\depi-r5-database.sqlite" `
  --sql-output "..\depi-r5-roster-data.sql" `
  --report "..\depi-r5-reconciliation.json" `
  --group-start-date YYYY-MM-DD
```

Use the approved coaching start date for `--group-start-date`. The current generated copy uses the import date as a visible placeholder because the workbook does not contain a start-date column.

## Identity and reconciliation rules

- The 14-digit national student ID is the source identity used to detect repeated people.
- A non-empty TP ID is the preferred application student key.
- When a canonical student has no usable unique TP ID, the generator creates a stable non-reversible key from the national ID. The national ID itself is never placed in the application key.
- Emails are trimmed and lowercased. Invalid and missing emails fail the build.
- Repeated source rows are retained in `roster_source_rows` and linked to one canonical student record.
- Group metadata uses the most frequent source value. Every conflict is recorded in the reconciliation report.
- `ACTIVE`, `DROPOUT`, and `NOT ACTIVE` map to `Active`, `Withdrawn`, and `Paused` lifecycle values.

## Staff and authentication

The workbook has no coordinator, supervisor, or coach columns. The generator therefore creates disabled `system-unassigned-*` staff records to satisfy referential integrity. Replace those assignments before launch.

The first authenticated administrator initializes the imported production workspace through the existing setup screen. The application then records that Supabase user as Project Operations and Operations Systems / Admin. Student Supabase accounts remain separate: their authenticated email is matched to the normalized roster email.

## D1 import order

1. Apply every file in `drizzle/` through migration `0012`.
2. Import `depi-r5-roster-data.sql` into an empty database.
3. Sign in with the intended first administrator and choose production setup.
4. Add real staff users, replace all unassigned group ownership, and confirm group start dates.
5. Compare D1 totals with `depi-r5-reconciliation.json`.

Never run the data SQL twice. The batch, student, and source-file identities are unique and the second import is expected to fail rather than duplicate records.
