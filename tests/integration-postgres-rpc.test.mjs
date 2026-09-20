// Runs the full service integration suite against a disposable PostgreSQL
// server through the HTTPS-shaped transport (lib/data/rpc.ts +
// public.depi_execute), the path the deployed Worker uses.
process.env.DEPI_TEST_BACKEND = "postgres-rpc";
await import("./integration.test.mjs");
