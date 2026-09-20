# Supabase backend schema

The `supabase/migrations/` directory is the PostgreSQL/Supabase target for the DEPI operational backend. It mirrors every table in `db/schema.ts`, but uses native PostgreSQL types (`timestamptz`, `date`, `boolean`, `numeric`, and `jsonb`) instead of SQLite text and integer encodings.

## What is implemented

1. `202609180001_core_schema.sql` creates all 59 operational tables, foreign keys, uniqueness rules, indexes, bounded numeric checks, normalized identity indexes, and the explicit link from staff records to `auth.users`.
2. `202609180002_integrity_and_rls.sql` ports the critical D1 runtime triggers, adds the three-link deferred constraint, makes audit/review/ledger/closure records append-only, enables RLS on every application table, and grants authenticated clients read-only access within staff or student scope.
3. `202609180003_private_evidence_storage.sql` creates the private `depi-evidence` bucket. Reads are authorized by joining the object key to `attachments`; browser writes are not allowed.
4. `lib/supabase/admin.ts` provides the server-only service-role client for the repository adapter.
5. `supabase/column-types.json` is the exact table/column PostgreSQL type contract used to transform D1 bindings and imports.
6. `supabase/roster-source-contract.json` pins the authoritative Excel file, sheet, hash, headers, canonicalization rules, expected reconciliation totals, and duplicate-header handling.

Supabase is the only managed paid backend target: PostgreSQL, Auth, and private Storage. D1 and R2 remain migration and rollback sources only; they are not part of the intended production runtime after cutover. No additional paid data service is required by this design.

## Validation

All three migrations were executed successfully against disposable PostgreSQL 18.4 on 18 September 2026. The resulting database contained 59 public application tables, RLS enabled on all 59, 22 application triggers, and the private `depi-evidence` bucket with an 8 MB object limit. Static tests also verify D1 table/column parity, the exact PostgreSQL type contract, the roster workbook contract, critical safeguards, RLS activation, and the absence of authenticated browser-write storage policies.

## Identity model

- `users.id` and `students.id` remain stable text business IDs so existing foreign keys and imports do not change.
- Staff can be bound directly through `users.auth_user_id = auth.uid()`.
- During onboarding, a staff record without `auth_user_id` can still resolve through its unique normalized email.
- Students resolve through the unique normalized `students.email` value.
- Public registration remains disabled; identities are provisioned through Supabase Auth administration.

## Security model

- `anon` receives no table or evidence access.
- `authenticated` receives `SELECT` only. Policies restrict operational records by assigned group and let students see only their own student/service-link data.
- No authenticated mutation policies exist. The backend service role performs writes only after the existing API authorization, validation, rate-limit, and audit steps.
- Service-role credentials are server-only. Never prefix them with `NEXT_PUBLIC_`, return them in API responses, or place them in source control.

## Applying in a Supabase project

Use the Supabase CLI or SQL migration runner against a non-production project first. Apply the files in timestamp order, then run the repository test suite. The migration creates the private evidence bucket, so the executing role must be able to manage the `storage` schema.

Required protected runtime values:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key used for Auth sessions>
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
SUPABASE_EVIDENCE_BUCKET=depi-evidence
SUPABASE_DB_URL=<server-only Supabase transaction-pooler connection string>
```

Before switching the application data path, import the authoritative Excel roster using `roster-source-contract.json`, transform any retained D1 operational history using `column-types.json`, import in foreign-key order, reconcile counts and evidence hashes, test every role, and run a rollback rehearsal. Do not point production API routes at Supabase merely because the schema migrations have been applied.
