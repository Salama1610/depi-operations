// The ministry portal's coach for each group (3 November 2026).
//
// The portal assigns its own coach to each group, and only that coach can
// carry out a gig there. The team downloads the portal's "Coaches" sheet
// (Group Code, Coach, Coach Email) and uploads it here; the gigs our quality
// team decided then go to that coach. A group the sheet does not name, or
// whose portal coach has no account here, keeps the group's own coach.

/**
 * Each group's coach for the portal's gigs, as SQL on a groups alias: the
 * portal's coach when the sheet named one with an account here, otherwise the
 * group's coach. Coach Gigs and the Quality Lead's per-coach counts both use it.
 */
export function portalCoachSql(groupAlias = "g") {
  return `COALESCE((SELECT pc.coach_user_id FROM portal_coaches pc WHERE pc.group_id=${groupAlias}.id), ${groupAlias}.coach)`;
}

export type PortalCoachRow = { group: string; coach: string; email: string };

/** The sheet's rows, read by their headers: Group Code, Coach and Coach Email. */
export function readPortalCoachRows(rows: Record<string, unknown>[]): PortalCoachRow[] {
  const pick = (row: Record<string, unknown>, ...names: string[]) => {
    for (const [key, value] of Object.entries(row))
      if (names.includes(key.trim().toLowerCase())) return String(value ?? "").trim();
    return "";
  };
  return rows
    .map((row) => ({
      group: pick(row, "group code", "group", "group id").toUpperCase(),
      coach: pick(row, "coach", "coach name"),
      email: pick(row, "coach email", "email").toLowerCase(),
    }))
    .filter((row) => row.group);
}
