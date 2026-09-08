# Private publishing blocker

The source and application build are available. There is no successfully published URL.

- Site: `appgprj_6a9f989b91388191a2c5c6782a994e8b`
- Failed saved version: `appgprj_6a9f989b91388191a2c5c6782a994e8b~appgver_c84c206f9ab88191b77957f85bfd51e1`
- Failed deployment: `appgdep_6a9fdf1500648191a8e6b486f42d4cd6`
- Error: `incomplete input: SQLITE_ERROR`
- Migration file in that version: `drizzle/0000_aspiring_misty_knight.sql`

The Sites read-only database overview returns no bindings; production Worker logs are unavailable. Those results do not prove that no schema statements executed. The original migration and its metadata have therefore been preserved exactly. Version 2 also failed with the same SQLite error. The latest automation and notification features append migration `0001_moaning_retro_girl.sql`; they do not alter or bypass the unresolved initial migration. This update has not retried deployment.

Required platform-side diagnostic: identify the failed deployment's database and inspect migration bookkeeping, existing schema and the exact failed SQL statement. If the initial migration is confirmed wholly unapplied, repair only that failed migration. If any migrations applied, retain those files and use the appropriate forward-only recovery. Do not delete or reset a database merely because its binding is absent from the overview response.

The migration executes successfully against local SQLite, including its triggers. A hosted SQL statement-splitting issue is one possible explanation, not a verified root cause. A local passing test does not establish hosted D1 migration success.

Current validation: 15 automated domain/service tests pass, including signed automation replay protection, recipient-scoped notifications, vault role/audit controls, and an encrypted backup restored into an isolated SQLite database with evidence hash and integrity checks. Existing policy and contact/account/evidence checks also pass. TypeScript validation and the Worker build also pass.
