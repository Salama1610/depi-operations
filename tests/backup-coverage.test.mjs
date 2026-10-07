// The administrator's encrypted backup exports the tables in backupTables. A
// table missing from that list is silently missing from every backup, and a
// restore trusts the manifest, so nothing would ever report it.
import test from "node:test";
import assert from "node:assert/strict";
import { backupTables } from "../lib/domain/backup.ts";
import { columnTypes } from "./helpers/schema-contract.mjs";

test("the backup exports every table the migrations create, once", () => {
  const tables = Object.keys(columnTypes()).sort();
  assert.deepEqual([...backupTables].sort(), tables);
  assert.equal(new Set(backupTables).size, backupTables.length, "no table twice");
});
