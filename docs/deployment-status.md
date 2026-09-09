# Private publishing blocker

The source and application build are available. There is no successfully published URL.

- Site: `appgprj_6a9f989b91388191a2c5c6782a994e8b`
- Failed saved version: `appgprj_6a9f989b91388191a2c5c6782a994e8b~appgver_c84c206f9ab88191b77957f85bfd51e1`
- Failed deployment: `appgdep_6a9fdf1500648191a8e6b486f42d4cd6`
- Error: `incomplete input: SQLITE_ERROR`
- Migration file in that version: `drizzle/0000_aspiring_misty_knight.sql`

The Sites read-only database overview returns no bindings and each failed release retried the same initial migration without reporting duplicate tables. This is consistent with the failed migration being rolled back. Local reproduction shows that executing the file as complete SQL succeeds, while semicolon splitting breaks the first trigger body with the same `incomplete input` class of error.

The recovery release removes only host-incompatible database triggers from the unpublished baseline. Equivalent eligibility, proof, state-transition, immutability and concurrency rules remain enforced by the server operation layer and tested through the application APIs. The trigger definitions remain available in Git history. Migration `0001_moaning_retro_girl.sql` still adds durable notifications and automation runs.

No database was deleted or reset. Publication must still prove that both migrations apply and expose the expected tables before real data is loaded.

Current validation: 15 automated domain/service tests pass, including signed automation replay protection, recipient-scoped notifications, vault role/audit controls, and an encrypted backup restored into an isolated SQLite database with evidence hash and integrity checks. Existing policy and contact/account/evidence checks also pass. TypeScript validation and the Worker build also pass.
