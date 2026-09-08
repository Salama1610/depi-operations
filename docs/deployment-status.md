# Private publishing blocker

The source and application build are available. There is no successfully published URL.

- Site: `appgprj_6a9f989b91388191a2c5c6782a994e8b`
- Failed saved version: `appgprj_6a9f989b91388191a2c5c6782a994e8b~appgver_5a2dc3bfd66c8191ac70fd89966d86f2`
- Failed deployment: `appgdep_6a9f9f731c6c8191aa5d7189be4b9f8e`
- Error: `incomplete input: SQLITE_ERROR`
- Migration file in that version: `drizzle/0000_aspiring_misty_knight.sql`

The Sites read-only database overview returns no bindings; production Worker logs are unavailable. Those results do not prove that no schema statements executed. The original migration and its metadata have therefore been preserved exactly. The latest policy and workflow improvements require no schema change and have not retried the failed deployment.

Required platform-side diagnostic: identify the failed deployment's database and inspect migration bookkeeping, existing schema and the exact failed SQL statement. If the initial migration is confirmed wholly unapplied, repair only that failed migration. If any migrations applied, retain those files and use the appropriate forward-only recovery. Do not delete or reset a database merely because its binding is absent from the overview response.

The migration executes successfully against local SQLite, including its triggers. A hosted SQL statement-splitting issue is one possible explanation, not a verified root cause. A local passing test does not establish hosted D1 migration success.

Current validation: 11 automated domain/service tests pass, including policy validation, independent policy approval, new-group policy assignment, repeated policy-check batches and the original contact/account/evidence flow. TypeScript validation and the Worker build also pass.
