// Guards the contract between the automatic service-link gate and the
// PostgreSQL column constraint.
//
// The gate records rejected links so the student gets a correction message, and
// it labels them with a platform the accepted list does not contain. The
// original Supabase constraint allowed only the two accepted marketplaces, so
// every rejected link raised a check violation on PostgreSQL while working on
// D1. These tests fail if the gate learns a new platform value that the
// constraint does not allow.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyServiceLink } from "../lib/domain/service-links.ts";

/** Platform values allowed by the newest constraint on service_links.platform. */
function allowedPlatforms() {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let allowed = null;
  for (const file of files) {
    const sql = fs.readFileSync(new URL(file, dir), "utf8");
    // Take the last definition in file order, matching what PostgreSQL holds
    // after every migration has been applied.
    for (const match of sql.matchAll(/constraint\s+service_links_platform_check\s*\n?\s*check\s*\(platform in \(([^)]*)\)\)/gi)) {
      allowed = match[1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
    }
    for (const match of sql.matchAll(/platform text not null check \(platform in \(([^)]*)\)\)[\s\S]{0,400}?unique \(student_id, slot\)/gi)) {
      if (allowed === null) allowed = match[1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
    }
  }
  assert.ok(allowed, "no service_links platform constraint found in the migrations");
  return new Set(allowed);
}

const SAMPLES = [
  "https://kafiil.com/service/12345-a-service",
  "https://www.khamsat.com/programming/web-development/135790-a-service",
  "https://upwork.com/services/product/12345",
  "https://nafezly.com/service/56713-a-service",
  "https://nafezly.com/about",
  "http://kafiil.com/service/12345-a-service",
  "https://kafiil.com/service/not-numeric",
  "https://user:pass@kafiil.com/service/12345-a-service",
  "https://kafiil.com:8443/service/12345-a-service",
  "not a url at all",
  "",
  "   ",
  "https://خمسات.com/service/1-تصميم",
  "ftp://kafiil.com/service/12345-a-service",
];

test("every platform the gate can record is allowed by the PostgreSQL constraint", () => {
  const allowed = allowedPlatforms();
  const seen = new Set();
  for (const sample of SAMPLES) {
    const platform = verifyServiceLink(sample).platform;
    seen.add(platform);
    assert.ok(
      allowed.has(platform),
      `verifyServiceLink(${JSON.stringify(sample)}) records platform ${JSON.stringify(platform)}, ` +
        `which service_links_platform_check rejects. Allowed: ${[...allowed].join(", ")}. ` +
        "Add a migration that widens the constraint rather than dropping the row.",
    );
  }
  // The samples must actually exercise the rejected labels, otherwise this test
  // would pass while proving nothing.
  assert.ok(seen.has("External service"), "samples must include a non-marketplace host");
  assert.ok(seen.has("Unknown"), "samples must include an unparsable value");
  for (const platform of ["Kafiil", "Khamsat", "Nafezly"])
    assert.ok(seen.has(platform), `samples must include ${platform}`);
});

test("a rejected link is still recorded, with a reason the student can act on", () => {
  const external = verifyServiceLink("https://upwork.com/services/product/12345");
  assert.equal(external.status, "Failed");
  assert.equal(external.platform, "External service");
  assert.match(external.message, /Only Kafiil, Khamsat and Nafezly/);

  const unparsable = verifyServiceLink("not a url at all");
  assert.equal(unparsable.status, "Failed");
  assert.equal(unparsable.platform, "Unknown");
  assert.ok(unparsable.message.trim().length > 0);

  const accepted = verifyServiceLink("https://kafiil.com/service/12345-a-service");
  assert.equal(accepted.status, "Needs Review");
  assert.equal(accepted.platform, "Kafiil");

  // An http address on an approved marketplace is accepted and stored securely.
  const upgraded = verifyServiceLink("http://kafiil.com/service/12345-a-service");
  assert.equal(upgraded.status, "Needs Review");
  assert.equal(upgraded.normalizedUrl, "https://kafiil.com/service/12345-a-service");
  // An http address anywhere else is still refused.
  assert.equal(verifyServiceLink("http://example.com/service/12345-a-service").status, "Failed");
});
