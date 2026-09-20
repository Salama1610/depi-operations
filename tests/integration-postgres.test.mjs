// Runs the full service integration suite against a disposable PostgreSQL
// server with the Supabase migrations applied (see tests/integration.test.mjs).
process.env.DEPI_TEST_BACKEND = "postgres";
await import("./integration.test.mjs");
