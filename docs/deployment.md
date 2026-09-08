# Deployment and recovery

The Sites manifest declares `DB` and `BUCKET` and the persistent Site identity. Keep credentials out of the repository. Hosting owns concrete resource bindings and trusted identity headers.

1. Install the locked dependencies.
2. Run TypeScript and domain/service integration checks.
3. Generate and inspect migrations. Initial schema contains custom SQLite triggers for important integrity invariants; retain them during future migrations.
4. Build the Worker and assets using the bundled build script.
5. Commit and push exactly the tested source, package that build, save a version and deploy it privately through Sites.
6. Wait for a terminal successful deployment before distributing the URL. No app-role grant changes the Site's hosting audience.

Environment contract: private hosting, authenticated identity headers supplied only by the trusted dispatcher, D1 DB, R2 BUCKET. There are no OpenAI API keys, messaging credentials, database passwords or client-account secrets in this application.

Separate local/development, staging and production Sites/resources before production. Never run synthetic initialization in a live dataset. Initial setup is atomic and one-time; it cannot overwrite an initialized database.

Rollback: deploy a previously validated Worker version only if its schema is compatible with the current database. Applied schema migrations are immutable; prefer forward correction. Back up and restore database and objects separately. A code rollback does not restore deleted/changed operational data. Before live rollout, define the approved backup schedule, retention, RPO/RTO and run a documented restoration into a separate environment; these have not been automatically provisioned by this pilot.
