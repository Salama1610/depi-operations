import { db, stmt, now, uid, auditStmt } from "./server";
import { policy } from "./domain/rules";
import { runtimeTriggers } from "../db/runtime-triggers.mjs";
export async function seed(i: any, mode: "demo" | "production" = "demo") {
  for (const sql of runtimeTriggers) await db().prepare(sql).run();
  const t = now();
  const batch: any[] = [];
  batch.push(
    stmt(
      "INSERT INTO users(id,email,name,roles,scopes) VALUES(?,?,?,?,?)",
      i.id,
      i.email,
      i.name,
      JSON.stringify(["Project Operations", "Operations Systems / Admin"]),
      "[]",
    ),
  );
  // Explicit setup policy, bound to the current specification; no runtime schema mutation.
  batch.push(
    stmt(
      "INSERT INTO policies(id,name,status,config,created_by,approved_by,created_at) VALUES(?,?,?,?,?,?,?)",
      "R5-v1",
      "Round 5 · v1",
      "Effective",
      JSON.stringify(policy),
      i.id,
      i.id,
      t,
    ),
  );
  if (mode === "production") {
    batch.push(
      auditStmt(i, "Blank production workspace initialized", "workspace", {
        synthetic: false,
        mode,
      }),
    );
    await db().batch(batch);
    return;
  }
  const staff = [
    ["staff-sara", "Sara Ahmed", "Operations Coordinator"],
    ["staff-omar", "Omar Hassan", "Operations Coordinator"],
    ["staff-nour", "Nour El Din", "Team Supervisor"],
    ["staff-coach", "Mariam Adel", "Coach"],
    ["staff-support-coach", "Dalia Samir", "Coach"],
    ["staff-coach-ops", "Karim Nasser", "Coach Operations"],
    ["staff-quality", "Hana Mostafa", "Quality Member"],
    ["staff-quality-lead", "Mona Fathy", "Quality Lead"],
    ["staff-board", "Youssef Ali", "Higher Board"],
  ];
  batch.push(
    ...staff.map(([id, name, role]) =>
      stmt(
        "INSERT INTO users(id,email,name,roles,scopes) VALUES(?,?,?,?,?)",
        id,
        id + "@example.invalid",
        name,
        JSON.stringify([role]),
        "[]",
      ),
    ),
  );
  batch.push(
    stmt(
      "INSERT INTO task_bank(id,track,title,platform,value,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      "TB-DM-1",
      "Digital Marketing",
      "Social media banner",
      "Khamsat",
      5,
      i.id,
      t,
    ),
    stmt(
      "INSERT INTO task_bank(id,track,title,platform,value,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      "TB-WD-1",
      "Web Development",
      "Landing-page adjustment",
      "Nafezly",
      5,
      i.id,
      t,
    ),
    stmt(
      "INSERT INTO task_bank(id,track,title,platform,value,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      "TB-DA-1",
      "Data Analysis",
      "Spreadsheet dashboard",
      "Kafeel",
      5,
      i.id,
      t,
    ),
    stmt(
      "INSERT INTO task_bank(id,track,title,platform,value,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      "TB-GD-1",
      "Graphic Design",
      "Social media design",
      "Khamsat",
      5,
      i.id,
      t,
    ),
  );
  const tracks = [
    "Digital Marketing",
    "Web Development",
    "Data Analysis",
    "Graphic Design",
  ];
  batch.push(
    ...tracks.map((track, i) =>
      stmt(
        "INSERT INTO tracks(id,name,provider,capacity,created_at) VALUES(?,?,?,?,?)",
        `TRK-${i + 1}`,
        track,
        i % 2 ? "Freelance Yard" : "Career180",
        300,
        t,
      ),
    ),
  );
  const start = new Date(Date.now() - 24 * 86400000).toISOString().slice(0, 10);
  batch.push(
    ...Array.from({ length: 40 }, (_, i) =>
      stmt(
        "INSERT INTO groups(id,name,track,provider,coordinator,supervisor,coach,pathway,start_date,status,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        "G" + (101 + i),
        tracks[i % 4] + " " + (Math.floor(i / 4) + 1),
        tracks[i % 4],
        i % 2 ? "Freelance Yard" : "Career180",
        staff[i % 2][0],
        "staff-nour",
        "staff-coach",
        i % 3 ? "Outcome" : "Support",
        start,
        "Active",
        "R5-v1",
      ),
    ),
  );
  batch.push(
    ...Array.from({ length: 40 }, (_, i) => [
      stmt(
        "INSERT INTO group_coaches(id,group_id,user_id,coach_type,status,onboarding_status,checklist,assigned_by,assigned_at,onboarded_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        uid("GC"),
        "G" + (101 + i),
        "staff-coach",
        "Outcome Coach",
        "Active",
        "Complete",
        JSON.stringify([
          "Role boundaries acknowledged",
          "Group roster reviewed",
          "Session and attendance process reviewed",
          "Evidence SLA and escalation process reviewed",
        ]),
        "staff-coach-ops",
        t,
        t,
      ),
      stmt(
        "INSERT INTO group_coaches(id,group_id,user_id,coach_type,status,onboarding_status,checklist,assigned_by,assigned_at,onboarded_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        uid("GC"),
        "G" + (101 + i),
        "staff-support-coach",
        "Support Coach",
        "Active",
        "Complete",
        JSON.stringify([
          "Role boundaries acknowledged",
          "Group roster reviewed",
          "Session and attendance process reviewed",
          "Evidence SLA and escalation process reviewed",
        ]),
        "staff-coach-ops",
        t,
        t,
      ),
    ]).flat(),
  );
  batch.push(
    ...Array.from({ length: 12 }, (_, i) =>
      stmt(
        "INSERT INTO applications(id,external_ref,name,email,phone,preferred_track,status,source,consent_ref,owner,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        `APP-${101 + i}`,
        `MIN-R5-${101 + i}`,
        `Pilot Applicant ${i + 1}`,
        `pilot.applicant${i + 1}@example.invalid`,
        "",
        tracks[i % tracks.length],
        i % 4 === 0 ? "Eligible" : "Submitted",
        "Synthetic pilot import",
        null,
        staff[i % 2][0],
        t,
        t,
      ),
    ),
  );
  const first = [
    "Ahmed",
    "Salma",
    "Mohamed",
    "Nour",
    "Omar",
    "Farah",
    "Youssef",
    "Hana",
    "Mostafa",
    "Mariam",
    "Kareem",
    "Nada",
    "Ali",
    "Dina",
    "Hassan",
    "Reem",
    "Malak",
    "Amr",
    "Aya",
    "Tarek",
  ];
  const last = [
    "Hassan",
    "Adel",
    "Ibrahim",
    "Mahmoud",
    "Khaled",
    "Saeed",
    "Mostafa",
    "Nabil",
    "Fathy",
    "Samir",
    "Younis",
    "Ashraf",
    "Abdelaziz",
    "Osman",
    "Gamal",
  ];
  const sr: any[][] = [],
    tr: any[][] = [];
  for (let n = 0; n < 1000; n++) {
    const sid = "S" + (10001 + n);
    sr.push([
      sid,
      first[n % 20] +
        " " +
        last[Math.floor(n / 20) % 15] +
        " " +
        (Math.floor(n / 300) + 1),
      "G" + (101 + Math.floor(n / 25)),
      sid.toLowerCase() + "@example.invalid",
      "",
      "Active",
      n % 13 === 0 ? "Critical" : n % 7 === 0 ? "At Risk" : "Active",
      "In Progress",
      n % 13 === 0 ? 1 : 3,
      t,
    ]);
    tr.push([
      uid("TSK"),
      sid,
      n % 13 === 0
        ? "Create a recovery plan"
        : n % 7 === 0
          ? "Follow up on portfolio readiness"
          : "Complete weekly student check-in",
      staff[Math.floor(n / 25) % 2][0],
      new Date(Date.now() + ((n % 5) - 2) * 86400000).toISOString(),
      n % 13 === 0 ? "Recovery" : "Contact",
      n % 13 === 0 ? "High" : "Normal",
      "Open",
      "seed-" + sid,
      t,
    ]);
  }
  for (let n = 0; n < 1000; n += 10) {
    const rows = sr.slice(n, n + 10);
    batch.push(
      stmt(
        "INSERT INTO students(id,name,group_id,email,phone,lifecycle,engagement,coaching,milestone,created_at) VALUES " +
          rows.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(","),
        ...rows.flat(),
      ),
    );
  }
  for (let n = 0; n < 1000; n += 10) {
    const rows = tr.slice(n, n + 10);
    batch.push(
      stmt(
        "INSERT INTO tasks VALUES " +
          rows.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(","),
        ...rows.flat(),
      ),
    );
  }
  batch.push(
    ...Array.from({ length: 20 }, (_, i) =>
      stmt(
        "INSERT INTO accounts(id,platform,label,status,credits) VALUES(?,?,?,?,?)",
        "ACC-" + (101 + i),
        ["Kafeel", "Khamsat", "Nafezly"][i % 3],
        "Client workspace " + (i + 1),
        i % 7 === 0 ? "Funding Block" : "Available",
        i % 7 === 0 ? 0 : 50 + i * 5,
      ),
    ),
  );
  batch.push(
    ...Array.from({ length: 40 }, (_, i) =>
      stmt(
        "INSERT INTO sessions VALUES(?,?,?,?,?,?)",
        "SES-" + (101 + i),
        "G" + (101 + i),
        "Week 4 · Client delivery clinic",
        new Date(Date.now() + (i % 7) * 86400000 + 3600000).toISOString(),
        "Scheduled",
        4,
      ),
    ).map((s) => s),
  );
  batch.push(
    auditStmt(
      i,
      "Workspace initialized with 1,000 synthetic students",
      "workspace",
      { synthetic: true, mode },
    ),
  );
  await db().batch(batch);
}
