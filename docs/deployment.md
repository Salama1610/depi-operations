# Deployment and recovery

The Sites manifest declares `DB` and `BUCKET` and the persistent Site identity. Keep credentials out of the repository. Hosting owns concrete resource bindings and trusted identity headers.

1. Install the locked dependencies.
2. Run TypeScript and domain/service integration checks.
3. Generate and inspect migrations. Apply `supabase/migrations/*.sql` to the Supabase project with `node scripts/apply-supabase-migrations.mjs`, which records applied versions and is safe to rerun. The SQLite schema in `drizzle/` keeps custom triggers for the same integrity invariants; retain them during future migrations and keep both sides additive.
4. Build the Worker and assets using the bundled build script.
5. Commit and push exactly the tested source, package that build, save a version and deploy it privately through Sites.
6. Wait for a terminal successful deployment before distributing the URL. No app-role grant changes the Site's hosting audience.

Environment contract: private hosting and Supabase. The runtime requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, the server-only `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_EVIDENCE_BUCKET`. The deployed Worker does not need a database connection string; `SUPABASE_DB_URL` is for Node tooling and tests only. The `DB` and `BUCKET` bindings stay declared for previews and tests and are used only with `LOCAL_DATA_FALLBACK=1`. Service-role keys and database passwords are server-only and never appear in source control or in a browser payload.

Separate local/development, staging and production Sites/resources before production. Never run synthetic initialization in a live dataset. Initial setup is atomic and one-time; it cannot overwrite an initialized database.

Rollback: deploy a previously validated Worker version only if its schema is compatible with the current database. Applied schema migrations are immutable; prefer forward correction. Back up and restore database and objects separately. A code rollback does not restore deleted/changed operational data. Before live rollout, define the approved backup schedule, retention, RPO/RTO and run a documented restoration into a separate environment; these have not been automatically provisioned by this pilot.
