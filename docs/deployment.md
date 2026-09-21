# Deployment and recovery

## Vercel (current target)

The application builds with plain Next.js (`npm run build` runs `next build`) and runs on Vercel's Node runtime. Connect the GitHub repository to a Vercel project, keep the default framework detection (Next.js), and set these environment variables for Production: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_EVIDENCE_BUCKET`, `CREDENTIAL_ENCRYPTION_KEY`, and optionally `BACKUP_ENCRYPTION_KEY`, `AUTOMATION_HMAC_SECRET`, `AUTOMATION_ACTOR_EMAIL`. Every push to `main` deploys. Add the deployment's `/auth/callback` URL to the Supabase Auth redirect allowlist.

Runtime settings are read through `lib/env.ts`, which uses the process environment everywhere and lets the test harness inject values, so the same code runs on Vercel, on Node, and on the Cloudflare Worker build (`npm run build:cloudflare`), which remains available.

### Applying migrations without the database password

`node scripts/apply-supabase-migrations.mjs --credentials <private json> --management-api` runs the migration files through the Supabase Management API using a personal access token (`access_token` in the credentials file, or `SUPABASE_ACCESS_TOKEN`). `scripts/provision-student-logins.mjs` accepts the same flag. This is the path used when the project is created through the Vercel integration, which keeps the database password to itself.

## Cloudflare Sites (previous target)


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
