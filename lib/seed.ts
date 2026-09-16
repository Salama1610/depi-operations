import { bucket, db, stmt, now, uid, auditStmt } from "./server";
import { policy } from "./domain/rules";
import { runtimeTriggers } from "../db/runtime-triggers.mjs";
export async function seed(
  i: any,
  mode: "demo" | "production" = "demo",
  preserveWorkspace = false,
  requestId?: string,
  bootstrapOwner = false,
) {
  for (const sql of runtimeTriggers) await db().prepare(sql).run();
  const t = now();
  const batch: any[] = [];
  const at = (days: number, hour = 9) => {
    const value = new Date(Date.now() + days * 86400000);
    value.setUTCHours(hour, 0, 0, 0);
    return value.toISOString();
  };
  if (!preserveWorkspace || bootstrapOwner) {
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
  }
  if (!preserveWorkspace) {
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
  }
  if (mode === "production") {
    batch.push(
      auditStmt(
        i,
        preserveWorkspace
          ? "Imported production workspace initialized"
          : "Blank production workspace initialized",
        "workspace",
        {
          synthetic: false,
          mode,
          importedRoster: preserveWorkspace,
        },
      ),
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
  const serviceJobs: any[] = [
    stmt(
      "INSERT INTO service_submissions(id,student_id,status,submitted_at,updated_at,qc_completed_at) VALUES(?,?,?,?,?,?)",
      "DEMO-SUB-S10902",
      "S10902",
      "Needs Correction",
      at(-4),
      at(-1),
      null,
    ),
    stmt(
      "INSERT INTO service_submissions(id,student_id,status,submitted_at,updated_at,qc_completed_at) VALUES(?,?,?,?,?,?)",
      "DEMO-SUB-S10903",
      "S10903",
      "Complete",
      at(-8),
      at(-5),
      at(-5),
    ),
    stmt(
      "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-SLK-10902-1",
      "S10902",
      1,
      "http://kafiil.com/service/217168-%D8%B3%D8%A3%D9%82%D9%88%D9%85-%D8%AA%D8%AD%D9%84%D9%8A%D9%84-%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%D9%83",
      "http://kafiil.com/service/217168-%D8%B3%D8%A3%D9%82%D9%88%D9%85-%D8%AA%D8%AD%D9%84%D9%8A%D9%84-%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%D9%83",
      "Kafiil",
      "Needs Review",
      JSON.stringify({ message: "Link format passed; QC still needs to confirm the service." }),
      at(-4),
      "Locked",
      "Service page matches the submitted offering.",
      "staff-quality",
      at(-3),
      1,
      at(-4),
      at(-3),
    ),
    stmt(
      "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-SLK-10902-2",
      "S10902",
      2,
      "https://khamsat.com/data/data-analytics/4123366-%D8%AA%D8%AD%D9%88%D9%8A%D9%84-%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%D9%83-%D9%84%D8%AA%D9%82%D8%A7%D8%B1%D9%8A%D8%B1-%D8%AA%D9%81%D8%A7%D8%B9%D9%84%D9%8A%D8%A9-%D9%88%D9%82%D8%B1%D8%A7%D8%B1%D8%A7%D8%AA-%D8%B0%D9%83%D9%8A%D8%A9",
      "https://khamsat.com/data/data-analytics/4123366-%D8%AA%D8%AD%D9%88%D9%8A%D9%84-%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%D9%83-%D9%84%D8%AA%D9%82%D8%A7%D8%B1%D9%8A%D8%B1-%D8%AA%D9%81%D8%A7%D8%B9%D9%84%D9%8A%D8%A9-%D9%88%D9%82%D8%B1%D8%A7%D8%B1%D8%A7%D8%AA-%D8%B0%D9%83%D9%8A%D8%A9",
      "Khamsat",
      "Needs Review",
      JSON.stringify({ message: "Link format passed; QC still needs to confirm the service." }),
      at(-4),
      "Needs Correction",
      "Please update the description or link so the offered service is clear.",
      "staff-quality",
      at(-2),
      1,
      at(-4),
      at(-2),
    ),
    stmt(
      "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-SLK-10902-3",
      "S10902",
      3,
      "https://khamsat.com/business/accounting-bookkeeping/4098136-%D8%B3%D8%A7%D9%82%D9%88%D9%85-%D8%A8%D8%A7%D9%86%D8%B4%D8%A7%D8%A1-%D9%86%D8%B8%D8%A7%D9%85-%D9%85%D8%AD%D8%A7%D8%B3%D8%A8%D9%87-%D9%88-erp",
      "https://khamsat.com/business/accounting-bookkeeping/4098136-%D8%B3%D8%A7%D9%82%D9%88%D9%85-%D8%A8%D8%A7%D9%86%D8%B4%D8%A7%D8%A1-%D9%86%D8%B8%D8%A7%D9%85-%D9%85%D8%AD%D8%A7%D8%B3%D8%A8%D9%87-%D9%88-erp",
      "Khamsat",
      "Needs Review",
      JSON.stringify({ message: "Link format passed; QC still needs to confirm the service." }),
      at(-4),
      "Pending",
      null,
      null,
      null,
      1,
      at(-4),
      at(-4),
    ),
    stmt(
      "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-SLK-10903-1",
      "S10903",
      1,
      "https://khamsat.com/data/data-analytics/4010001-dashboard-service",
      "https://khamsat.com/data/data-analytics/4010001-dashboard-service",
      "Khamsat",
      "Needs Review",
      JSON.stringify({ message: "Link format passed; QC still needs to confirm the service." }),
      at(-8),
      "Locked",
      "Verified service page.",
      "staff-quality-lead",
      at(-7),
      1,
      at(-8),
      at(-7),
    ),
    stmt(
      "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,qc_status,qc_comment,qc_actor,qc_at,revision,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-SLK-10903-2",
      "S10903",
      2,
      "https://kafiil.com/service/217169-dashboard-design",
      "https://kafiil.com/service/217169-dashboard-design",
      "Kafiil",
      "Needs Review",
      JSON.stringify({ message: "Link format passed; QC still needs to confirm the service." }),
      "Locked",
      "Verified service page.",
      "staff-quality-lead",
      at(-7),
      1,
      at(-8),
      at(-7),
    ),
    stmt(
      "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,qc_status,qc_comment,qc_actor,qc_at,revision,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-SLK-10903-3",
      "S10903",
      3,
      "https://khamsat.com/business/accounting-bookkeeping/4098137-erp-setup",
      "https://khamsat.com/business/accounting-bookkeeping/4098137-erp-setup",
      "Khamsat",
      "Needs Review",
      JSON.stringify({ message: "Link format passed; QC still needs to confirm the service." }),
      "Locked",
      "Verified service page.",
      "staff-quality-lead",
      at(-7),
      1,
      at(-8),
      at(-7),
    ),
    stmt(
      "INSERT INTO service_link_reviews(id,service_link_id,revision,decision,comment,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?)",
      "DEMO-SLR-10902-1",
      "DEMO-SLK-10902-1",
      1,
      "Locked",
      "Service page matches the submitted offering.",
      "staff-quality",
      at(-3),
    ),
    stmt(
      "INSERT INTO service_link_reviews(id,service_link_id,revision,decision,comment,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?)",
      "DEMO-SLR-10902-2",
      "DEMO-SLK-10902-2",
      1,
      "Needs Correction",
      "Please update the description or link so the offered service is clear.",
      "staff-quality",
      at(-2),
    ),
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
        "INSERT INTO groups(id,name,track,provider,coordinator,supervisor,coach,pathway,delivery_model,start_date,status,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        "G" + (101 + i),
        tracks[i % 4] + " " + (Math.floor(i / 4) + 1),
        tracks[i % 4],
        i % 2 ? "Freelance Yard" : "Career180",
        staff[i % 2][0],
        "staff-nour",
        "staff-coach",
        i % 3 ? "Outcome" : "Support",
        i % 4 === 0 ? "Industry" : "Regular",
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
  batch.push(...serviceJobs);
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
    ...Array.from({ length: 40 }, (_, i) => {
      const offset = i === 0 ? -2 : i === 1 ? 0 : i + 1;
      const start = new Date(Date.now() + offset * 86400000);
      start.setUTCHours(i === 1 ? 0 : 10, 0, 0, 0);
      const startsAt = start.toISOString();
      const status =
        i === 0
          ? "Completed"
          : i === 1
            ? "Confirmed"
            : i === 3
              ? "Cancelled"
              : "Scheduled";
      return stmt(
        "INSERT INTO sessions(id,group_id,coach_id,title,starts_at,session_day,duration_minutes,status,week,confirmed_at,cancel_reason,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        "SES-" + (101 + i),
        "G" + (101 + i),
        i % 3 ? "staff-coach" : "staff-support-coach",
        "Week 4 · Client delivery clinic",
        startsAt,
        startsAt.slice(0, 10),
        policy.sessionMinutes,
        status,
        4,
        ["Completed", "Confirmed"].includes(status) ? t : null,
        status === "Cancelled"
          ? "Synthetic example: facilitator availability changed"
          : null,
        t,
      );
    }),
  );

  const proofStudentIds = [
    "S10901",
    "S10901",
    "S10901",
    "S10901",
    "S10901",
    "S10901",
    "S10902",
    "S10902",
    "S10903",
    "S10903",
    "S10904",
    "S10904",
    "S10905",
    "S10905",
    "S10908",
  ];
  const proofBytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  const proofHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", proofBytes)),
  )
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const proofKeys = proofStudentIds.map(
    (_, index) => `synthetic-pilot/proof-${index + 1}.png`,
  );
  const proofStore = bucket();
  if (typeof proofStore.put === "function") {
    await Promise.all(
      proofKeys.map((key) =>
        proofStore.put(key, proofBytes, {
          httpMetadata: { contentType: "image/png" },
        }),
      ),
    );
  }
  const proofGigIds = [
    "GIG-DEMO-1",
    "GIG-DEMO-1",
    "GIG-DEMO-2",
    "GIG-DEMO-2",
    "GIG-DEMO-3",
    "GIG-DEMO-3",
    "GIG-DEMO-4",
    "GIG-DEMO-4",
    "GIG-DEMO-5",
    "GIG-DEMO-5",
    "GIG-DEMO-6",
    "GIG-DEMO-6",
    "GIG-DEMO-7",
    "GIG-DEMO-7",
    null,
  ];
  batch.push(
    ...proofStudentIds.map((studentId, index) =>
      stmt(
        "INSERT INTO attachments(id,student_id,key,name,mime,size,hash,recorder,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        `DEMO-FILE-${String(index + 1).padStart(2, "0")}`,
        studentId,
        proofKeys[index],
        index === 14
          ? "whatsapp-contact.png"
          : index % 2
            ? "payment-confirmation.png"
            : "delivery-confirmation.png",
        "image/png",
        proofBytes.length,
        proofHash,
        i.id,
        at(-Math.max(1, 8 - Math.floor(index / 2))),
      ),
    ),
  );

  batch.push(
    stmt(
      "INSERT INTO account_requests(id,student_id,task,platform,value,status,task_fit,recorder,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-REQ-ALLOCATED",
      "S10901",
      "Social media banner",
      "Khamsat",
      15,
      "Submitted",
      1,
      i.id,
      at(-9),
    ),
    stmt(
      "INSERT INTO account_request_details(request_id,task_bank_id,job_profile,gig_number,notes) VALUES(?,?,?,?,?)",
      "DEMO-REQ-ALLOCATED",
      "TB-DM-1",
      "Digital marketing specialist",
      1,
      "Synthetic approved allocation",
    ),
    stmt(
      "INSERT INTO account_requests(id,student_id,task,platform,value,status,task_fit,recorder,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-REQ-RESERVED",
      "S10926",
      "Landing-page adjustment",
      "Nafezly",
      5,
      "Submitted",
      1,
      i.id,
      at(-1),
    ),
    stmt(
      "INSERT INTO account_request_details(request_id,task_bank_id,job_profile,gig_number,notes) VALUES(?,?,?,?,?)",
      "DEMO-REQ-RESERVED",
      "TB-WD-1",
      "Junior web developer",
      1,
      "Ready for independent allocation approval",
    ),
    stmt(
      "INSERT INTO account_assignments(id,account_id,student_id,group_id,request_id,created_at) VALUES(?,?,?,?,?,?)",
      "DEMO-ASN-1",
      "ACC-120",
      "S10901",
      "G137",
      "DEMO-REQ-ALLOCATED",
      at(-9),
    ),
    stmt(
      "UPDATE account_requests SET status='Allocated' WHERE id='DEMO-REQ-ALLOCATED'",
    ),
    stmt(
      "UPDATE accounts SET status='Assigned',credits=130,active_assignment='DEMO-ASN-1' WHERE id='ACC-120'",
    ),
    stmt(
      "INSERT INTO account_reservations(account_id,id,request_id,reserved_by,expires_at,status,created_at) VALUES(?,?,?,?,?,?,?)",
      "ACC-118",
      "DEMO-RES-1",
      "DEMO-REQ-RESERVED",
      i.id,
      at(1),
      "Active",
      at(-1),
    ),
  );

  const demoGigs = [
    ["GIG-DEMO-1", "S10901", "ACC-120", "Khamsat", "Brand launch banner", 5, "USD", "DEPI-D-001", "Paid", -7],
    ["GIG-DEMO-2", "S10901", "ACC-120", "Khamsat", "Campaign content calendar", 5, "USD", "DEPI-D-002", "Paid", -6],
    ["GIG-DEMO-3", "S10901", "ACC-120", "Khamsat", "Product social post", 5, "USD", "DEPI-D-003", "Paid", -5],
    ["GIG-DEMO-4", "S10902", null, "Upwork", "Landing page audit", 25, "USD", "DEPI-D-004", "Paid", -4],
    ["GIG-DEMO-5", "S10903", null, "Upwork", "Analytics cleanup", 20, "USD", "DEPI-D-005", "Paid", -3],
    ["GIG-DEMO-6", "S10904", null, "Upwork", "Pitch deck redesign", 15, "USD", "DEPI-D-006", "Paid", -2],
    ["GIG-DEMO-7", "S10905", null, "Upwork", "Dashboard QA review", 10, "USD", "DEPI-D-007", "Paid", -2],
    ["GIG-DEMO-8", "S10906", null, "Mostaql", "Arabic data report", 500, "EGP", "DEPI-D-008", "Paid", -1],
    ["GIG-DEMO-9", "S10907", null, "Mostaql", "Portfolio landing page", 30, "USD", "DEPI-D-009", "Work Submitted", 2],
    ["GIG-DEMO-10", "S10909", null, "Khamsat", "Cancelled client brief", 5, "USD", "DEPI-D-010", "Cancelled", 3],
  ] as const;
  batch.push(
    ...demoGigs.map((gig) =>
      stmt(
        "INSERT INTO gigs(id,student_id,account_id,platform,title,value,currency,order_ref,status,due,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        gig[0],
        gig[1],
        gig[2],
        gig[3],
        gig[4],
        gig[5],
        gig[6],
        gig[7],
        gig[8],
        at(gig[9] + 8),
        at(gig[9]),
      ),
    ),
    ...proofStudentIds.map((studentId, index) =>
      stmt(
        "INSERT INTO attachment_context(attachment_id,group_id,gig_id,account_id,activity_type,platform,occurred_at,source,performed_by_type,performed_by_student_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
        `DEMO-FILE-${String(index + 1).padStart(2, "0")}`,
        "G137",
        proofGigIds[index],
        index < 6 ? "ACC-120" : null,
        index === 14
          ? "Student contact"
          : index % 2
            ? "Payment evidence"
            : "Evidence submission",
        index === 14 ? "WhatsApp" : index < 6 ? "Khamsat" : "Upwork",
        at(-Math.max(1, 8 - Math.floor(index / 2))),
        "Synthetic pilot",
        index === 14 ? "STAFF" : "STUDENT",
        index === 14 ? null : studentId,
      ),
    ),
    ...Array.from({ length: 7 }, (_, index) =>
      stmt(
        "INSERT INTO gig_events(id,gig_id,status,proof_id,performed_by,recorder,occurred_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
        `DEMO-GE-${index + 1}`,
        `GIG-DEMO-${index + 1}`,
        "Paid",
        `DEMO-FILE-${String(index * 2 + 1).padStart(2, "0")}`,
        "CLIENT",
        i.id,
        at(-Math.max(1, 7 - index)),
        at(-Math.max(1, 7 - index)),
      ),
    ),
    stmt(
      "INSERT INTO account_credit_ledger(id,account_id,assignment_id,gig_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-CR-1",
      "ACC-120",
      "DEMO-ASN-1",
      "GIG-DEMO-1",
      -5,
      140,
      "Synthetic controlled gig charge",
      i.id,
      at(-7),
    ),
    stmt(
      "INSERT INTO account_credit_ledger(id,account_id,assignment_id,gig_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-CR-2",
      "ACC-120",
      "DEMO-ASN-1",
      "GIG-DEMO-2",
      -5,
      135,
      "Synthetic controlled gig charge",
      i.id,
      at(-6),
    ),
    stmt(
      "INSERT INTO account_credit_ledger(id,account_id,assignment_id,gig_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-CR-3",
      "ACC-120",
      "DEMO-ASN-1",
      "GIG-DEMO-3",
      -5,
      130,
      "Synthetic controlled gig charge",
      i.id,
      at(-5),
    ),
  );

  const demoEvidence = [
    ["DEMO-EV-1", "S10901", "GIG-DEMO-1", "Accepted", 0, null, null, -4],
    ["DEMO-EV-2", "S10901", "GIG-DEMO-2", "Accepted", 0, null, null, -3],
    ["DEMO-EV-3", "S10901", "GIG-DEMO-3", "Accepted", 0, null, null, -2],
    ["DEMO-EV-4", "S10902", "GIG-DEMO-4", "Coach Review", 0, null, null, -2],
    ["DEMO-EV-5", "S10903", "GIG-DEMO-5", "Coordinator L1", 0, null, null, -1],
    ["DEMO-EV-6", "S10904", "GIG-DEMO-6", "Quality Review", 0, null, null, -1],
    ["DEMO-EV-7", "S10905", "GIG-DEMO-7", "Rejected", 1, "EV01", "Upload a clearer delivery screenshot", -1],
  ] as const;
  batch.push(
    ...demoEvidence.map((item, index) =>
      stmt(
        "INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,rejections,code,requirements,recorder,stage_at,created_at,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        item[0],
        item[1],
        item[2],
        `DEMO-FILE-${String(index * 2 + 1).padStart(2, "0")}`,
        "Synthetic platform capture",
        item[3],
        item[4],
        item[5],
        item[6],
        i.id,
        item[3] === "Coach Review" ? at(-2, 0) : at(item[7]),
        at(item[7] - 1),
        "R5-v1",
      ),
    ),
    ...demoEvidence.map((item, index) =>
      stmt(
        "INSERT INTO evidence_packages(id,evidence_id,revision,status,created_by,created_at) VALUES(?,?,1,?,?,?)",
        `DEMO-PKG-${index + 1}`,
        item[0],
        item[3] === "Accepted"
          ? "Accepted"
          : item[3] === "Rejected"
            ? "Rejected"
            : "Submitted",
        i.id,
        at(item[7] - 1),
      ),
    ),
    ...demoEvidence.flatMap((_, index) => [
      stmt(
        "INSERT INTO evidence_package_items(id,package_id,item_type,attachment_id,created_at) VALUES(?,?,?,?,?)",
        `DEMO-ITEM-${index + 1}-D`,
        `DEMO-PKG-${index + 1}`,
        "Delivery",
        `DEMO-FILE-${String(index * 2 + 1).padStart(2, "0")}`,
        at(-1),
      ),
      stmt(
        "INSERT INTO evidence_package_items(id,package_id,item_type,attachment_id,created_at) VALUES(?,?,?,?,?)",
        `DEMO-ITEM-${index + 1}-P`,
        `DEMO-PKG-${index + 1}`,
        "Payment",
        `DEMO-FILE-${String(index * 2 + 2).padStart(2, "0")}`,
        at(-1),
      ),
    ]),
  );
  const reviewStages = [
    ["DEMO-EV-1", [["staff-coach", "Advance"], ["staff-sara", "Advance"], ["staff-quality", "Accept"]]],
    ["DEMO-EV-2", [["staff-coach", "Advance"], ["staff-sara", "Advance"], ["staff-quality", "Accept"]]],
    ["DEMO-EV-3", [["staff-coach", "Advance"], ["staff-sara", "Advance"], ["staff-quality", "Accept"]]],
    ["DEMO-EV-5", [["staff-coach", "Advance"]]],
    ["DEMO-EV-6", [["staff-coach", "Advance"], ["staff-sara", "Advance"]]],
    ["DEMO-EV-7", [["staff-coach", "Advance"], ["staff-sara", "Advance"], ["staff-quality", "Reject"]]],
  ] as const;
  batch.push(
    ...reviewStages.flatMap(([evidenceId, stages], evidenceIndex) =>
      stages.map(([actor, decision], stageIndex) =>
        stmt(
          "INSERT INTO evidence_reviews(id,evidence_id,actor,decision,code,notes,created_at) VALUES(?,?,?,?,?,?,?)",
          `DEMO-REV-${evidenceIndex + 1}-${stageIndex + 1}`,
          evidenceId,
          actor,
          decision,
          decision === "Reject" ? "EV01" : null,
          decision === "Reject"
            ? "Delivery proof needs a clearer client confirmation."
            : "Synthetic review checkpoint completed.",
          at(-Math.max(1, 4 - stageIndex)),
        ),
      ),
    ),
  );

  batch.push(
    stmt(
      "INSERT INTO contacts(id,student_id,channel,outcome,occurred_at,proof_id,next_action,owner,due,notes,recorder,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-CONTACT-1",
      "S10908",
      "WhatsApp",
      "Responded",
      at(-1),
      "DEMO-FILE-15",
      "Review portfolio revision",
      "staff-sara",
      at(2),
      "Learner confirmed the next portfolio milestone.",
      i.id,
      at(-1),
    ),
    stmt(
      "UPDATE students SET last_contact=? WHERE id='S10908'",
      at(-1),
    ),
    stmt(
      "INSERT INTO cases(id,student_id,title,type,severity,status,owner,due,resolution,root_cause,prevention,verifier,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-CASE-1",
      "S10902",
      "Repeated missed coaching check-ins",
      "Engagement",
      "High",
      "In Progress",
      "staff-sara",
      at(2),
      null,
      null,
      null,
      null,
      "synthetic:engagement:S10902",
      at(-3),
    ),
    stmt(
      "INSERT INTO cases(id,student_id,title,type,severity,status,owner,due,resolution,root_cause,prevention,verifier,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-CASE-2",
      "S10905",
      "Evidence correction needs escalation",
      "Quality",
      "Medium",
      "Waiting",
      "staff-quality-lead",
      at(1),
      null,
      null,
      null,
      null,
      "synthetic:quality:S10905",
      at(-2),
    ),
    stmt(
      "INSERT INTO cases(id,student_id,title,type,severity,status,owner,due,resolution,root_cause,prevention,verifier,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-CASE-3",
      null,
      "Controlled account credential incident",
      "Account",
      "Critical",
      "Resolved",
      i.id,
      at(-1),
      "Credential reference rotated and access revalidated.",
      "Expired shared credential reference.",
      "Quarterly reference review added to the control checklist.",
      "staff-nour",
      "synthetic:account-control",
      at(-5),
    ),
    stmt(
      "INSERT INTO case_events(id,case_id,status,actor,notes,created_at) VALUES(?,?,?,?,?,?)",
      "DEMO-CASEEV-1",
      "DEMO-CASE-1",
      "Open",
      "staff-sara",
      "Recovery case opened from the weekly risk review.",
      at(-3),
    ),
    stmt(
      "INSERT INTO case_events(id,case_id,status,actor,notes,created_at) VALUES(?,?,?,?,?,?)",
      "DEMO-CASEEV-2",
      "DEMO-CASE-1",
      "In Progress",
      "staff-sara",
      "Contact plan agreed with the learner.",
      at(-2),
    ),
    stmt(
      "INSERT INTO case_events(id,case_id,status,actor,notes,created_at) VALUES(?,?,?,?,?,?)",
      "DEMO-CASEEV-3",
      "DEMO-CASE-2",
      "Waiting",
      "staff-quality-lead",
      "Waiting for corrected delivery evidence.",
      at(-1),
    ),
    stmt(
      "INSERT INTO case_events(id,case_id,status,actor,notes,created_at) VALUES(?,?,?,?,?,?)",
      "DEMO-CASEEV-4",
      "DEMO-CASE-3",
      "Resolved",
      i.id,
      "Credential rotated and control owner notified.",
      at(-1),
    ),
  );

  batch.push(
    ...Array.from({ length: 25 }, (_, index) =>
      stmt(
        "INSERT INTO attendance(id,session_id,student_id,status,recorder,source,updated_at) VALUES(?,?,?,?,?,?,?)",
        `DEMO-ATT-${index + 1}`,
        "SES-101",
        `S${10001 + index}`,
        index < 20
          ? "Present"
          : index < 22
            ? "Late"
            : index < 24
              ? "Absent"
              : "Excused",
        "staff-support-coach",
        "Coach session register",
        at(-2, 13),
      ),
    ),
    stmt(
      "INSERT INTO session_reports(session_id,facilitator,notes,attendance_reconciled,submitted_at) VALUES(?,?,?,?,?)",
      "SES-101",
      "staff-support-coach",
      "Client-delivery clinic completed; portfolio corrections and account follow-ups assigned.",
      1,
      at(-2, 13),
    ),
    stmt(
      "INSERT INTO group_gate_checks(id,group_id,week,check_key,status,evidence_id,owner,due,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-GATE-1",
      "G137",
      4,
      "Current statuses recorded",
      "Complete",
      null,
      "staff-nour",
      at(1),
      t,
    ),
    stmt(
      "INSERT INTO group_gate_checks(id,group_id,week,check_key,status,evidence_id,owner,due,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-GATE-2",
      "G137",
      4,
      "Rejected evidence has correction owner",
      "Exception",
      "DEMO-FILE-13",
      "staff-quality-lead",
      at(1),
      t,
    ),
    stmt(
      "INSERT INTO group_gate_checks(id,group_id,week,check_key,status,evidence_id,owner,due,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-GATE-3",
      "G137",
      4,
      "Supervisor exception review complete",
      "Pending",
      null,
      "staff-nour",
      at(2),
      t,
    ),
  );

  const screeningCriteria = JSON.stringify([
    "Identity and registration record checked",
    "Contact details confirmed",
    "Track prerequisites reviewed",
    "Program availability confirmed",
  ]);
  batch.push(
    stmt("UPDATE applications SET status='Admitted',updated_at=? WHERE id='APP-101'", t),
    stmt("UPDATE applications SET status='Ineligible',updated_at=? WHERE id='APP-102'", t),
    stmt("UPDATE applications SET status='Waitlisted',updated_at=? WHERE id='APP-103'", t),
    stmt(
      "INSERT INTO screenings(id,application_id,decision,criteria,reason,reviewer,reviewed_at) VALUES(?,?,?,?,?,?,?)",
      "DEMO-SCREEN-1",
      "APP-101",
      "Eligible",
      screeningCriteria,
      "All eligibility criteria verified for the synthetic pilot.",
      "staff-sara",
      at(-12),
    ),
    stmt(
      "INSERT INTO screenings(id,application_id,decision,criteria,reason,reviewer,reviewed_at) VALUES(?,?,?,?,?,?,?)",
      "DEMO-SCREEN-2",
      "APP-102",
      "Ineligible",
      screeningCriteria,
      "Synthetic example: prerequisite evidence was incomplete.",
      "staff-omar",
      at(-11),
    ),
    stmt(
      "INSERT INTO screenings(id,application_id,decision,criteria,reason,reviewer,reviewed_at) VALUES(?,?,?,?,?,?,?)",
      "DEMO-SCREEN-3",
      "APP-103",
      "Waitlisted",
      screeningCriteria,
      "Synthetic example: eligible pending capacity.",
      "staff-sara",
      at(-10),
    ),
    stmt(
      "INSERT INTO admissions(id,application_id,student_id,group_id,assigned_by,admitted_at) VALUES(?,?,?,?,?,?)",
      "DEMO-ADM-1",
      "APP-101",
      "S10901",
      "G137",
      i.id,
      at(-10),
    ),
    stmt(
      "INSERT INTO assessments(id,group_id,title,type,max_score,pass_score,due_at,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      "DEMO-ASSESS-1",
      "G137",
      "Round 5 final readiness",
      "Final",
      100,
      60,
      at(-4),
      "Closed",
      "staff-nour",
      at(-14),
    ),
    stmt(
      "INSERT INTO assessment_results(id,assessment_id,student_id,score,outcome,evidence_id,notes,assessed_by,assessed_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-RESULT-1",
      "DEMO-ASSESS-1",
      "S10901",
      88,
      "Passed",
      null,
      "Strong client communication and complete delivery record.",
      "staff-nour",
      at(-4),
    ),
    stmt(
      "INSERT INTO assessment_results(id,assessment_id,student_id,score,outcome,evidence_id,notes,assessed_by,assessed_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-RESULT-2",
      "DEMO-ASSESS-1",
      "S10902",
      54,
      "Needs Support",
      null,
      "Recovery actions assigned before reassessment.",
      "staff-nour",
      at(-4),
    ),
    stmt(
      "UPDATE students SET lifecycle='Graduate Closed',engagement='Active',coaching='Complete',milestone=8,last_contact=? WHERE id='S10901'",
      at(-3),
    ),
    stmt("UPDATE tasks SET status='Completed' WHERE student_id='S10901'"),
    stmt(
      "INSERT INTO graduation_ledger(id,student_id,policy_id,result,evidence_ids,calculated_at) VALUES(?,?,?,?,?,?)",
      "DEMO-GRAD-1",
      "S10901",
      "R5-v1",
      "Graduated",
      JSON.stringify(["DEMO-EV-1", "DEMO-EV-2", "DEMO-EV-3"]),
      at(-1),
    ),
    stmt(
      "INSERT INTO certificates(id,student_id,type,status,external_ref,issued_by,issued_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
      "DEMO-CERT-1",
      "S10901",
      "Completion",
      "Issued",
      "DEPI-R5-DEMO-001",
      i.id,
      at(-1),
      at(-1),
    ),
    stmt(
      "INSERT INTO post_program_outcomes(id,student_id,type,organization,title,value,currency,status,proof_id,follow_up_at,owner,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      "DEMO-OUTCOME-1",
      "S10901",
      "Employment",
      "Synthetic Studio",
      "Junior Digital Marketing Specialist",
      8500,
      "EGP",
      "Verified",
      "DEMO-FILE-01",
      at(30),
      "staff-sara",
      at(-1),
    ),
    stmt(
      "UPDATE students SET lifecycle='Withdrawn',engagement='Inactive',coaching='Stopped',milestone=4 WHERE id='S10910'",
    ),
    stmt(
      "INSERT INTO withdrawal_decisions(id,student_id,ministry_reference,decision,reason,decided_at,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      "DEMO-WITHDRAW-1",
      "S10910",
      "MIN-DEMO-WD-001",
      "Approved",
      "Synthetic example: learner accepted a full-time commitment.",
      at(-3),
      i.id,
      at(-3),
    ),
    stmt(
      "INSERT INTO student_status_events(id,student_id,dimension,previous,value,actor,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
      "DEMO-STATUS-1",
      "S10901",
      "lifecycle",
      "Active",
      "Graduate Closed",
      i.id,
      "Graduation requirements and final assessment completed.",
      at(-1),
    ),
    stmt(
      "INSERT INTO student_status_events(id,student_id,dimension,previous,value,actor,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
      "DEMO-STATUS-2",
      "S10910",
      "lifecycle",
      "Active",
      "Withdrawn",
      i.id,
      "Approved Ministry withdrawal recorded.",
      at(-3),
    ),
    stmt(
      "INSERT INTO student_status_events(id,student_id,dimension,previous,value,actor,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
      "DEMO-STATUS-3",
      "S10905",
      "engagement",
      "Active",
      "At Risk",
      "staff-sara",
      "Evidence correction requires a supervised follow-up.",
      at(-1),
    ),
    stmt("UPDATE students SET engagement='At Risk' WHERE id='S10905'"),
  );

  const fxDate = at(-7).slice(0, 10);
  batch.push(
    stmt(
      "INSERT INTO fx_rates(id,currency,usd_rate,effective_date,source,status,created_by,approved_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-FX-EGP",
      "EGP",
      0.0205,
      fxDate,
      "Synthetic Central Bank reference",
      "Approved",
      "staff-sara",
      i.id,
      at(-7),
    ),
    stmt(
      "INSERT INTO gig_fx_applications(gig_id,fx_rate_id,usd_value,applied_by,applied_at) VALUES(?,?,?,?,?)",
      "GIG-DEMO-8",
      "DEMO-FX-EGP",
      10.25,
      i.id,
      at(-1),
    ),
    stmt(
      "INSERT INTO report_definitions(id,name,status,columns,created_by,created_at,approved_by,approved_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-REPORT-DEF",
      "Synthetic Ministry lifecycle handoff",
      "Active",
      JSON.stringify([
        "student_id",
        "name",
        "track",
        "group",
        "lifecycle",
        "graduation",
        "certificate_status",
      ]),
      "staff-sara",
      at(-8),
      i.id,
      at(-7),
      at(-7),
    ),
    stmt(
      "INSERT INTO report_runs(id,definition_id,actor,filters,count,created_at) VALUES(?,?,?,?,?,?)",
      "DEMO-REPORT-RUN",
      "DEMO-REPORT-DEF",
      i.id,
      JSON.stringify({ scope: "synthetic pilot" }),
      1000,
      at(-1),
    ),
    stmt(
      "INSERT INTO saved_views(id,user_id,module,name,filters,created_at) VALUES(?,?,?,?,?,?)",
      "DEMO-VIEW-1",
      i.id,
      "students",
      "Synthetic learners needing attention",
      JSON.stringify({ risk: ["At Risk", "Critical"] }),
      t,
    ),
    stmt(
      "INSERT INTO system_configuration(key,value,classification,updated_by,updated_at) VALUES(?,?,?,?,?)",
      "retention:attachments",
      JSON.stringify({
        days: 365,
        action: "archive",
        authority: "Synthetic pilot policy — replace before production use",
        approved_at: t,
      }),
      "Restricted",
      i.id,
      t,
    ),
    stmt(
      "INSERT INTO retention_actions(id,scope,cutoff,action,status,reason,approved_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      "DEMO-RET-1",
      "attachments",
      at(-365),
      "archive",
      "Policy recorded — execution pending",
      "Synthetic pilot example only",
      i.id,
      t,
    ),
    stmt(
      "INSERT INTO policies(id,name,status,config,created_by,approved_by,created_at) VALUES(?,?,?,?,?,?,?)",
      "DEMO-POLICY-DRAFT",
      "Round 5 · Synthetic change draft",
      "Draft",
      JSON.stringify({ ...policy, contactDays: 5 }),
      i.id,
      null,
      t,
    ),
    stmt(
      "INSERT INTO automation_runs(id,actor,kind,payload_hash,status,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      "DEMO-AUTOMATION-1",
      i.id,
      "weekly_report",
      "synthetic-pilot",
      "Completed",
      JSON.stringify({ students: 1000, groups: 40, note: "Synthetic preview" }),
      at(-1),
      at(-1),
    ),
    stmt(
      "INSERT INTO notifications(id,recipient,title,entity_type,entity_id,severity,source,created_at,read_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-NOTICE-1",
      i.id,
      "Coach evidence has exceeded the 24-hour review target",
      "evidence",
      "DEMO-EV-4",
      "Action Required",
      "synthetic:evidence-sla",
      t,
      null,
    ),
    stmt(
      "INSERT INTO notifications(id,recipient,title,entity_type,entity_id,severity,source,created_at,read_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "DEMO-NOTICE-2",
      i.id,
      "A controlled account request is reserved for approval",
      "student",
      "S10926",
      "Information",
      "synthetic:account-reservation",
      t,
      null,
    ),
  );
  batch.push(
    auditStmt(
      i,
      "Workspace initialized with 1,000 synthetic students",
      "workspace",
      {
        synthetic: true,
        mode,
        representative_workflows: true,
        preserved_owner_and_policy: preserveWorkspace,
      },
      null,
      requestId,
    ),
  );
  try {
    await db().batch(batch);
  } catch (error) {
    if (typeof proofStore.delete === "function")
      await Promise.all(proofKeys.map((key) => proofStore.delete(key)));
    throw error;
  }
}
